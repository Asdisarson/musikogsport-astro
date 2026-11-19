<?php
/**
 * Plugin Name: MOS Shell Poke
 * Description: Tells the storefront when a product a catalog editor saved (or removed from sale) changes the pages it
 *  keeps (app-astro src/lib/shellStore.ts). A saved product's page and the listings are marked stale (served until
 *  they are rendered again); a removed product's stored page is dropped. Stock changes from orders are not catalog
 *  edits and send nothing: stock reaches the storefront from /api/live.
 *
 *  Queued while the request runs, then one POST to the storefront at the end of the request (after
 *  fastcgi_finish_request, so the editor is not kept waiting), the same pattern as mos-size-index.php. When the
 *  constant MOS_SHELL_POKE_KEY is defined (here and in the storefront's MOS_SHELL_POKE_KEY), it is sent as the
 *  X-Mos-Shell-Key header, and the storefront then accepts pokes from no one else. More than 50 changed paths (a bulk
 *  edit or an import) are sent in batches of 50, several POSTs at the end of the request (at most 20; anything past
 *  that is logged as unsent). With the key, a bulk change may instead send the "every product" mark: each product
 *  page is then re-rendered, and one that no longer exists answers 404 there and is removed.
 *
 *  A product that moves (a new slug, a new category) or leaves the shop (draft, pending, private, trashed, deleted)
 *  has its OLD storefront path marked or dropped too: the path is taken before WordPress writes the change.
 *
 *  A scheduled save (WP-Cron, or the Action Scheduler actions that start and end a sale: WooCommerce's sale dates) counts
 *  like an editor's, unless it changed only stock.
 *  A path longer than the storefront takes (200 characters) is logged and not sent; the others are.
 *
 * Author: Músík og Sport
 * Version: 1.2.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_SHELL_POKE_MAX = 50;
/** The storefront's limit for one path (src/lib/shellPoke.ts MAX_PATH), in characters. */
const MOS_SHELL_POKE_PATH_MAX = 200;
/** The product props that a stock change touches: a save that changed only these is not a catalog edit. */
const MOS_SHELL_POKE_STOCK_PROPS = ['stock_quantity', 'stock_status', 'manage_stock', 'backorders', 'low_stock_amount'];

/** The storefront path of a product or category permalink (/vara/x/, /verslun/a/b/), or null for anything else. */
function mos_shell_poke_path(string $url): ?string {
    // Permalinks are percent-encoded for non-ASCII slugs: decode, then check the shape of the decoded path.
    $path = rawurldecode((string) preg_replace('/[?#].*$/s', '', (string) preg_replace('#^[a-z][a-z0-9+.-]*://[^/]*#i', '', $url)));
    if ($path === '' || strpos($path, '..') !== false || strpos($path, '//') !== false) { return null; }
    if (!preg_match('#^/(vara|verslun)(/[\p{Ll}\p{N}_-]+)+/$#u', $path)) { return null; }
    return $path;
}

const MOS_SHELL_POKE_BATCHES = 20;

/** The paths the storefront can take: strings, each once, none longer than MOS_SHELL_POKE_PATH_MAX characters. A longer
 *  one is logged (its length only) and left out; the rest are sent. Pure apart from the log line. */
function mos_shell_poke_fit(array $paths): array {
    $out = [];
    foreach (array_values(array_unique(array_filter($paths, 'is_string'))) as $p) {
        $len = function_exists('mb_strlen') ? mb_strlen($p, 'UTF-8') : strlen($p);
        if ($len > MOS_SHELL_POKE_PATH_MAX) {
            error_log('[mos-shell-poke] a path of ' . $len . ' characters is not sent: the storefront takes at most ' . MOS_SHELL_POKE_PATH_MAX);
            continue;
        }
        $out[] = $p;
    }
    return $out;
}

/** The JSON bodies for the storefront. Without the key, more than MOS_SHELL_POKE_MAX paths are sent in batches of that
 *  size (the storefront's per-visitor limit is 30 a minute), listings in the first. With the key, one body, and a bulk
 *  change is the "products" mark. Pure. */
