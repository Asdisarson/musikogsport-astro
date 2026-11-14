<?php
/**
 * Plugin Name: MOS Account API
 * Description: Password-reset and account endpoints for the headless /min-sida/ account area. WordPress core
 *  has no REST route for these. Responses are deliberately generic, so they reveal nothing
 *  about which accounts exist.
 *   - POST /wp-json/mos/v1/account/lost-password   { user_login }
 *   - POST /wp-json/mos/v1/account/reset-password  { id, key, password }
 *   - POST /wp-json/mos/v1/account/logout  (Bearer token) — revokes that token until it expires.
 *   - POST /wp-json/mos/v1/account/from-order      { order_id, order_key } — the checkout's "Stofna aðgang" box:
 *     an account on a fresh guest order's e-mail, with a mail to choose a password.
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
 * POST mos/v1/account/from-order {order_id, order_key}: the checkout's "Stofna aðgang" box.
 * The storefront calls it right after a guest order is placed. The order key is the proof: only the browser that
 * placed the order (and the storefront) hold it. The account is made on the order's own e-mail, the order goes on
 * it with its addresses, and the customer gets a mail with a link to choose a password (the storefront's
 * /min-sida/lost-password/?key=…&id=…, the same page WooCommerce's reset mail opens). Nothing is asked of the
 * shopper here and no password travels.
 *   - A new account answers with a sign-in token: the storefront signs that browser in, as WooCommerce's checkout
 *     does. Whoever placed the order can therefore open the new account (which holds only that order) until the
 *     owner of the mailbox chooses a password; that revokes the token.
 *   - An e-mail that already has an account: nothing happens and no token is given. The order is NOT put on that
 *     account: whoever typed the address is not proven to own it. (The caller, who holds the order key, can tell
 *     the two cases apart, as with any checkout that creates accounts.)
 *   - Only an order with no customer yet, placed within MOS_ACCOUNT_ORDER_WINDOW.
 * --------------------------------------------------------------------- */

const MOS_ACCOUNT_ORDER_WINDOW = 2 * HOUR_IN_SECONDS;

add_action('rest_api_init', static function () {
    register_rest_route('mos/v1', '/account/from-order', [
        'methods'             => 'POST',
        'permission_callback' => '__return_true',
        'args'                => [
            'order_id'  => ['required' => true, 'type' => 'integer'],
            'order_key' => ['required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field'],
        ],
        'callback'            => 'mos_account_from_order',
    ]);
});

/** Why an order cannot get a new account, or null when it can. Pure. */
function mos_account_order_problem(int $customer_id, int $created, int $now, string $email, bool $email_taken): ?string {
    if ($customer_id > 0) { return 'has-customer'; }
    if ($created <= 0 || $now - $created > MOS_ACCOUNT_ORDER_WINDOW) { return 'too-old'; }
    if ($email === '') { return 'no-email'; }
    return $email_taken ? 'email-taken' : null;
}

/**
 * A sign-in token for a customer, in the shape the jwt-authentication plugin issues (same claims, key, algorithm
 * and filters, so the storefront and the revocation checks below treat it as any other): the new customer is
 * signed in on the device that placed the order, as WooCommerce's own checkout does. It carries the password-hash
 * fingerprint like every token, so it stops working the moment the customer chooses a password through the mail,
 * and they sign in with that. Null when the plugin or its key is missing.
 */
function mos_account_issue_token(WP_User $user): ?string {
    if (!defined('JWT_AUTH_SECRET_KEY') || !class_exists('\Tmeister\Firebase\JWT\JWT')) { return null; }
    $now = time();
    $claims = [
        'iss'  => get_bloginfo('url'),
        'iat'  => $now,
        'nbf'  => apply_filters('jwt_auth_not_before', $now, $now),
        'exp'  => apply_filters('jwt_auth_expire', $now + (DAY_IN_SECONDS * 7), $now),
        'data' => ['user' => ['id' => $user->ID]],
    ];
    try {
        return \Tmeister\Firebase\JWT\JWT::encode(
            apply_filters('jwt_auth_token_before_sign', $claims, $user),
            JWT_AUTH_SECRET_KEY,
            (string) apply_filters('jwt_auth_algorithm', 'HS256')
        );
    } catch (\Throwable $e) {
        return null;
    }
}

/** The link in the welcome mail: the storefront's new-password page for this key and user. */
function mos_account_password_url(string $key, int $user_id): string {
    $base = function_exists('mos_headless_target_base') && mos_headless_target_base() !== '' ? mos_headless_target_base() : untrailingslashit(home_url());
    return add_query_arg(['key' => rawurlencode($key), 'id' => $user_id], $base . '/min-sida/lost-password/');
}

