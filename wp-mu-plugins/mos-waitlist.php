<?php
/**
 * Plugin Name: MOS Waitlist
 * Description: The storefront product page's "Skrá á biðlista": puts an address on the WooCommerce Waitlist plugin's
 *  list for a sold-out product or variation. The plugin's own sign-up is an admin-ajax form with a nonce printed into
 *  its PHP template, which the headless storefront never renders, so these routes call the plugin's
 *  wcwl_add_user_to_waitlist() instead. The plugin keeps the list (post meta on the product or variation) and mails
 *  it when the stock returns. Without the plugin the routes answer 503.
 *
 *  `POST mos/v1/waitlist {email, product_id}`: a visitor's address is not listed yet. It is mailed a link to the
 *  storefront's /bidlisti/stadfesta/?t=<token> (double opt-in: nobody is put on a list by someone else typing their
 *  address), and the answer says `confirm: true`. The token is random, kept two days as a transient under its hash
 *  with the address and the product, and is all the link carries. The plugin has a double opt-in of its own, but
 *  its mail is English and links to the WordPress product page, so this one is sent here, as mos-account-api.php
 *  sends its welcome mail. A signed-in customer (the storefront passes the session's Bearer token on) who gives the
 *  account's own address is listed at once: `confirm: false`.
 *
 *  `POST mos/v1/waitlist/confirm {token}`: lists the address the token was mailed to. The storefront page posts it
 *  when the visitor presses the button there, so a mail scanner opening the link confirms nothing. Once only.
 *
 *  Only a published simple product or variation that is not in stock can be waited for (a variable parent has no
 *  list of its own: each variation has one). Something that can be bought, backorders included, is a 409.
 *
 *  No customer account is made for a visitor's address: the plugin's "create account" option reads 'no' for the
 *  length of the call, whatever is stored. The address alone goes on the list (an address that already belongs to
 *  an account is listed as that account, as the plugin does). The answers are the same for a new address and one
 *  already listed, so the routes do not tell who is waiting for what.
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

// Per clock hour, like mos/v1/newsletter: requests come from the storefront server (which limits each visitor itself
// and forwards no visitor IP), so the per-caller cap is what real visitors share and the store-wide cap bounds
// callers that rotate addresses. Each sign-up mails the address given, so the caps also bound mail to strangers.
// One visitor may wait for a few sizes, hence the slightly roomier address cap.
const MOS_WAITLIST_ADDRESS_CAP   = 5;     // per caller and address, per hour
const MOS_WAITLIST_IP_HOURLY_CAP = 30;    // as mos/v1/newsletter
const MOS_WAITLIST_HOURLY_CAP    = 60;
const MOS_WAITLIST_FAILED = 'Ekki tókst að skrá á biðlista. Reyndu aftur síðar.';
const MOS_WAITLIST_PENDING_SECONDS = 2 * 24 * HOUR_IN_SECONDS;   // how long a confirmation link works

/** Where a pending sign-up is kept: under the token's hash, so the stored key does not open the link. */
function mos_waitlist_pending_key(string $token): string {
    return 'mos_wl_' . hash('sha256', $token);
}

/** Put the address on the product's list. No account is made for it. @return true|WP_Error the plugin's failure, logged */
function mos_waitlist_add(string $email, int $product_id) {
    $no_account = static fn () => 'no';
    add_filter('pre_option_woocommerce_waitlist_create_account', $no_account);
    try {
        $result = wcwl_add_user_to_waitlist($email, $product_id);
    } finally {
        remove_filter('pre_option_woocommerce_waitlist_create_account', $no_account);
    }
    if (is_wp_error($result)) {
        // The plugin's message may quote the address: only its code and the product go to the log.
        error_log(sprintf('[mos-waitlist] sign-up failed for product %d: %s', $product_id, (string) $result->get_error_code()));
        return new WP_Error('mos_waitlist_upstream', MOS_WAITLIST_FAILED, ['status' => 502]);
    }
    return true;   // the plugin answers a sentence either way (added, or already listed); neither is passed on
}

