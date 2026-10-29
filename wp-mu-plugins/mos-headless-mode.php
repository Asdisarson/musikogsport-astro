<?php
/**
 * Plugin Name: MOS Headless Mode
 * Description: WordPress is the backend only — every front-end page request is redirected to
 *  the Astro storefront at the same path. wp-admin, the REST API, wc-api callbacks, wp-login,
 *  cron, feeds, previews and uploads keep being served by WordPress.
 *
 *  Target: MOS_STOREFRONT_URL, else MOS_DEV_ASTRO_URL (the Local dev shim). Without either
 *  constant the plugin does nothing, so a misconfigured install never redirects to itself.
 *  Status: 302 unless MOS_HEADLESS_REDIRECT_STATUS is defined (use 301 in production).
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

function mos_headless_target_base(): string {
    if (defined('MOS_STOREFRONT_URL')) { return rtrim((string) MOS_STOREFRONT_URL, '/'); }
    if (defined('MOS_DEV_ASTRO_URL')) { return rtrim((string) MOS_DEV_ASTRO_URL, '/'); }
    return '';
}

// Priority 5: after the headless bridge's straumurStatus routing (priority 0–1, which exits first) but
// before WooCommerce's own redirects at 10 — e.g. its empty-cart bounce from the checkout to /karfa/,
// which would drop /gera-upp/?straumurStatus=failed. wc-api and REST requests never reach template_redirect.
add_action('template_redirect', static function () {
    if (is_admin() || wp_doing_ajax() || wp_doing_cron() || (defined('REST_REQUEST') && REST_REQUEST)) { return; }
    if (is_feed() || is_preview() || is_robots() || is_trackback()) { return; }
    // WooCommerce's order-pay page (the "pay for this order" link in invoice emails and wp-admin) has no
    // storefront equivalent, so WordPress keeps serving it. Straumur returns never land here (the bridge).
    if (function_exists('is_wc_endpoint_url') && is_wc_endpoint_url('order-pay')) { return; }

    $base = mos_headless_target_base();
    if ($base === '') { return; }

    $target_host = (string) wp_parse_url($base, PHP_URL_HOST);
    $request_host = (string) ($_SERVER['HTTP_HOST'] ?? '');
    $target_port = wp_parse_url($base, PHP_URL_PORT);
    $target_authority = $target_host . ($target_port ? ':' . $target_port : '');
    // Already on the storefront origin (shared-host setups): never redirect to ourselves.
    if ($request_host !== '' && strcasecmp($request_host, $target_authority) === 0) { return; }

    $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
    if ($uri === '' || $uri[0] !== '/') { $uri = '/' . $uri; }

    $status = defined('MOS_HEADLESS_REDIRECT_STATUS') ? (int) MOS_HEADLESS_REDIRECT_STATUS : 302;
    // wp_redirect (not wp_safe_redirect): the target is operator configuration, not user input.
    wp_redirect($base . $uri, in_array($status, [301, 302, 307, 308], true) ? $status : 302, 'MOS Headless');
    exit;
}, 5);
