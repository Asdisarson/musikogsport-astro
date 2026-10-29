<?php
/**
 * Plugin Name: MOS Account API
 * Description: Password-reset endpoints for the headless /min-sida/ account area. WordPress core
 *  has no REST route for these. Responses are deliberately generic, so they reveal nothing
 *  about which accounts exist.
 *   - POST /wp-json/mos/v1/account/lost-password   { user_login }
 *   - POST /wp-json/mos/v1/account/reset-password  { id, key, password }
 *   - POST /wp-json/mos/v1/account/logout  (Bearer token) — revokes that token until it expires.
 *  The reset email is WooCommerce's own ("Customer reset password"), whose link points at
 *  /min-sida/lost-password/?key=…&id=… — WP headless mode hands that URL to the storefront.
 *  Tokens issued before a password change or reset are refused too (bound to the stored hash).
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

// Every request arrives from the storefront server, so REMOTE_ADDR is the same for all shoppers: the
// per-visitor limits live in the storefront (src/pages/api/account/*). This is a store-wide safety net.
const MOS_RESET_RATE_LIMIT  = 60;                    // requests …
const MOS_RESET_RATE_WINDOW = 15 * MINUTE_IN_SECONDS; // … per caller per window
const MOS_MIN_PASSWORD_LEN  = 8;

add_action('rest_api_init', static function () {
    register_rest_route('mos/v1', '/account/lost-password', [
        'methods'             => 'POST',
        'permission_callback' => '__return_true',
        'args'                => [
            'user_login' => ['required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field'],
        ],
        'callback'            => 'mos_account_lost_password',
    ]);
    register_rest_route('mos/v1', '/account/reset-password', [
        'methods'             => 'POST',
        'permission_callback' => '__return_true',
        'args'                => [
            'id'       => ['required' => true, 'type' => 'integer'],
            'key'      => ['required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field'],
            'password' => ['required' => true, 'type' => 'string'],
        ],
        'callback'            => 'mos_account_reset_password',
    ]);
});

/**
 * Per-IP limiter. Each accepted request restarts the window (set_transient renews the expiry), so a caller
 * is let through again MOS_RESET_RATE_WINDOW after its last accepted request. Returns false once the caller
 * is over the limit.
 */
function mos_account_rate_ok(string $bucket): bool {
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $key = 'mos_rl_' . $bucket . '_' . md5($ip);
    $hits = (int) get_transient($key);
    if ($hits >= MOS_RESET_RATE_LIMIT) { return false; }
    set_transient($key, $hits + 1, MOS_RESET_RATE_WINDOW);
    return true;
}

function mos_account_lost_password(WP_REST_Request $req) {
    if (!mos_account_rate_ok('lost')) {
        return new WP_Error('mos_rate_limited', 'Of margar beiðnir. Reyndu aftur síðar.', ['status' => 429]);
    }
    $login = trim((string) $req->get_param('user_login'));
    $user = $login === '' ? false : (is_email($login) ? get_user_by('email', $login) : get_user_by('login', $login));
    if ($user instanceof WP_User) {
        $key = get_password_reset_key($user);
        if (!is_wp_error($key) && function_exists('WC')) {
            WC()->mailer(); // registers WC_Email_Customer_Reset_Password on the notification hook
            do_action('woocommerce_reset_password_notification', $user->user_login, $key);
        }
    }
    // Same answer whether or not the account exists.
    return rest_ensure_response(['ok' => true]);
}

function mos_account_reset_password(WP_REST_Request $req) {
    if (!mos_account_rate_ok('reset')) {
        return new WP_Error('mos_rate_limited', 'Of margar beiðnir. Reyndu aftur síðar.', ['status' => 429]);
    }
    $invalid = new WP_Error('mos_reset_invalid', 'Hlekkurinn er ógildur eða útrunninn.', ['status' => 400]);
    $user = get_user_by('id', absint($req->get_param('id')));
    if (!$user instanceof WP_User) { return $invalid; }

    $checked = check_password_reset_key((string) $req->get_param('key'), $user->user_login);
    if (is_wp_error($checked)) { return $invalid; }

    $password = (string) $req->get_param('password');
    if (strlen($password) > 1000) { // wp_hash_password() refuses > 4096 bytes; the storefront allows 200 characters
        return new WP_Error('mos_reset_long', 'Lykilorðið má mest vera 200 stafir.', ['status' => 400]);
    }
    if (mb_strlen(trim($password)) < MOS_MIN_PASSWORD_LEN) {
        return new WP_Error('mos_reset_weak', 'Lykilorð þarf að vera minnst ' . MOS_MIN_PASSWORD_LEN . ' stafir.', ['status' => 400]);
    }
    reset_password($checked, $password); // also invalidates the key and the user's sessions
    return rest_ensure_response(['ok' => true]);
}

/* ------------------------------------------------------------------------
 * JWT revocation. The jwt-authentication plugin's tokens live 7 days and the plugin has no logout,
 * so the storefront's sign-out and password changes would leave old tokens working. After the plugin
 * resolves a user from a Bearer token (determine_current_user, priority 10) this runs at 99:
 *   - The token is read and verified exactly as the plugin does (sanitize_text_field + sscanf, then
 *     php-jwt), so no header shape the plugin accepts can skip the checks. A Bearer header that resolved
 *     a user but can't be verified here signs the request out (fail closed).
 *   - Signed-out tokens are denylisted by header.payload until they expire. That is the part the
 *     signature fixes; php-jwt accepts re-encoded signature segments, so the whole string isn't unique.
 *   - Tokens carry a keyed fingerprint of the stored password hash (data.mos_pwh: HMAC with the site's auth
 *     salt). Any hash write refuses earlier tokens: a password change or reset (even to the same password,
 *     which gets a new bcrypt salt), a direct database reset (with a persistent object cache, once the
 *     user's cache entry is flushed), or a rotated auth salt. The one exception is
 *     WordPress's login-time rehash (same password, new hash, inside `authenticate`): it records a one-step
 *     alias from the old fingerprint to the new one, valid only while that new hash stands, so signing in
 *     on one device doesn't sign out the others. Tokens without a fingerprint are refused.
 * Requests without a Bearer header (WooCommerce consumer keys, wp-admin cookies) are untouched.
 * --------------------------------------------------------------------- */

