<?php
/**
 * WordPress-level test for the JWT revocation in ../mos-account-api.php: the Bearer check at
 * determine_current_user (priority 99), the sign-out denylist key, the password-hash fingerprint and the
 * login-rehash alias, and the fingerprint the token gets at sign-in.
 *
 * Read-only and credential-free: every token is for a user id that doesn't exist (999999), lives 60 seconds and is
 * never printed. That user exists only in this process's object cache (no persistent object cache locally: the test
 * refuses to run with one). The denylist and the rehash alias are simulated with pre_transient / get_user_metadata
 * filters, and the wp_set_password hook's writes are short-circuited, so no option, transient or user meta is written.
 * Run (local site): wpms eval-file wp-mu-plugins/tests/mos_account_jwt_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};

if (wp_using_ext_object_cache()) { echo "SKIP: a persistent object cache is active (the fake user would be stored)\n"; return; }
if (!class_exists('\Tmeister\Firebase\JWT\JWT') || !defined('JWT_AUTH_SECRET_KEY')) { echo "SKIP: jwt-authentication plugin or secret missing\n"; return; }

const MOS_TEST_UID = 999999;

/** This plugin's closure on a hook (called directly: core's cookie check at priority 10 would replace the user id). */
$ours_on = static function (string $hook): ?Closure {
    foreach ($GLOBALS['wp_filter'][$hook]->callbacks ?? [] as $cbs) {
        foreach ($cbs as $cb) {
            if ($cb['function'] instanceof Closure && basename((string) (new ReflectionFunction($cb['function']))->getFileName()) === 'mos-account-api.php') {
                return $cb['function'];
            }
        }
    }
    return null;
};
$check('fixture: user 999999 does not exist in the database', !get_userdata(MOS_TEST_UID));

// A user that exists only in this process's cache.
$fake_user = static function (string $hash): void {
    wp_cache_set(MOS_TEST_UID, (object) [
        'ID' => MOS_TEST_UID, 'user_login' => 'mos_jwt_test', 'user_pass' => $hash, 'user_nicename' => 'mos_jwt_test',
        'user_email' => 'mos-jwt-test@example.invalid', 'user_url' => '', 'user_registered' => '2026-01-01 00:00:00',
        'user_activation_key' => '', 'user_status' => '0', 'display_name' => 'mos_jwt_test',
    ], 'users');
};
$hash_a = '$wp$2y$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
$hash_b = '$wp$2y$10$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
$fake_user($hash_a);
$check('fixture: fake user resolves from the cache', get_user_by('id', MOS_TEST_UID) instanceof WP_User);

$sign = static function (array $data, int $exp_in = 60, string $key = JWT_AUTH_SECRET_KEY): string {
    $now = time();
    return \Tmeister\Firebase\JWT\JWT::encode(['iss' => get_bloginfo('url'), 'iat' => $now, 'nbf' => $now, 'exp' => $now + $exp_in, 'data' => $data], $key, 'HS256');
};
$mark_a = mos_jwt_hash_mark($hash_a);
$mark_b = mos_jwt_hash_mark($hash_b);
$token_a = $sign(['user' => ['id' => MOS_TEST_UID], 'mos_pwh' => $mark_a]);

// --- pure helpers ---
$check('hash mark is 32 hex chars, keyed (not the hash)', (bool) preg_match('/^[0-9a-f]{32}$/', $mark_a) && strpos($hash_a, $mark_a) === false);
$check('hash mark differs per hash', $mark_a !== $mark_b);
[$h, $p, $sig] = explode('.', $token_a);
$check('denylist key ignores the signature segment', mos_jwt_denylist_key("$h.$p.$sig") === mos_jwt_denylist_key("$h.$p.AAAA") && mos_jwt_denylist_key("$h.$p.$sig") !== mos_jwt_denylist_key("$h.$p" . 'x.' . $sig));
$check('denylist key is a transient-sized name', strlen(mos_jwt_denylist_key($token_a)) === strlen('mos_jwt_rv_') + 64);