function mos_shell_poke_bodies(array $stale, array $drop, bool $listings, bool $keyed): array {
    $stale = mos_shell_poke_fit($stale);
    $drop = mos_shell_poke_fit($drop);
    if ($keyed) {
        $body = mos_shell_poke_body($stale, $drop, $listings);
        return $body === null ? [] : [$body];
    }
    $bodies = [];
    $batches = (int) ceil(max(count($stale), count($drop), 1) / MOS_SHELL_POKE_MAX);
    for ($i = 0; $i < $batches; $i++) {
        if ($i >= MOS_SHELL_POKE_BATCHES) {
            error_log('[mos-shell-poke] ' . (count($stale) + count($drop)) . ' paths not sent: the batch limit is ' . MOS_SHELL_POKE_BATCHES . ' pokes; the pages stay until their lifetime ends');
            break;
        }
        $body = mos_shell_poke_body(array_slice($stale, $i * MOS_SHELL_POKE_MAX, MOS_SHELL_POKE_MAX), array_slice($drop, $i * MOS_SHELL_POKE_MAX, MOS_SHELL_POKE_MAX), $listings && $i === 0);
        if ($body !== null) { $bodies[] = $body; }
    }
    return $bodies;
}

/** The JSON body for the storefront, or null when there is nothing to say. Paths are de-duplicated. More than
 *  MOS_SHELL_POKE_MAX paths of either kind cannot be named in one poke: the body then carries "products": true (every
 *  product page is stale, and the storefront's loaders are forgotten) and the first paths as well. */
function mos_shell_poke_body(array $stale, array $drop, bool $listings, bool $products = false): ?string {
    $stale = mos_shell_poke_fit($stale);
    $drop = mos_shell_poke_fit($drop);
    if (count($stale) > MOS_SHELL_POKE_MAX || count($drop) > MOS_SHELL_POKE_MAX) { $products = true; }
    $stale = array_slice($stale, 0, MOS_SHELL_POKE_MAX);
    $drop = array_slice($drop, 0, MOS_SHELL_POKE_MAX);
    if (!$stale && !$drop && !$listings && !$products) { return null; }
    $body = ['stale' => $stale, 'drop' => $drop, 'listings' => $listings];
    if ($products) { $body['products'] = true; }
    return (string) wp_json_encode($body);
}

/** The path a product had before a change and no longer has after it, to be dropped; empty when it did not move. */
function mos_shell_poke_moved(?string $before, ?string $after): array {
    return ($before !== null && $before !== '' && $before !== $after) ? [$before] : [];
}

/** A save that changed only stock (a checkout's stock change, or an order's). Nothing changed at all is not stock-only. */
function mos_shell_poke_stock_only(array $props): bool {
    return $props !== [] && array_diff($props, MOS_SHELL_POKE_STOCK_PROPS) === [];
}

/** Only a catalog editor's saves count: WP-CLI imports, or a user who may edit products (not a checkout's stock change).
 *  A scheduled save (WP-Cron: WooCommerce's sale start and end) counts too, unless it changed only stock. */
function mos_shell_poke_is_editor(bool $wp_cli, bool $can_edit, bool $scheduled = false, array $props = []): bool {
    return $wp_cli || $can_edit || ($scheduled && !mos_shell_poke_stock_only($props));
}

/** Whether this save is WooCommerce's scheduled sale work: WP-Cron (wc_scheduled_sales), or the Action Scheduler
 *  actions that start and end one product's sale (wc_handle_product_start/end_scheduled_sale). Those run with no user. */
function mos_shell_poke_scheduled(): bool {
    if (function_exists('wp_doing_cron') && wp_doing_cron()) { return true; }
    return function_exists('doing_action') && (doing_action('wc_product_start_scheduled_sale') || doing_action('wc_product_end_scheduled_sale'));
}

/** Queue a poke for the end of this request. */
function mos_shell_poke_queue(array $stale, array $drop, bool $listings): void {
    if (empty($GLOBALS['mos_shell_poke'])) {
        $GLOBALS['mos_shell_poke'] = ['stale' => [], 'drop' => [], 'listings' => false];
        if (!has_action('shutdown', 'mos_shell_poke_flush')) { add_action('shutdown', 'mos_shell_poke_flush', PHP_INT_MAX - 2); }
    }
    $q = &$GLOBALS['mos_shell_poke'];
    $q['stale'] = array_merge($q['stale'], $stale);
    $q['drop'] = array_merge($q['drop'], $drop);
    $q['listings'] = $q['listings'] || $listings;
}

/** End of the request: answer the editor first (php-fpm), then tell the storefront once. Never throws; a refused or
 *  failed poke is logged (the page then stays as it was until its own lifetime ends). */
