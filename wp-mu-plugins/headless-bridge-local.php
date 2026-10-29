<?php
/**
 * Plugin Name: MOS Headless Bridge — Local Dev Overrides
 * Description: Local development shim that rewrites the host on URLs the
 *  production headless-bridge.php produces, so WooCommerce redirects land on
 *  the Astro dev server (localhost:10026, Local's headless add-on) instead of the WP host (localhost:10025).
 *  It acts only where wp_get_environment_type() is 'local' (WP_ENVIRONMENT_TYPE in wp-config.php) and
 *  returns before adding any hook anywhere else. Never deploy it: these filters are NOT no-ops in
 *  production, they would send every paid shopper and the whole site to localhost.
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

// Local only (MU-01). Checked before the constant below: headless mode falls back to MOS_DEV_ASTRO_URL, so
// defining it on a real host would redirect the whole site to localhost.
if (!function_exists('wp_get_environment_type') || wp_get_environment_type() !== 'local') { return; }

// Configurable target — override via wp-config.php if needed.
// Local's headless add-on runs `astro dev` on 10026 (see app-astro/.claude/skills/verify);
// nothing listens on astro's own default 4321 in this setup.
if (!defined('MOS_DEV_ASTRO_URL')) {
    define('MOS_DEV_ASTRO_URL', 'http://localhost:10026');
}

// WC REST API v3 only honors Basic Auth over HTTPS (class-wc-rest-authentication.php).
// Local dev runs HTTP. WC's auth callback is on `determine_current_user` at priority 15.
// We pin HTTPS=on right before it runs and remove it immediately after, so the rest of
// WP's request lifecycle (URL generation, etc.) sees the real HTTP scheme.
add_filter('determine_current_user', static function ($user) {
    if (!empty($_SERVER['REQUEST_URI']) && strpos((string) $_SERVER['REQUEST_URI'], '/wp-json/wc/v3/') !== false) {
        $GLOBALS['mos_dev_prev_https'] = $_SERVER['HTTPS'] ?? null;
        $_SERVER['HTTPS'] = 'on';
    }
    return $user;
}, 14);

add_filter('determine_current_user', static function ($user) {
    if (array_key_exists('mos_dev_prev_https', $GLOBALS)) {
        if ($GLOBALS['mos_dev_prev_https'] === null) {
            unset($_SERVER['HTTPS']);
        } else {
            $_SERVER['HTTPS'] = $GLOBALS['mos_dev_prev_https'];
        }
        unset($GLOBALS['mos_dev_prev_https']);
    }
    return $user;
}, 16);

/**
 * Replace the host of a URL with MOS_DEV_ASTRO_URL while preserving path/query.
 */
function mos_dev_rewrite_host(string $url): string {
    $parts = wp_parse_url($url);
    if (!is_array($parts)) { return $url; }
    $target = wp_parse_url(MOS_DEV_ASTRO_URL);
    if (!is_array($target) || empty($target['host'])) { return $url; }

    $scheme = $target['scheme'] ?? 'http';
    $host   = $target['host'];
    $port   = isset($target['port']) ? ':' . (int) $target['port'] : '';
    $path   = $parts['path'] ?? '/';
    $query  = isset($parts['query']) ? '?' . $parts['query'] : '';
    return sprintf('%s://%s%s%s%s', $scheme, $host, $port, $path, $query);
}

// 1. Allow wp_safe_redirect to the Astro host.
add_filter('allowed_redirect_hosts', function ($hosts) {
    $target = wp_parse_url(MOS_DEV_ASTRO_URL);
    if (is_array($target) && !empty($target['host'])) {
        $hosts[] = $target['host'];
    }
    return $hosts;
});

// 2. Rewrite return URL host (runs after the primary filter at priority 10).
add_filter('woocommerce_get_return_url', function ($url) {
    return mos_dev_rewrite_host((string) $url);
}, 20);

// 3. Rewrite the Straumur cancel/error redirect destination.
//    Primary plugin issues wp_safe_redirect(home_url('/gera-upp/?straumurStatus=...')) on template_redirect.
//    We intercept before that fires (priority 0) by piggybacking on the same query-string signal.
//    The target is the production bounce's (status and a numeric order_id only, MU-08), on the dev host.
add_action('template_redirect', function () {
    if (empty($_GET['straumurStatus']) || is_admin()) { return; }
    if (strpos((string) ($_SERVER['REQUEST_URI'] ?? ''), '/gera-upp') === 0) { return; } // headless mode forwards it
    $target = function_exists('mos_straumur_bounce_target') ? mos_straumur_bounce_target($_GET) : null;
    if ($target === null) { return; }
    wp_safe_redirect(mos_dev_rewrite_host($target));
    exit;
}, 0);
