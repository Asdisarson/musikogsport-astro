<?php
/**
 * WordPress-level test for the end-of-request order: the catalog fill (mos-catalog-clean.php) runs before the storefront
 * poke (mos-shell-poke.php), which runs before the size index (mos-size-index.php); a poke queued after the poke flush
 * already ran is still sent; and the fill's announcement ('mos_clean_filled') queues the products' paths.
 *
 * Nothing is sent: outgoing HTTP is captured with 'pre_http_request' and answered locally. No existing product is saved,
 * and every hook and global this test adds or changes is removed or restored in the finally block.
 *
 * Run (local site): wp.sh eval-file wp-mu-plugins/tests/mos_clean_poke_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};

// The poke needs a storefront address to build its URL. Only this test process gets one, and only a local one.
if (!function_exists('mos_headless_target_base') || mos_headless_target_base() === '') {
    if (!defined('MOS_DEV_ASTRO_URL')) { define('MOS_DEV_ASTRO_URL', 'http://127.0.0.1:10026'); }
}

$globals = ['mos_clean_dirty', 'mos_clean_running', 'mos_shell_poke', 'mos_shell_poke_flushed', 'mos_shell_poke_late_pending',
    'mos_shell_poke_late_runs', 'mos_shell_poke_late_logged', 'mos_size_dirty', 'mos_shell_poke_props', 'mos_shell_poke_before'];
$saved = [];
foreach ($globals as $g) { $saved[$g] = $GLOBALS[$g] ?? null; }
$reset_poke = static function () {
    $GLOBALS['mos_shell_poke'] = null;
    $GLOBALS['mos_shell_poke_flushed'] = false;
    $GLOBALS['mos_shell_poke_late_pending'] = false;
    $GLOBALS['mos_shell_poke_late_runs'] = 0;
};
/** Remove a shutdown hook by the priority it was registered at (whatever that is), if it is there. */
$drop_shutdown = static function (string $fn) {
    $pr = has_action('shutdown', $fn);
    if ($pr !== false) { remove_action('shutdown', $fn, $pr); }
};

/** The paths a poke body names (stale and drop), decoded: WordPress escapes the slashes in the JSON text. */
$paths_of = static function (string $body): array {
    $d = json_decode($body, true);
    return is_array($d) ? array_merge($d['stale'] ?? [], $d['drop'] ?? []) : [];
};

$sent = [];
$capture = static function ($pre, $args, $url) use (&$sent) {
    $sent[] = ['url' => (string) $url, 'body' => (string) ($args['body'] ?? '')];
    return ['headers' => [], 'body' => '', 'response' => ['code' => 204, 'message' => 'No Content'], 'cookies' => [], 'filename' => null];
};
add_filter('pre_http_request', $capture, 10, 3);

try {
    // 1. Order at shutdown. Each hook is registered by the same call the real saves make.
    $reset_poke();
    $GLOBALS['mos_clean_running'] = false;
    $GLOBALS['mos_clean_dirty'] = [];
    $GLOBALS['mos_size_dirty'] = [];
    $probe = 999999999;   // no such product: it is queued, never filled (the hook is removed below)
    mos_clean_queue($probe);
    mos_shell_poke_queue(['/vara/poke-order-probe/'], [], true);
    mos_size_queue($probe);

    $fill_pr = has_action('shutdown', 'mos_clean_flush');
    $poke_pr = has_action('shutdown', 'mos_shell_poke_flush');
    $size_pr = has_action('shutdown', 'mos_size_shutdown_flush');
    $check('all three end-of-request flushes are registered', $fill_pr !== false && $poke_pr !== false && $size_pr !== false,
        json_encode([$fill_pr, $poke_pr, $size_pr]));
    if ($fill_pr !== false && $poke_pr !== false) {
        $check('the catalog fill runs before the storefront poke', $fill_pr < $poke_pr, "fill $fill_pr, poke $poke_pr");
    }
    if ($poke_pr !== false && $size_pr !== false) {
        $check('the storefront poke runs before the size index', $poke_pr < $size_pr, "poke $poke_pr, size $size_pr");
    }
    $drop_shutdown('mos_clean_flush');
    $drop_shutdown('mos_shell_poke_flush');
    $drop_shutdown('mos_size_shutdown_flush');
    $GLOBALS['mos_clean_dirty'] = [];
    $GLOBALS['mos_size_dirty'] = [];
    $reset_poke();

    // 2. A poke queued after the shutdown flush ran is sent by a late flush, once, in its own POST.
    $sent = [];
    mos_shell_poke_queue(['/vara/poke-late-a/'], [], true);
    mos_shell_poke_flush();                             // the shutdown flush (what WordPress would run last)
    $check('the first poke is sent at the shutdown flush', count($sent) === 1 && $paths_of($sent[0]['body']) === ['/vara/poke-late-a/'],
        json_encode($sent));
    mos_shell_poke_queue(['/vara/poke-late-b/'], [], true); // a save that happened during shutdown
    mos_shell_poke_queue(['/vara/poke-late-c/'], [], true); // and another one, still before the late flush
    $check('a poke queued after the flush has a late flush pending', ($GLOBALS['mos_shell_poke_late_pending'] ?? false) === true);
    mos_shell_poke_flush_late();                        // what PHP's shutdown list runs
    $check('the late poke is sent, once, with both paths', count($sent) === 2
        && $paths_of($sent[1]['body']) === ['/vara/poke-late-b/', '/vara/poke-late-c/'], json_encode($sent));
    $check('the late poke goes to the storefront\'s shell refresh', count($sent) === 2
        && str_ends_with($sent[1]['url'], '/api/shell-refresh'), json_encode(array_column($sent, 'url')));
    $check('nothing is pending after the late flush', ($GLOBALS['mos_shell_poke_late_pending'] ?? true) === false);

    // 3. The fill's announcement: a product filled without a WooCommerce save (a brand-only fill) queues its path.
    $reset_poke();
    $product = get_posts(['post_type' => 'product', 'post_status' => 'publish', 'numberposts' => 1, 'fields' => 'ids', 'orderby' => 'ID', 'order' => 'ASC']);
    $pid = $product ? (int) $product[0] : 0;
    $path = $pid > 0 ? mos_shell_poke_path_of($pid) : null;
    if ($path === null) {
        echo "SKIP the fill announcement: no published product with a storefront path to name\n";
    } else {
        do_action('mos_clean_filled', [$pid]);
        $queued = $GLOBALS['mos_shell_poke']['stale'] ?? [];
        $check('mos_clean_filled queues the filled product\'s path', in_array($path, $queued, true) && ($GLOBALS['mos_shell_poke']['listings'] ?? false) === true,
            json_encode($queued));
        mos_shell_poke_queue([$path], [], true);          // a save already queued the same product
        do_action('mos_clean_filled', [$pid]);
        $queued = $GLOBALS['mos_shell_poke']['stale'] ?? [];
        $check('a product a save and the fill both queued is announced once', count(array_keys($queued, $path, true)) === 1, json_encode($queued));
    }
    $reset_poke();
} finally {
    remove_filter('pre_http_request', $capture, 10);
    $drop_shutdown('mos_clean_flush');
    $drop_shutdown('mos_shell_poke_flush');
    $drop_shutdown('mos_size_shutdown_flush');
    foreach ($saved as $g => $v) { $GLOBALS[$g] = $v; }
    // Section 2 put a late flush on PHP's own shutdown list, which cannot be taken off again: it must find nothing to
    // send when this process exits, after the capture above is gone.
    $GLOBALS['mos_shell_poke'] = null;
}

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