function mos_shell_poke_flush(): void {
    $q = $GLOBALS['mos_shell_poke'] ?? null;
    $GLOBALS['mos_shell_poke'] = null;
    if (!$q) { return; }
    if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); }
    $base = function_exists('mos_headless_target_base') ? mos_headless_target_base() : '';
    $keyed = defined('MOS_SHELL_POKE_KEY') && is_string(MOS_SHELL_POKE_KEY) && MOS_SHELL_POKE_KEY !== '';
    $bodies = mos_shell_poke_bodies($q['stale'], $q['drop'], (bool) $q['listings'], $keyed);
    if ($base === '') { return; }
    $headers = ['Content-Type' => 'application/json'];
    if ($keyed) { $headers['X-Mos-Shell-Key'] = MOS_SHELL_POKE_KEY; }
    foreach ($bodies as $body) {
        $res = wp_remote_post($base . '/api/shell-refresh', [
            'timeout' => 5,
            'redirection' => 0,
            'headers' => $headers,
            'body' => $body,
        ]);
        $code = is_wp_error($res) ? 0 : (int) wp_remote_retrieve_response_code($res);
        if ($code !== 204 && $code !== 200) {
            error_log('[mos-shell-poke] storefront answered ' . ($code ?: 'no answer') . ': the page stays as it was for now');
        }
    }
}

/** The props a product's save changed, from WooCommerce's woocommerce_product_object_updated_props, until the save's end
 *  hook takes them. */
function mos_shell_poke_capture_props(int $id, array $props): void {
    $GLOBALS['mos_shell_poke_props'][$id] = $props;
}

function mos_shell_poke_take_props(int $id): array {
    $props = $GLOBALS['mos_shell_poke_props'][$id] ?? [];
    unset($GLOBALS['mos_shell_poke_props'][$id]);
    return $props;
}

/** A product's storefront path now (null when it has none, e.g. a draft's non-pretty permalink). */
function mos_shell_poke_path_of(int $id): ?string {
    return mos_shell_poke_path((string) get_permalink($id));
}

/** Before WordPress writes a product: its path as it is now (the old slug and category), kept for after the save. */
function mos_shell_poke_before_save(int $id): void {
    if ($id <= 0 || get_post_type($id) !== 'product') { return; }
    $GLOBALS['mos_shell_poke_before'][$id] = mos_shell_poke_path_of($id);
}

/** The path a product had before the change, taken from the capture and removed with it (so no later hook in this
 *  request sees it). Null when nothing was captured. */
function mos_shell_poke_take_before(int $id): ?string {
    $before = $GLOBALS['mos_shell_poke_before'][$id] ?? null;
    unset($GLOBALS['mos_shell_poke_before'][$id]);
    return $before;
}

/** A saved product: its page and the listings are stale; the path it moved from is dropped. */
function mos_shell_poke_saved(int $id): void {
    $props = mos_shell_poke_take_props($id);
    $before = mos_shell_poke_take_before($id);
    if ($id <= 0) { return; }
    if (!mos_shell_poke_is_editor(defined('WP_CLI') && WP_CLI, current_user_can('edit_products'), mos_shell_poke_scheduled(), $props)) { return; }
    $now = mos_shell_poke_path_of($id);
    $moved = mos_shell_poke_moved($before, $now);
    mos_shell_poke_queue($now ? [$now] : [], $moved, true);
}

/** A product that leaves the shop (trashed, deleted, unpublished): its stored page is dropped and the listings change. */
function mos_shell_poke_gone(int $id): void {
    $before = mos_shell_poke_take_before($id);
    if ($id <= 0 || get_post_type($id) !== 'product') { return; }
    if (!mos_shell_poke_is_editor(defined('WP_CLI') && WP_CLI, current_user_can('edit_products'))) { return; }
    $path = $before ?? mos_shell_poke_path_of($id);
    mos_shell_poke_queue([], $path ? [$path] : [], true);
}

// Before the write: the path as it was (WordPress answers with the pretty permalink only while the post is published).
add_action('pre_post_update', static fn ($id) => mos_shell_poke_before_save((int) $id), 10, 1);
add_action('woocommerce_product_object_updated_props', static fn ($product, $props) => mos_shell_poke_capture_props((int) $product->get_id(), is_array($props) ? $props : []), 10, 2);
add_action('woocommerce_new_product', static fn ($id) => mos_shell_poke_saved((int) $id));
add_action('woocommerce_update_product', static fn ($id) => mos_shell_poke_saved((int) $id));
add_action('wp_trash_post', static fn ($id) => mos_shell_poke_gone((int) $id));
add_action('before_delete_post', static fn ($id) => mos_shell_poke_gone((int) $id));
add_action('transition_post_status', static function (string $new, string $old, $post): void {
    if ($post instanceof WP_Post && $post->post_type === 'product' && $old === 'publish' && $new !== 'publish') {
        mos_shell_poke_gone((int) $post->ID);
    }
}, 10, 3);