/** The refusal for a product that can't be waited for, as the routes answer it; null when it can. */
function mos_waitlist_refusal_error(int $product_id): ?WP_Error {
    $refusal = mos_waitlist_refusal(wc_get_product($product_id));
    if ($refusal === 409) { return new WP_Error('mos_waitlist_in_stock', 'Varan er til á lager.', ['status' => 409]); }
    if ($refusal !== null) { return new WP_Error('mos_waitlist_no_product', MOS_WAITLIST_FAILED, ['status' => 404]); }
    return null;
}

/**
 * Why a product can't be waited for: null (it can), 404 (nothing the storefront sells under this id) or 409 (it can
 * be bought). @param mixed $product what wc_get_product() gave
 */
function mos_waitlist_refusal($product): ?int {
    if (!is_object($product) || $product->get_status() !== 'publish') { return 404; }
    $type = $product->get_type();
    if ($type === 'variation') {
        $parent = wc_get_product($product->get_parent_id());
        if (!is_object($parent) || $parent->get_status() !== 'publish') { return 404; }
    } elseif ($type !== 'simple') {
        return 404;
    }
    return $product->is_in_stock() ? 409 : null;
}

add_action('rest_api_init', static function (): void {
    register_rest_route('mos/v1', '/waitlist', [
        'methods'             => 'POST',
        'permission_callback' => '__return_true',
        'args'                => ['email' => ['type' => 'string'], 'product_id' => ['type' => 'integer']],   // typed: anything else is a 400 from REST
        'callback'            => 'mos_waitlist_rest',
    ]);
    register_rest_route('mos/v1', '/waitlist/confirm', [
        'methods'             => 'POST',
        'permission_callback' => '__return_true',
        'args'                => ['token' => ['type' => 'string']],
        'callback'            => 'mos_waitlist_confirm_rest',
    ]);
});