$check('verified claims: a good token', (int) (mos_jwt_verified_claims($token_a)->data->user->id ?? 0) === MOS_TEST_UID);
$check('verified claims: wrong key -> null', mos_jwt_verified_claims($sign(['user' => ['id' => MOS_TEST_UID]], 60, 'not-the-secret-' . wp_generate_password(20, false))) === null);
$check('verified claims: expired -> null', mos_jwt_verified_claims($sign(['user' => ['id' => MOS_TEST_UID]], -120)) === null);
$check('verified claims: garbage -> null', mos_jwt_verified_claims('not.a.jwt') === null && mos_jwt_verified_claims('') === null);
$check('verified claims: tampered payload -> null', mos_jwt_verified_claims($h . '.' . rtrim(strtr(base64_encode('{"data":{"user":{"id":1}},"exp":9999999999}'), '+/', '-_'), '=') . '.' . $sig) === null);

$check('mark valid: current hash', mos_jwt_mark_valid(MOS_TEST_UID, $mark_a));
$check('mark valid: empty mark refused', !mos_jwt_mark_valid(MOS_TEST_UID, ''));
$check('mark valid: another hash refused', !mos_jwt_mark_valid(MOS_TEST_UID, $mark_b));

// Rehash alias (simulated user meta): an old mark is accepted only while the alias points at the current hash.
$alias = null;
$meta = static function ($value, $object_id, $meta_key) use (&$alias) {
    return ((int) $object_id === MOS_TEST_UID && $meta_key === MOS_JWT_REHASH_META && $alias !== null) ? [$alias] : $value;
};
add_filter('get_user_metadata', $meta, 10, 3);
$fake_user($hash_b); // the login-time rehash moved the account from hash A to hash B
$alias = ['from' => $mark_a, 'to' => $mark_b];
$check('alias: old token valid after a login rehash', mos_jwt_mark_valid(MOS_TEST_UID, $mark_a));
$check('alias: new token valid too', mos_jwt_mark_valid(MOS_TEST_UID, $mark_b));
$fake_user('$wp$2y$10$cccccccccccccccccccccccccccccccccccccccccccccccccccccc'); // a later password change
$check('alias: dead once the hash moves on (to != current)', !mos_jwt_mark_valid(MOS_TEST_UID, $mark_a) && !mos_jwt_mark_valid(MOS_TEST_UID, $mark_b));
$fake_user($hash_b);
$alias = ['from' => $mark_b, 'to' => $mark_b];
$check('alias: only its own "from" mark', !mos_jwt_mark_valid(MOS_TEST_UID, $mark_a));
$alias = null;
remove_filter('get_user_metadata', $meta, 10);
$fake_user($hash_a);

// --- the Bearer check at determine_current_user 99, given the user the jwt plugin resolved at 10 ---
$dcu = $ours_on('determine_current_user');
$check('determine_current_user callback found', $dcu instanceof Closure);
if (!$dcu instanceof Closure) { echo "1+ FAILED\n"; return; }
$saved_server = $_SERVER;
$resolve = static function (string $bearer_header, int $resolved = MOS_TEST_UID) use ($dcu): int {
    unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
    if ($bearer_header !== '') { $_SERVER['HTTP_AUTHORIZATION'] = $bearer_header; }
    return (int) $dcu($resolved);
};
$check('bearer: current token keeps the user', $resolve('Bearer ' . $token_a) === MOS_TEST_UID);
$check('bearer: REDIRECT_HTTP_AUTHORIZATION read too', (static function () use ($token_a, $dcu) {
    unset($_SERVER['HTTP_AUTHORIZATION']);
    $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] = 'Bearer ' . $token_a;
    return (int) $dcu(MOS_TEST_UID);
})() === MOS_TEST_UID);
$check('bearer: no header -> untouched (consumer keys, cookies)', $resolve('') === MOS_TEST_UID);
$check('bearer: Basic header -> untouched', $resolve('Basic ' . base64_encode('ck_x:cs_y')) === MOS_TEST_UID);
$check('bearer: no user resolved -> stays 0', $resolve('Bearer ' . $token_a, 0) === 0);
$check('bearer: unverifiable token signs out (fail closed)', $resolve('Bearer not.a.jwt') === 0);
$check('bearer: expired token signs out', $resolve('Bearer ' . $sign(['user' => ['id' => MOS_TEST_UID], 'mos_pwh' => $mark_a], -120)) === 0);
$check('bearer: token without a fingerprint signs out', $resolve('Bearer ' . $sign(['user' => ['id' => MOS_TEST_UID]])) === 0);
$check("bearer: someone else's valid token -> resolved another way, untouched",
    $resolve('Bearer ' . $sign(['user' => ['id' => MOS_TEST_UID + 1], 'mos_pwh' => $mark_a])) === MOS_TEST_UID);

