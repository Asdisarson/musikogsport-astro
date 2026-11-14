<?php
/**
 * WordPress-level test for ../headless-bridge.php (payment-return glue; this test pins current behaviour, it changes
 * nothing): the order-received return URL, the storefront-outcome matcher, and the wp_redirect rewrite that runs
 * only inside the Straumur return handler.
 *
 * Read-only: the order is an unsaved in-memory WC_Order, no gateway code runs, and $_GET / the return flag are
 * restored. The local shim (headless-bridge-local.php) rewrites the return URL's host at priority 20, so hosts are
 * not asserted, only paths and queries.
 * Run (local site): wpms eval-file wp-mu-plugins/tests/headless_bridge_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};
$path_query = static function (string $url): string {
    $path = (string) wp_parse_url($url, PHP_URL_PATH);
    $query = (string) wp_parse_url($url, PHP_URL_QUERY);
    return $path . ($query !== '' ? '?' . $query : '');
};

// --- 1. return URL ---
$order = new WC_Order();
$order->set_id(4242);
$order->set_order_key('wc_order_testkey123');
$url = (string) apply_filters('woocommerce_get_return_url', 'https://elsewhere.example/checkout/order-received/4242/', $order);
$check('return URL: /gera-upp/order-received/<id>/?key=', $path_query($url) === '/gera-upp/order-received/4242/?key=wc_order_testkey123', $url);
$check('return URL: non-order passes through', $path_query((string) apply_filters('woocommerce_get_return_url', '/x/?a=1', null)) === '/x/?a=1');

// --- mos_is_storefront_outcome ---
$outcome = [
    ['https://wp.example/gera-upp/order-received/55/', true],
    ['https://wp.example/gera-upp/order-received/55', true],
    ['https://wp.example/gera-upp/order-received/55/?key=wc_order_x', true],
    ['https://wp.example/gera-upp/?straumurStatus=failed', true],
    ['https://wp.example/gera-upp?straumurStatus=canceled&order_id=5', true],
    ['https://wp.example/gera-upp/order-pay/55/?pay_for_order=true&key=wc_order_x', false],
    ['https://wp.example/gera-upp/', false],
    ['https://wp.example/karfa/', false],
    ['https://wp.example/gera-upp/order-received/abc/', false],
    ['https://wp.example/gera-upp/order-received/55/extra/', false],
    ['https://wp.example/x/gera-upp/order-received/55/', false],
];
foreach ($outcome as [$loc, $want]) {
    $check('outcome ' . ($want ? 'yes ' : 'no ') . $path_query($loc), mos_is_storefront_outcome($loc) === $want);
}

// --- 3. Valitor return: which requests go on to the storefront receipt, and with what ---
$sf = 'https://shop.example';
$valitor = ['ReferenceNumber' => 'WC-55-1', 'key' => 'wc_order_abc', 'CardNumberMasked' => '4111********1111', 'AuthorizationNumber' => '123456'];
$check('valitor return: receipt with the key only', mos_valitor_return_target('/gera-upp/order-received/55/', $valitor, $sf) === 'https://shop.example/gera-upp/order-received/55/?key=wc_order_abc', (string) mos_valitor_return_target('/gera-upp/order-received/55/', $valitor, $sf));
$check('valitor return: no key, no query', mos_valitor_return_target('/gera-upp/order-received/55', ['ReferenceNumber' => 'x'], "$sf/") === 'https://shop.example/gera-upp/order-received/55/');
$check('valitor return: a key that is not a string is dropped', mos_valitor_return_target('/gera-upp/order-received/55/', ['ReferenceNumber' => 'x', 'key' => ['a']], $sf) === 'https://shop.example/gera-upp/order-received/55/');
$check('valitor return: not without a reference', mos_valitor_return_target('/gera-upp/order-received/55/', ['key' => 'wc_order_abc'], $sf) === null);
$check('valitor return: not without a storefront', mos_valitor_return_target('/gera-upp/order-received/55/', $valitor, '') === null);
$check('valitor return: only the order-received page', mos_valitor_return_target('/gera-upp/order-pay/55/', $valitor, $sf) === null && mos_valitor_return_target('/gera-upp/order-received/x/', $valitor, $sf) === null && mos_valitor_return_target('/karfa/', $valitor, $sf) === null);

// --- 2b. wp_redirect rewrite, only inside the Straumur return handler ---
$saved_get = $_GET;
$saved_flag = array_key_exists('mos_in_straumur_return', $GLOBALS) ? $GLOBALS['mos_in_straumur_return'] : null;
$redirect = static fn (string $loc): string => (string) apply_filters('wp_redirect', $loc, 302);
// WP-CLI warns (with a backtrace) on every wp_redirect; quiet it for the test, put it back after.
$cli_handler = 'WP_CLI\Utils\wp_redirect_handler';
$cli_prio = has_filter('wp_redirect', $cli_handler);
if ($cli_prio !== false) { remove_filter('wp_redirect', $cli_handler, $cli_prio); }
$order_pay = home_url('/gera-upp/order-pay/55/?pay_for_order=true&key=wc_order_secret');

unset($GLOBALS['mos_in_straumur_return']);
$_GET = ['wc-api' => 'straumur', 'order_id' => '55'];
$check('outside the return handler: order-pay untouched (a $_GET wc-api alone does nothing)', $redirect($order_pay) === $order_pay);

$GLOBALS['mos_in_straumur_return'] = true;
$_GET = ['order_id' => '55'];
$out = $redirect($order_pay);
$check('order-pay -> /gera-upp/?straumurStatus=failed&order_id=55', $path_query($out) === '/gera-upp/?straumurStatus=failed&order_id=55', $out);
$check('order-pay: the order key never leaves', strpos($out, 'wc_order_secret') === false && strpos($out, 'key=') === false);
$check('order-pay -> home host', wp_parse_url($out, PHP_URL_HOST) === wp_parse_url(home_url('/'), PHP_URL_HOST));

$_GET = ['order_id' => 'abc'];
$check('non-numeric order_id dropped', $path_query($redirect($order_pay)) === '/gera-upp/?straumurStatus=failed');
$_GET = ['order_id' => '-7'];
$check('negative order_id -> its absolute value (absint)', $path_query($redirect($order_pay)) === '/gera-upp/?straumurStatus=failed&order_id=7');
$_GET = [];
$check('no order_id -> straumurStatus only', $path_query($redirect($order_pay)) === '/gera-upp/?straumurStatus=failed');
$check('classic cart -> failed too', $path_query($redirect(home_url('/karfa/'))) === '/gera-upp/?straumurStatus=failed');
$check('off-site target -> failed on the home host', $path_query($redirect('https://evil.example/x')) === '/gera-upp/?straumurStatus=failed');

$_GET = ['order_id' => '55'];
$received = home_url('/gera-upp/order-received/55/?key=wc_order_secret&utm=x');
$out = $redirect($received);
$check('order-received passes, minus the key', $path_query($out) === '/gera-upp/order-received/55/?utm=x', $out);
$failed = home_url('/gera-upp/?straumurStatus=failed');
$check('a storefront failure URL passes unchanged', $redirect($failed) === $failed);

// --- 2. MU-08: the ?straumurStatus= bounce carries the status (and a numeric order_id) only, never other params ---
$check('MU-08: bounce builder exists', function_exists('mos_straumur_bounce_target'));
if (function_exists('mos_straumur_bounce_target')) {
    $bounce = static fn (array $get): ?string => mos_straumur_bounce_target($get);
    $out = (string) $bounce(['straumurStatus' => 'failed', 'b' => "\\'x\\\"", 'arr' => ['a' => '1']]);
    $check('MU-08: other params are not reflected', $path_query($out) === '/gera-upp/?straumurStatus=failed', $out);
    $check('MU-08: canceled + order_id', $path_query((string) $bounce(['straumurStatus' => 'canceled', 'order_id' => '55'])) === '/gera-upp/?straumurStatus=canceled&order_id=55');
    $check('MU-08: error, non-numeric order_id dropped', $path_query((string) $bounce(['straumurStatus' => 'error', 'order_id' => 'x'])) === '/gera-upp/?straumurStatus=error');
    $check('MU-08: an unknown status is no bounce', $bounce(['straumurStatus' => 'paid']) === null && $bounce([]) === null && $bounce(['straumurStatus' => ['failed']]) === null);
    $check('MU-08: bounce stays on the home host', wp_parse_url($out, PHP_URL_HOST) === wp_parse_url(home_url('/'), PHP_URL_HOST));
}

// --- 2c. MU-09: a refused Straumur return (nonce) lands on the checkout notice, not a raw 500 ---
$check('MU-09: die handler exists', function_exists('mos_straumur_return_die') && function_exists('mos_straumur_return_die_target'));
if (function_exists('mos_straumur_return_die_target')) {
    unset($GLOBALS['mos_in_straumur_return']);
    // (WP-CLI puts its own handler on this filter, so "untouched" means: not ours.)
    $check('MU-09: outside the return handler wp_die is untouched', apply_filters('wp_die_handler', '_default_wp_die_handler') !== 'mos_straumur_return_die');
    $GLOBALS['mos_in_straumur_return'] = true;
    $check('MU-09: inside it, wp_die goes to the storefront handler', apply_filters('wp_die_handler', '_default_wp_die_handler') === 'mos_straumur_return_die');
    $target = mos_straumur_return_die_target();
    $check('MU-09: target is the checkout error notice', $path_query($target) === '/gera-upp/?straumurStatus=error', $target);
    $check('MU-09: the target passes the bridge rewrite unchanged', $redirect($target) === $target);
    $check('MU-09: AJAX/JSON die handlers untouched', apply_filters('wp_die_ajax_handler', '_ajax_wp_die_handler') === '_ajax_wp_die_handler' && apply_filters('wp_die_json_handler', '_json_wp_die_handler') === '_json_wp_die_handler');
}

if ($saved_flag === null) { unset($GLOBALS['mos_in_straumur_return']); } else { $GLOBALS['mos_in_straumur_return'] = $saved_flag; }
$_GET = $saved_get;
if ($cli_prio !== false) { add_filter('wp_redirect', $cli_handler, $cli_prio); }
$check('state restored', !isset($GLOBALS['mos_in_straumur_return']) || $saved_flag !== null);

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