/** @return WP_REST_Response|WP_Error */
function mos_waitlist_rest(WP_REST_Request $req) {
    $given = trim((string) $req->get_param('email'));
    $email = sanitize_email($given);
    // sanitize_email() drops characters it does not allow ("jón@x.is" → "jn@x.is"): that is someone else's address.
    if ($email === '' || $email !== $given || !is_email($email)) {
        return new WP_Error('mos_waitlist_email', 'Netfangið er ekki gilt.', ['status' => 400]);
    }
    $product_id = (int) $req->get_param('product_id');
    if ($product_id <= 0) {
        return new WP_Error('mos_waitlist_product', MOS_WAITLIST_FAILED, ['status' => 400]);
    }
    if (!function_exists('wcwl_add_user_to_waitlist') || !function_exists('wc_get_product')) {
        return new WP_Error('mos_waitlist_not_configured', MOS_WAITLIST_FAILED, ['status' => 503]);
    }

    // The caps are checked before the product is looked up, and counted only for a sign-up that goes through.
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $hour = intdiv(time(), HOUR_IN_SECONDS);
    $caps = [
        'mos_rl_wait_' . md5($ip . '|' . strtolower($email)) . '_' . $hour => MOS_WAITLIST_ADDRESS_CAP,
        'mos_rl_wait_ip_' . md5($ip) . '_' . $hour                         => MOS_WAITLIST_IP_HOURLY_CAP,
        'mos_rl_wait_all_' . $hour                                         => MOS_WAITLIST_HOURLY_CAP,
    ];
    foreach ($caps as $key => $cap) {
        if ((int) get_transient($key) >= $cap) {
            return new WP_Error('mos_rate_limited', 'Of margar skráningar. Reyndu aftur síðar.', ['status' => 429]);
        }
    }
    $refused = mos_waitlist_refusal_error($product_id);
    if ($refused !== null) { return $refused; }
    $product = wc_get_product($product_id);

    // A signed-in customer giving the account's own address has nothing left to confirm.
    $user = wp_get_current_user();
    $own = (int) $user->ID > 0 && strcasecmp((string) $user->user_email, $email) === 0;
    $base = function_exists('mos_headless_target_base') ? mos_headless_target_base() : '';
    if (!$own && $base === '') {
        error_log('[mos-waitlist] no storefront address for the confirmation link (MOS_STOREFRONT_URL)');
        return new WP_Error('mos_waitlist_not_configured', MOS_WAITLIST_FAILED, ['status' => 503]);
    }
    $count = static function () use ($caps): void {
        foreach ($caps as $key => $cap) { set_transient($key, (int) get_transient($key) + 1, HOUR_IN_SECONDS); }
    };

    if ($own) {
        $added = mos_waitlist_add((string) $user->user_email, $product_id);
        if (is_wp_error($added)) { return $added; }
        $count();
        return new WP_REST_Response(['ok' => true, 'confirm' => false], 200);
    }

    $token = bin2hex(random_bytes(24));
    set_transient(mos_waitlist_pending_key($token), ['email' => $email, 'product_id' => $product_id], MOS_WAITLIST_PENDING_SECONDS);
    $shop = esc_html(wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES));
    $body = '<p>Hæ,</p>'
        . '<p>Þú baðst um að fá póst þegar <strong>' . esc_html($product->get_name()) . '</strong> kemur aftur á lager hjá ' . $shop . '. Staðfestu skráninguna með því að smella á hlekkinn hér fyrir neðan:</p>'
        . '<p><a href="' . esc_url($base . '/bidlisti/stadfesta/?t=' . $token) . '">Staðfesta skráningu á biðlista</a></p>'
        . '<p>Hlekkurinn gildir í tvo daga. Ef þú baðst ekki um þetta geturðu hunsað þennan póst og ekkert verður skráð.</p>';
    $mailer = WC()->mailer();
    if (!$mailer->send($email, 'Staðfestu skráningu á biðlista', $mailer->wrap_message('Staðfestu skráninguna', $body))) {
        delete_transient(mos_waitlist_pending_key($token));
        error_log(sprintf('[mos-waitlist] confirmation mail for product %d not sent: the mailer refused it', $product_id));
        return new WP_Error('mos_waitlist_mail', MOS_WAITLIST_FAILED, ['status' => 502]);
    }
    $count();
    // The same answer whether or not the address is already listed.
    return new WP_REST_Response(['ok' => true, 'confirm' => true], 200);
}

/** @return WP_REST_Response|WP_Error */
function mos_waitlist_confirm_rest(WP_REST_Request $req) {
    $token = $req->get_param('token');
    $pending = is_string($token) && preg_match('/\A[0-9a-f]{48}\z/', $token) ? get_transient(mos_waitlist_pending_key($token)) : false;
    if (!is_array($pending) || !isset($pending['email'], $pending['product_id'])) {
        return new WP_Error('mos_waitlist_token', 'Hlekkurinn er útrunninn eða hefur þegar verið notaður.', ['status' => 404]);
    }
    if (!function_exists('wcwl_add_user_to_waitlist') || !function_exists('wc_get_product')) {
        return new WP_Error('mos_waitlist_not_configured', MOS_WAITLIST_FAILED, ['status' => 503]);
    }
    $refused = mos_waitlist_refusal_error((int) $pending['product_id']);
    if ($refused !== null) {
        delete_transient(mos_waitlist_pending_key($token));   // nothing left to wait for
        return $refused;
    }
    $added = mos_waitlist_add((string) $pending['email'], (int) $pending['product_id']);
    if (is_wp_error($added)) { return $added; }   // the link is kept: pressing again may work
    delete_transient(mos_waitlist_pending_key($token));
    return new WP_REST_Response(['ok' => true], 200);
}
