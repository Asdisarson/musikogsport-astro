<?php
/**
 * `wp mos-size reindex` for hosts without WP-CLI (Plesk: Scheduled Tasks → "Run a PHP script" → Run Now).
 * The same loop as MOS_Size_CLI::reindex in mos-size-index.php, with its functions: the derived size taxonomy
 * is rebuilt, product data is never written. Rerunnable.
 *
 *   php mos-size-reindex.php [path to the WordPress folder] [--dry-run]
 *
 * Without a path it looks for ../../../httpdocs (this repository deployed next to WordPress in one Plesk
 * subscription). Command line only.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

$args = array_slice($argv, 1);
$dry = in_array('--dry-run', $args, true);
$paths = array_values(array_filter($args, static fn ($a) => $a !== '--dry-run'));
$wp = rtrim($paths[0] ?? (__DIR__ . '/../../../httpdocs'), '/');
if (!is_file($wp . '/wp-load.php')) { fwrite(STDERR, "No wp-load.php in $wp\n"); exit(1); }

set_time_limit(0);
// A request-less load: plugins that read the host get the site's own, and a wp_die() during the load prints its
// message as text instead of WordPress's HTML error page.
$_SERVER['HTTP_HOST'] = $_SERVER['HTTP_HOST'] ?? (string) (getenv('MOS_WP_HOST') ?: 'localhost');
$_SERVER['REQUEST_URI'] = $_SERVER['REQUEST_URI'] ?? '/';
$_SERVER['REQUEST_METHOD'] = $_SERVER['REQUEST_METHOD'] ?? 'GET';
function mos_cli_die($message, $title = '', $args = []) {
    if (is_object($message) && method_exists($message, 'get_error_message')) { $message = $message->get_error_message(); }
    fwrite(STDERR, 'WordPress stopped: ' . trim(html_entity_decode(strip_tags((string) $message))) . "\n");
    exit(1);
}
$GLOBALS['wp_filter']['wp_die_handler'][10]['mos_cli_die'] = ['function' => static fn () => 'mos_cli_die', 'accepted_args' => 1];
define('WP_USE_THEMES', false);
require $wp . '/wp-load.php';
if (!function_exists('mos_size_compute') || !function_exists('mos_size_apply')) {
    fwrite(STDERR, "mos-size-index.php is not installed in wp-content/mu-plugins\n");
    exit(1);
}

global $wpdb;
$ids = array_map('intval', $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status IN ('publish', 'private', 'draft', 'pending', 'future') ORDER BY ID"));
$start = microtime(true);
$unmapped = [];
$with = 0;
$changed = 0;
if (!$dry) { wp_defer_term_counting(true); }
foreach (array_chunk($ids, 200) as $chunk) {
    $computed = mos_size_compute($chunk, $unmapped);
    foreach ($computed as $terms) { if ($terms) { $with++; } }
    if (!$dry) { $changed += mos_size_apply($computed); }
    if (function_exists('wp_cache_flush_runtime')) { wp_cache_flush_runtime(); }
}
$pruned = 0;
if (!$dry) {
    wp_defer_term_counting(false);
    // Terms no product carries any more (sizes that sold out everywhere) are removed.
    foreach (get_terms(['taxonomy' => MOS_SIZE_TAXONOMY, 'hide_empty' => false]) as $term) {
        $used = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$wpdb->term_relationships} WHERE term_taxonomy_id = %d", $term->term_taxonomy_id));
        if ($used === 0) { wp_delete_term($term->term_id, MOS_SIZE_TAXONOMY); $pruned++; }
    }
    try { mos_size_invalidate_caches(); } catch (\Throwable $e) { echo 'Cached counts not cleared (they expire on their own): ', $e->getMessage(), "\n"; }
}
printf("%s %d products in %.1fs; with at least one available size: %d\n", $dry ? 'Dry run over' : 'Indexed', count($ids), microtime(true) - $start, $with);
if (!$dry) { printf("Products whose sizes changed: %d; empty sizes removed: %d\n", $changed, $pruned); }
printf("Unmapped raw values: %d distinct\n", count($unmapped));
echo $dry ? "Dry run done; nothing written.\n" : "Size index rebuilt.\n";
