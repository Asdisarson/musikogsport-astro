<?php
/**
 * Unit test for ../headless-bridge-local.php's environment guard (no WordPress needed): outside a
 * `local` environment the shim must add no hook and must not define MOS_DEV_ASTRO_URL (headless mode
 * would redirect the whole site to localhost); on `local` it keeps working as before.
 *
 * Run: php wp-mu-plugins/tests/headless_bridge_local_test.php   (exit code 0 = all pass)
 * Each environment is loaded in its own PHP process (the shim can be included once per process).
 */

declare(strict_types=1);

if (($argv[1] ?? '') === '--load') {
    // Child: load the shim under the given environment type and report what it registered.
    define('ABSPATH', __DIR__ . '/');
    $GLOBALS['hooks'] = [];
    function add_filter(string $hook, $cb, int $prio = 10, int $args = 1): void { $GLOBALS['hooks'][] = "$hook@$prio"; }
    function add_action(string $hook, $cb, int $prio = 10, int $args = 1): void { $GLOBALS['hooks'][] = "$hook@$prio"; }
    function wp_get_environment_type(): string { return (string) $GLOBALS['argv'][2]; }
    require __DIR__ . '/../headless-bridge-local.php';
    echo json_encode(['hooks' => $GLOBALS['hooks'], 'const' => defined('MOS_DEV_ASTRO_URL') ? MOS_DEV_ASTRO_URL : null]);
    exit(0);
}

$fail = 0;
$pass = 0;
function check(string $name, bool $ok, string $detail = ''): void {
    global $fail, $pass;
    if ($ok) { $pass++; return; }
    $fail++;
    echo "FAIL $name $detail\n";
}

$load = static function (string $env): array {
    $out = shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --load ' . escapeshellarg($env) . ' 2>&1');
    $data = json_decode((string) $out, true);
    return is_array($data) ? $data : ['error' => (string) $out];
};

foreach (['production', 'staging', 'development', ''] as $env) {
    $got = $load($env);
    check("$env: no hooks", ($got['hooks'] ?? null) === [], json_encode($got));
    check("$env: MOS_DEV_ASTRO_URL not defined", array_key_exists('const', $got) && $got['const'] === null, json_encode($got));
}

$local = $load('local');
check('local: MOS_DEV_ASTRO_URL defined', ($local['const'] ?? null) === 'http://localhost:10026', json_encode($local));
check('local: all five hooks', ($local['hooks'] ?? null) === [
    'determine_current_user@14', 'determine_current_user@16', 'allowed_redirect_hosts@10',
    'woocommerce_get_return_url@20', 'template_redirect@0',
], json_encode($local));

echo ($fail === 0 ? "OK" : "FAILED") . " — $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