/** The Bearer token as the jwt-auth plugin reads it (same header order and parsing), or ''. */
function mos_jwt_bearer(): string {
    // Unslashed like the plugin's own read, so both see the identical string.
    $header = !empty($_SERVER['HTTP_AUTHORIZATION']) ? sanitize_text_field($_SERVER['HTTP_AUTHORIZATION']) : '';
    if ($header === '' && !empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $header = sanitize_text_field($_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
    }
    if ($header === '' || strpos($header, 'Bearer') !== 0) { return ''; }
    $parsed = sscanf($header, 'Bearer %s');
    return is_array($parsed) && is_string($parsed[0] ?? null) ? $parsed[0] : '';
}

/** The token's verified claims (signature, expiry: php-jwt as the plugin uses it), or null. */
function mos_jwt_verified_claims(string $token): ?object {
    if ($token === '' || !defined('JWT_AUTH_SECRET_KEY') || !class_exists('\Tmeister\Firebase\JWT\JWT')) { return null; }
    try {
        $claims = \Tmeister\Firebase\JWT\JWT::decode(
            $token,
            new \Tmeister\Firebase\JWT\Key(JWT_AUTH_SECRET_KEY, (string) apply_filters('jwt_auth_algorithm', 'HS256'))
        );
    } catch (\Throwable $e) {
        return null;
    }
    return is_object($claims) ? $claims : null;
}

function mos_jwt_denylist_key(string $token): string {
    $parts = explode('.', $token);
    return 'mos_jwt_rv_' . hash('sha256', $parts[0] . '.' . ($parts[1] ?? ''));
}

const MOS_JWT_REHASH_META = 'mos_jwt_rehash';

/** A keyed fingerprint of a stored password hash (never the hash itself). */
function mos_jwt_hash_mark(string $hash): string {
    return substr(wp_hash($hash, 'auth', 'sha256'), 0, 32);
}

function mos_jwt_current_mark(int $user_id): string {
    $user = get_user_by('id', $user_id); // fresh: wp_set_password() clears the user cache
    return $user ? mos_jwt_hash_mark((string) $user->user_pass) : '';
}

add_filter('jwt_auth_token_before_sign', static function ($token) {
    $id = (int) ($token['data']['user']['id'] ?? 0);
    if ($id > 0) {
        // Read after wp_authenticate(), which may just have rehashed the password.
        $token['data']['mos_pwh'] = mos_jwt_current_mark($id);
    }
    return $token;
});

// WordPress rehashes a password only while authenticating (wp_authenticate_username_password /
// _email_password call wp_set_password(), which fires this action after storing the new hash). There the
// sessions bound to the old hash are carried over. Any other password write (a change or reset, even to
// the same password; wp_update_user fires this before its own write) drops the alias, so only tokens for
// the current hash work.
add_action('wp_set_password', static function ($password, $user_id, $old_user_data = null) {
    $uid = (int) $user_id;
    if (doing_filter('authenticate') && $old_user_data instanceof WP_User) {
        update_user_meta($uid, MOS_JWT_REHASH_META, [
            'from' => mos_jwt_hash_mark((string) $old_user_data->user_pass),
            'to'   => mos_jwt_current_mark($uid),
        ]);
        return;
    }
    delete_user_meta($uid, MOS_JWT_REHASH_META);
}, 10, 3);

/** Whether a token's fingerprint still matches the account's password (or the hash it was rehashed to). */
function mos_jwt_mark_valid(int $user_id, string $mark): bool {
    if ($mark === '') { return false; }
    $current = mos_jwt_current_mark($user_id);
    if (hash_equals($current, $mark)) { return true; }
    $alias = get_user_meta($user_id, MOS_JWT_REHASH_META, true);
    return is_array($alias)
        && hash_equals((string) ($alias['to'] ?? ''), $current)
        && hash_equals((string) ($alias['from'] ?? ''), $mark);
}

add_filter('determine_current_user', static function ($user_id) {
    if (!$user_id) { return $user_id; }
    $token = mos_jwt_bearer();
    if ($token === '') { return $user_id; }
    $claims = mos_jwt_verified_claims($token);
    if (!$claims) { return 0; }
    // A valid token for someone else means the user was resolved another way (wp-admin cookie): not ours.
    if ((int) ($claims->data->user->id ?? 0) !== (int) $user_id) { return $user_id; }
    if (get_transient(mos_jwt_denylist_key($token)) !== false) { return 0; }
    return mos_jwt_mark_valid((int) $user_id, (string) ($claims->data->mos_pwh ?? '')) ? $user_id : 0;
}, 99);

add_action('rest_api_init', static function () {
    register_rest_route('mos/v1', '/account/logout', [
        'methods'             => 'POST',
        'permission_callback' => 'is_user_logged_in', // the Bearer token resolved (and isn't revoked yet)
        'callback'            => static function () {
            $token = mos_jwt_bearer();
            $claims = mos_jwt_verified_claims($token);
            if ($claims) {
                set_transient(mos_jwt_denylist_key($token), 1, max(MINUTE_IN_SECONDS, (int) ($claims->exp ?? 0) - time()));
            }
            return ['ok' => true];
        },
    ]);
});
