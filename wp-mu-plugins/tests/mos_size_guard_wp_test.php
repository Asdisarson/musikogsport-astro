<?php
/**
 * WordPress-level test for the failure guards in ../mos-size-index.php: when a WooCommerce internal the
 * collection-data fields lean on throws, the listing still answers 200 with Woo's own data, just without the
 * plugin's field. The failure is forced by throwing from inside the mos_size term query.
 *
 * Run (local site): wpms eval-file wp-mu-plugins/tests/mos_size_guard_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};

$collection = static function (array $params) {
    $request = new WP_REST_Request('GET', '/wc/store/v1/products/collection-data');
    foreach ($params as $k => $v) { $request->set_param($k, $v); }
    return rest_do_request($request);
};
$params = ['category' => '653', 'mos_size_counts' => '1', 'calculate_stock_status_counts' => 'true', 'mos_extra_counts' => '1', 'mos_price_ranges' => ':4999'];

$ok = $collection($params);
$data = $ok->get_data();
$check('baseline: both fields present', $ok->get_status() === 200 && !empty($data['mos_size_counts']) && isset($data['mos_extra_counts']['price'][0]));

// Force the size-count path to throw (the term list it reads), as a changed Woo internal would.
$boom = static function ($query) {
    if (in_array('mos_size', (array) ($query->query_vars['taxonomy'] ?? []), true)) { throw new RuntimeException('forced failure'); }
};
add_action('pre_get_terms', $boom);
$log = tempnam(sys_get_temp_dir(), 'mos-size-guard');
$old_log = ini_set('error_log', $log);
$failed = $collection($params);
ini_set('error_log', (string) $old_log);
remove_action('pre_get_terms', $boom);
$fdata = $failed->get_data();
$logged = (string) file_get_contents($log);
unlink($log);

$check('a throwing size count still answers 200', $failed->get_status() === 200, (string) $failed->get_status());
$check('the response is left as Woo made it (no mos_size_counts)', !array_key_exists('mos_size_counts', (array) $fdata));
$check("Woo's own stock counts are still there", !empty($fdata['stock_status_counts']));
$check('the failure is logged', strpos($logged, 'mos-size-index: size counts failed: forced failure') !== false, trim($logged));
$check('the size filter does not leak past the request', empty($GLOBALS['mos_size']));

// The sync queue flushes at the very end of shutdown (after WooCommerce's session save at 20), never before.
// A product already indexed is queued and flushed: the recompute is a no-op write (its sizes are unchanged).
$pid = (int) get_posts(['post_type' => 'product', 'post_status' => 'publish', 'numberposts' => 1, 'fields' => 'ids', 'tax_query' => [['taxonomy' => 'mos_size', 'operator' => 'EXISTS']]])[0];
$before = wp_get_object_terms($pid, 'mos_size', ['fields' => 'slugs']);
mos_size_queue($pid);
$check('queued products flush at shutdown priority PHP_INT_MAX', has_action('shutdown', 'mos_size_shutdown_flush') === PHP_INT_MAX);
$check('not at the old priority 1 any more', has_action('shutdown', 'mos_size_flush') === false);
mos_size_shutdown_flush();
$check('the queue is empty after the flush', empty($GLOBALS['mos_size_dirty']));
$check('an unchanged product keeps its sizes', wp_get_object_terms($pid, 'mos_size', ['fields' => 'slugs']) === $before, implode(',', $before));

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