$fake_user($hash_b); // password changed or reset
$check('bearer: token from before a password change signs out', $resolve('Bearer ' . $token_a) === 0);
$fake_user($hash_a);

$denylisted = mos_jwt_denylist_key($token_a);
$deny = static fn () => 1;
add_filter('pre_transient_' . $denylisted, $deny);
$check('bearer: signed-out (denylisted) token signs out', $resolve('Bearer ' . $token_a) === 0);
// php-jwt decodes base64url leniently, so a signature segment with extra padding still verifies: the denylist keys on
// header.payload to cover that.
$reencoded = $h . '.' . $p . '.' . $sig . '=';
$check('bearer: a re-encoded signature verifies (why the key skips it)', mos_jwt_verified_claims($reencoded) !== null);
$check('bearer: re-encoded signature of a signed-out token signs out too', $resolve('Bearer ' . $reencoded) === 0);
remove_filter('pre_transient_' . $denylisted, $deny);
$check('bearer: denylist lifted -> valid again (the filter was the only state)', $resolve('Bearer ' . $token_a) === MOS_TEST_UID);
$_SERVER = $saved_server;

// --- sign-in adds the fingerprint (jwt_auth_token_before_sign) ---
$signed = apply_filters('jwt_auth_token_before_sign', ['data' => ['user' => ['id' => MOS_TEST_UID]]], get_user_by('id', MOS_TEST_UID));
$check('sign-in: token data carries the current fingerprint', ($signed['data']['mos_pwh'] ?? null) === $mark_a);
$unsigned = apply_filters('jwt_auth_token_before_sign', ['data' => ['user' => ['id' => 0]]], null);
$check('sign-in: no user id -> no fingerprint', !isset($unsigned['data']['mos_pwh']));

// --- wp_set_password: records the alias only inside authenticate; any other write drops it (writes intercepted) ---
$writes = [];
$intercept_update = static function ($check, $object_id, $meta_key, $meta_value) use (&$writes) {
    if ((int) $object_id !== MOS_TEST_UID) { return $check; }
    $writes[] = ['update', $meta_key, $meta_value];
    return true; // short-circuit: nothing is written
};
$intercept_delete = static function ($check, $object_id, $meta_key) use (&$writes) {
    if ((int) $object_id !== MOS_TEST_UID) { return $check; }
    $writes[] = ['delete', $meta_key];
    return true;
};
add_filter('update_user_metadata', $intercept_update, 10, 4);
add_filter('delete_user_metadata', $intercept_delete, 10, 3);
// Call only this plugin's wp_set_password callback (other plugins' callbacks could write).
$ours = $ours_on('wp_set_password');
$check('wp_set_password callback found', $ours instanceof Closure);
if ($ours instanceof Closure) {
    $old = new WP_User((object) ['ID' => MOS_TEST_UID, 'user_pass' => $hash_a, 'user_login' => 'mos_jwt_test']);
    $fake_user($hash_b);
    $ours('pw', MOS_TEST_UID, $old); // outside authenticate: a change or reset
    $check('outside authenticate: alias dropped', $writes === [['delete', MOS_JWT_REHASH_META]], json_encode($writes));
    $writes = [];
    $in_auth = static function ($user) use ($ours, $old) { $ours('pw', MOS_TEST_UID, $old); return $user; };
    add_filter('authenticate', $in_auth, 1);
    apply_filters('authenticate', null, '', ''); // only our closure acts on user 999999; core returns null for empty input
    remove_filter('authenticate', $in_auth, 1);
    $check('inside authenticate (login rehash): alias old -> new recorded',
        $writes === [['update', MOS_JWT_REHASH_META, ['from' => $mark_a, 'to' => $mark_b]]], json_encode($writes));
}
remove_filter('update_user_metadata', $intercept_update, 10);
remove_filter('delete_user_metadata', $intercept_delete, 10);
wp_cache_delete(MOS_TEST_UID, 'users');

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