function mos_account_from_order(WP_REST_Request $req) {
    if (!mos_account_rate_ok('fromorder')) {
        return new WP_Error('mos_rate_limited', 'Of margar beiðnir. Reyndu aftur síðar.', ['status' => 429]);
    }
    $order = function_exists('wc_get_order') ? wc_get_order(absint($req->get_param('order_id'))) : false;
    $key = (string) $req->get_param('order_key');
    if (!$order instanceof WC_Order || $key === '' || !hash_equals((string) $order->get_order_key(), $key)) {
        return new WP_Error('mos_account_order', 'Pöntun fannst ekki.', ['status' => 400]);
    }
    $ok = rest_ensure_response(['ok' => true]); // the answer when no account is made
    $email = sanitize_email((string) $order->get_billing_email());
    $created = $order->get_date_created() ? $order->get_date_created()->getTimestamp() : 0;
    $taken = $email !== '' && is_email($email) ? (bool) email_exists($email) : true;
    if (mos_account_order_problem((int) $order->get_customer_id(), $created, time(), is_email($email) ? $email : '', $taken) !== null) {
        return $ok;
    }

    // WooCommerce's own "new account" mail is switched off for this one account: its link is not a storefront page.
    $no_mail = static fn () => false;
    add_filter('woocommerce_email_enabled_customer_new_account', $no_mail, 99);
    $user_id = wc_create_new_customer(
        $email,
        wc_create_new_customer_username($email, ['first_name' => $order->get_billing_first_name(), 'last_name' => $order->get_billing_last_name()]),
        wp_generate_password(32, true, true), // never sent anywhere: the customer chooses their own through the link
        ['first_name' => $order->get_billing_first_name(), 'last_name' => $order->get_billing_last_name()]
    );
    remove_filter('woocommerce_email_enabled_customer_new_account', $no_mail, 99);
    if (is_wp_error($user_id)) {
        error_log('[mos-account] account for order ' . $order->get_id() . ' not created: ' . $user_id->get_error_code());
        return new WP_Error('mos_account_failed', 'Ekki tókst að stofna aðgang.', ['status' => 500]);
    }

    // From here the account exists, and asking again finds the e-mail taken and does nothing: so every later step
    // is attempted whatever the one before it did, and a failure is logged, never thrown.
    try {
        $order->set_customer_id((int) $user_id);
        $order->save();
    } catch (Throwable $e) {
        error_log('[mos-account] order ' . $order->get_id() . ' not put on its new account: ' . get_class($e));
    }
    try {
        $customer = new WC_Customer((int) $user_id);
        foreach (['billing', 'shipping'] as $type) {
            foreach ($order->get_address($type) as $field => $value) {
                $setter = "set_{$type}_{$field}";
                // The e-mail is the account's own already; WooCommerce's setter throws on a value it dislikes.
                if ($field !== 'email' && is_callable([$customer, $setter])) { $customer->{$setter}($value); }
            }
        }
        $customer->save();
    } catch (Throwable $e) {
        error_log('[mos-account] addresses of order ' . $order->get_id() . ' not saved on its new account: ' . get_class($e));
    }

    $user = get_user_by('id', (int) $user_id);
    // The answer for an account made just now: the sign-in token for this browser (see mos_account_issue_token).
    $token = $user instanceof WP_User ? mos_account_issue_token($user) : null;
    $made = rest_ensure_response($token !== null ? ['ok' => true, 'token' => $token] : ['ok' => true]);
    if ($token === null) { error_log('[mos-account] new account for order ' . $order->get_id() . ' not signed in: no token could be issued'); }

    $reset = $user instanceof WP_User ? get_password_reset_key($user) : new WP_Error('no_user');
    if (is_wp_error($reset)) {
        // The account exists; the customer can still ask for a link at /min-sida/lost-password/.
        error_log('[mos-account] welcome mail for order ' . $order->get_id() . ' not sent: ' . $reset->get_error_code());
        return $made;
    }
    $url = mos_account_password_url($reset, (int) $user_id);
    $body = '<p>Hæ ' . esc_html($order->get_billing_first_name()) . ',</p>'
        . '<p>Aðgangurinn þinn hjá ' . esc_html(wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES)) . ' hefur verið stofnaður. Veldu lykilorð með því að smella á hlekkinn hér fyrir neðan:</p>'
        . '<p><a href="' . esc_url($url) . '">Velja lykilorð</a></p>'
        . '<p>Á „Mín síða“ sérðu pantanirnar þínar og vistuð heimilisföng. Ef þú baðst ekki um aðgang geturðu hunsað þennan póst.</p>';
    $mailer = WC()->mailer();
    if (!$mailer->send($email, 'Aðgangurinn þinn hefur verið stofnaður', $mailer->wrap_message('Velkomin(n)', $body))) {
        error_log('[mos-account] welcome mail for order ' . $order->get_id() . ' not sent: the mailer refused it');
    }
    return $made;
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
