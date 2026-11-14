<?php
/**
 * Plugin Name: MOS Headless Bridge
 * Description: Glue between the Astro storefront and WordPress/WooCommerce:
 *  - keeps WC's order-received return URL on live's /gera-upp/order-received/<id>/ (the key is dropped
 *    from Straumur returns; the storefront reads it from its checkout cookie)
 *  - sends Straumur fail/cancel returns to the checkout, /gera-upp/?straumurStatus=failed
 *  - sends a return the gateway refuses (nonce) to the checkout notice instead of a raw error page
 *  - lets Valitor confirm the payment its return carries, then sends the shopper on to the storefront's receipt
 *
 * Author: Músík og Sport
 * Version: 1.1.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

/* ------------------------------------------------------------------------
 * 1. Return URL after payment → the storefront's /gera-upp/order-received/<id>/?key=
 *    (WooCommerce's own endpoint shape, as on live)
 * --------------------------------------------------------------------- */

add_filter('woocommerce_get_return_url', function ($url, $order) {
    if (!$order instanceof WC_Order) { return $url; }
    return home_url(add_query_arg(
        ['key' => $order->get_order_key()],
        '/gera-upp/order-received/' . $order->get_id() . '/'
    ));
}, 10, 2);

/** Whether a redirect target is one of the storefront's own payment-outcome URLs. */
function mos_is_storefront_outcome(string $location): bool {
    $path  = (string) (wp_parse_url($location, PHP_URL_PATH) ?? '');
    $query = (string) (wp_parse_url($location, PHP_URL_QUERY) ?? '');
    if (preg_match('#^/gera-upp/order-received/\d+/?$#', $path)) {
        return true;
    }
    return rtrim($path, '/') === '/gera-upp' && strpos($query, 'straumurStatus=') !== false;
}

/* ------------------------------------------------------------------------
 * 2. Straumur cancel/error redirect (returns to home_url('/') with ?straumurStatus=...)
 * --------------------------------------------------------------------- */

/**
 * Where a ?straumurStatus= return bounces to: the storefront checkout with the status and, as a support breadcrumb, a
 * numeric order_id. Nothing else from the query is carried over (MU-08: `$_GET` arrives slash-escaped, and any other
 * parameter would be reflected into the redirect). Null for anything but a known failure status.
 */
function mos_straumur_bounce_target(array $get): ?string {
    $status = is_string($get['straumurStatus'] ?? null) ? sanitize_text_field(wp_unslash($get['straumurStatus'])) : '';
    if (!in_array($status, ['canceled', 'failed', 'error'], true)) { return null; }
    $args = ['straumurStatus' => $status];
    $order_id = is_string($get['order_id'] ?? null) ? absint(wp_unslash($get['order_id'])) : 0;
    if ($order_id > 0) { $args['order_id'] = $order_id; }
    return home_url(add_query_arg($args, '/gera-upp/'));
}

add_action('template_redirect', function () {
    if (empty($_GET['straumurStatus']) || is_admin()) { return; }
    // Already on the checkout path: headless mode hands it to the storefront — bail instead of looping.
    if (strpos((string) ($_SERVER['REQUEST_URI'] ?? ''), '/gera-upp') === 0) { return; }
    $target = mos_straumur_bounce_target($_GET);
    if ($target !== null) {
        wp_safe_redirect($target);
        exit;
    }
}, 1); // before headless mode (5) forwards the request to the storefront

/* ------------------------------------------------------------------------
 * 2b. Straumur failure/cancel returns → the storefront checkout (/gera-upp/?straumurStatus=failed)
 *     Every non-success branch of the gateway's process_return() redirects
 *     to the classic order-pay / cart pages on the WP origin — pages a
 *     headless shopper must never land on. Those redirects go through
 *     wp_safe_redirect(), which applies the 'wp_redirect' filter, so we
 *     rewrite them here, scoped strictly to the Straumur wc-api return
 *     request. The success branch reaches /gera-upp/order-received/ via the
 *     woocommerce_get_return_url filter above, with its order key removed below.
 * --------------------------------------------------------------------- */

/*
 * Gating note — do NOT key this filter off $_GET['wc-api'].
 *
 * 'wp_redirect' fires on EVERY redirect in EVERY request, and $_GET is fully
 * attacker-controlled, so a $_GET-based guard lets any unauthenticated request
 * that merely carries ?wc-api=straumur (e.g. wp-login.php's nonce-free
 * action=rp branch, or a redirect_canonical bounce) run this filter body —
 * without ever passing the gateway's straumur_nonce check. Combined with an
 * order_key lookup that trusted $_GET['order_id'], that turned the key into an
 * unauthenticated enumeration oracle over the whole order table — and order_key
 * is the ONLY authorization secret guarding /api/order.
 *
 * So: gate on having actually entered the gateway's own return handler, and
 * don't emit order_key at all — the checkout reads only straumurStatus.
 */
// Known limitation of the Straumur plugin, deliberately not patched here: its return handler takes the
// checkoutReference from the URL and saves that session's payfacReference on the order without checking the
// session belongs to the order. Refusing a reference that differs from the stored one is NOT a fix: the
// gateway stores the first return's reference even for a failed attempt, and a retry reuses the pending
// order with a new session, so a genuine paid retry would be refused (and look unpaid). The real fix is to
// bind the session to the order through the status response's merchant reference, which needs Straumur's
// API documented or observed in test mode first.
add_action('woocommerce_api_straumur', static function () {
    $GLOBALS['mos_in_straumur_return'] = true;
}, 1);

