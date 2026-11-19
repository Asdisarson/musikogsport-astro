<?php
/**
 * Plugin Name: MOS Staff Flag
 * Description: Tells the storefront's admin bar that this browser is signed in to wp-admin as staff. While an
 *  account that may edit products is signed in, the browser carries the cookie `mos_staff=1` on the host the
 *  shop and WordPress share (WordPress on wp.<shop host>, or both on one host); signing out removes it. The
 *  storefront's pages are the same for every visitor, so its script reads this flag to show the bar
 *  (app-astro src/components/AdminBar.astro).
 *
 *  The flag is not a credential: it only makes links to wp-admin appear, and wp-admin asks for its own login.
 *  Nothing is set when the two hosts share no cookie scope or no storefront is configured (mos-headless-mode).
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_STAFF_COOKIE = 'mos_staff';
const MOS_STAFF_CAPABILITY = 'edit_products';

/**
 * The cookie Domain that reaches both hosts: '' for a host-only cookie when they are the same host (ports
 * don't separate cookies), the shop's host when WordPress is a subdomain of it, null when no cookie can.
 */
function mos_staff_cookie_domain(string $wp_host, string $shop_host): ?string {
    $wp = strtolower((string) preg_replace('/:\d+$/', '', trim($wp_host)));
    $shop = strtolower((string) preg_replace('/:\d+$/', '', trim($shop_host)));
    if ($wp === '' || $shop === '') { return null; }
    if ($wp === $shop) { return ''; }
    return str_ends_with($wp, '.' . $shop) ? $shop : null;
}

/** The Domain for this request, or null when the flag can't be shared with the storefront. */
function mos_staff_request_domain(): ?string {
    $base = function_exists('mos_headless_target_base') ? mos_headless_target_base() : '';
    $shop_host = $base !== '' ? (string) wp_parse_url($base, PHP_URL_HOST) : '';
    return mos_staff_cookie_domain((string) ($_SERVER['HTTP_HOST'] ?? ''), $shop_host);
}

/** Send the flag (value '1') or remove it (value ''). `$expire` 0 keeps it for the browser session. */
function mos_staff_send(string $value, int $expire): void {
    $domain = mos_staff_request_domain();
    if ($domain === null) { return; } // no shared cookie scope, or no storefront configured: nothing to tell
    if (headers_sent()) {
        error_log('[mos-staff-flag] headers already sent: the staff flag was not ' . ($value === '' ? 'removed' : 'set'));
        return;
    }
    $options = ['expires' => $expire, 'path' => '/', 'secure' => is_ssl(), 'httponly' => false, 'samesite' => 'Lax'];
    if ($domain !== '') { $options['domain'] = $domain; }
    setcookie(MOS_STAFF_COOKIE, $value, $options);
}

/** Remove the flag from the browser. */
function mos_staff_clear(): void {
    mos_staff_send('', time() - YEAR_IN_SECONDS);
}

// Signing in: the flag lives as long as the login cookie WordPress is setting. Another account signing in
// on the same browser (a customer after staff) takes a leftover flag away.
add_action('set_logged_in_cookie', static function ($cookie, $expire, $expiration, $user_id): void {
    if (user_can((int) $user_id, MOS_STAFF_CAPABILITY)) { mos_staff_send('1', (int) $expire); }
    elseif (isset($_COOKIE[MOS_STAFF_COOKIE])) { mos_staff_clear(); }
}, 10, 4);

// On a wp-admin page the flag follows the account: a staff session without it (it began before this plugin)
// gets it for the browser session, and an account that is not staff (demoted since) loses it.
add_action('admin_init', static function (): void {
    if (wp_doing_ajax()) { return; }
    $flagged = isset($_COOKIE[MOS_STAFF_COOKIE]);
    $staff = current_user_can(MOS_STAFF_CAPABILITY);
    if ($staff && !$flagged) { mos_staff_send('1', 0); }
    elseif (!$staff && $flagged) { mos_staff_clear(); }
});

// Signing out, and whenever WordPress drops its login cookies.
add_action('clear_auth_cookie', 'mos_staff_clear');