/* ------------------------------------------------------------------------
 * 2c. A Straumur return the gateway refuses outright (a missing or expired nonce: its process_return() calls
 *     wp_die() before reading or changing the order) lands on the storefront checkout's careful notice instead of a
 *     raw WordPress error page with a 500 (MU-09). Nothing about the payment changes: the gateway has already
 *     declined to process the return, and the notice says a payment, if made, is confirmed by e-mail. Scoped like
 *     the redirect rewrite below: only inside the gateway's own return handler, HTML requests only.
 * --------------------------------------------------------------------- */

/** The checkout notice a refused return is sent to. */
function mos_straumur_return_die_target(): string {
    return home_url('/gera-upp/?straumurStatus=error');
}

/** wp_die() replacement inside the Straumur return handler: redirect to the checkout notice. */
function mos_straumur_return_die($message = '', $title = '', $args = []): void {
    if (!headers_sent()) {
        wp_safe_redirect(mos_straumur_return_die_target());
        exit;
    }
    _default_wp_die_handler($message, $title, $args);
}

add_filter('wp_die_handler', static function ($handler) {
    return empty($GLOBALS['mos_in_straumur_return']) ? $handler : 'mos_straumur_return_die';
}, 20);

add_filter('wp_redirect', function ($location) {
    if (empty($GLOBALS['mos_in_straumur_return'])) {
        return $location;
    }
    // Storefront outcome URLs pass through, minus the order key: the gateway's success branch trusts the
    // checkoutReference in the URL, so a replayed paid reference with the shared nonce could name any
    // order. The thank-you page recovers the key from the httpOnly cookie set at checkout in the shopper's
    // own browser. Anything else under /gera-upp/ (order-pay, the classic checkout) is a WP page a headless
    // shopper must never land on, so it is rewritten below.
    if (mos_is_storefront_outcome((string) $location)) {
        return remove_query_arg('key', (string) $location);
    }
    // Never pass the gateway's order-pay URL through, even for invoice (order-pay) payments: it carries the
    // order key, the return nonce is the same for every logged-out visitor, and an empty checkoutReference
    // makes the gateway redirect to ANY order's pay URL. The gateway stores the reference only on the first
    // return, so nothing here can tell a genuine return from a forged one. An invoice customer whose card
    // fails reopens the emailed payment link (DEPLOY.md).
    // The gateway has no cancel-specific branch we can observe here; label
    // everything 'failed' — the checkout notice covers both outcomes.
    $args = ['straumurStatus' => 'failed'];
    // order_id is a non-secret support breadcrumb; order_key is deliberately omitted.
    if (isset($_GET['order_id'])) {
        $order_id = absint(wp_unslash($_GET['order_id']));
        if ($order_id > 0) {
            $args['order_id'] = $order_id;
        }
    }
    return home_url(add_query_arg($args, '/gera-upp/'));
});

/* ------------------------------------------------------------------------
 * 3. Valitor return → confirm, then the storefront's receipt
 *    Valitor sends the shopper back to the order-received URL on the WordPress host with the payment's reference and
 *    signature in the query. Its plugin (1.9.41) confirms such a return on `woocommerce_thankyou`, which never fires
 *    here: headless mode forwards the page to the storefront first (template_redirect, priority 5). So the gateway's
 *    own check runs here, before that, and the shopper goes on to the storefront with the order key only: the card
 *    and authorization details Valitor appended stay out of the storefront's URL. The gateway does all the verifying
 *    (signature, order key, amount); a return it refuses changes nothing and the receipt shows the order as unpaid.
 *    Valitor's server-side call (wc-api) confirms the same payment on its own; whichever arrives first wins.
 * --------------------------------------------------------------------- */

/** The storefront receipt a Valitor return on WordPress's order-received page goes on to, or null when this is not one. */
function mos_valitor_return_target(string $path, array $request, string $storefront_base): ?string {
    if ($storefront_base === '' || !isset($request['ReferenceNumber'])) { return null; }
    if (!preg_match('#^/gera-upp/order-received/(\d+)/?$#', $path, $m)) { return null; }
    $key = is_string($request['key'] ?? null) ? sanitize_text_field(wp_unslash($request['key'])) : '';
    $url = rtrim($storefront_base, '/') . '/gera-upp/order-received/' . $m[1] . '/';
    return $key !== '' ? add_query_arg(['key' => rawurlencode($key)], $url) : $url;
}

add_action('template_redirect', static function () {
    if (!isset($_REQUEST['ReferenceNumber']) || !function_exists('mos_headless_target_base') || !function_exists('WC')) { return; }
    $base = mos_headless_target_base();
    // Shared-host setups serve this path from the storefront already; WordPress only sees it by mistake.
    if (strcasecmp((string) ($_SERVER['HTTP_HOST'] ?? ''), (string) wp_parse_url($base, PHP_URL_HOST)) === 0) { return; }
    $path = (string) (wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) ?? '');
    $target = mos_valitor_return_target($path, $_REQUEST, $base);
    if ($target === null) { return; }

    $gateway = WC()->payment_gateways()->payment_gateways()['valitor'] ?? null;
    $order_id = (int) basename(rtrim($path, '/'));
    // The gateway exits with a blank page while its server-side call is confirming the same order: skip it then.
    if ($gateway && is_callable([$gateway, 'check_valitor_response']) && !get_transient('valitor_payment_' . $order_id . '_processing')) {
        $gateway->check_valitor_response();
    }
    wp_redirect($target, 302, 'MOS Headless');
    exit;
}, 2); // before headless mode (5) forwards the request, query and all, to the storefront
