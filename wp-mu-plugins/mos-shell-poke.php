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

/** The queue with more paths and the listings mark added. Each path is kept once, in the order it was first queued, so a
 *  change that WooCommerce's save hooks send too (the same product, the same request) is one entry, not two. Pure. */
function mos_shell_poke_merge(array $queue, array $stale, array $drop, bool $listings): array {
    return [
        'stale' => array_values(array_unique(array_merge($queue['stale'] ?? [], $stale))),
        'drop' => array_values(array_unique(array_merge($queue['drop'] ?? [], $drop))),
        'listings' => (bool) ($queue['listings'] ?? false) || $listings,
    ];
}

/** Whether a status change makes a product visible in the shop ('shown'), stops it being visible ('hidden'), or changes
 *  nothing that a listing or a product page shows (null). Visible means published, whatever the old status was (a
 *  scheduled product going live is "future" to "publish"). Pure. */
function mos_shell_poke_visibility_change(string $old, string $new): ?string {
    if ($old === $new) { return null; }
    if ($new === 'publish' && $old !== 'publish') { return 'shown'; }
    if ($old === 'publish' && $new !== 'publish') { return 'hidden'; }
    return null;
}

/** Queue a poke for the end of this request. */
function mos_shell_poke_queue(array $stale, array $drop, bool $listings): void {
    if (empty($GLOBALS['mos_shell_poke'])) {
        $GLOBALS['mos_shell_poke'] = ['stale' => [], 'drop' => [], 'listings' => false];
        if (!has_action('shutdown', 'mos_shell_poke_flush')) { add_action('shutdown', 'mos_shell_poke_flush', PHP_INT_MAX - 2); }
    }
    $GLOBALS['mos_shell_poke'] = mos_shell_poke_merge($GLOBALS['mos_shell_poke'], $stale, $drop, $listings);
}

/** The paths of a 429 answer that the storefront did not apply: a poke cut short by its budget applies what it can and
 *  answers {message, untaken} (DEPLOY.md, shell-refresh). Pure; [] when the answer names none. */
function mos_shell_poke_untaken(string $response_body): array {
    $data = json_decode($response_body, true);
    if (!is_array($data) || !isset($data['untaken']) || !is_array($data['untaken'])) { return []; }
    return array_values(array_filter($data['untaken'], static fn($p) => is_string($p) && $p !== ''));
}

/** The body to send again: the sent body with only the paths that were left out, in the same stale and drop lists.
 *  The listings and products marks are not paths, so they are not sent again. Null when none of the paths is left. Pure. */
function mos_shell_poke_resend_body(string $sent, array $untaken): ?string {
    $body = json_decode($sent, true);
    if (!is_array($body) || !$untaken) { return null; }
    $left = array_flip($untaken);
    $stale = array_values(array_filter($body['stale'] ?? [], static fn($p) => isset($left[$p])));
    $drop = array_values(array_filter($body['drop'] ?? [], static fn($p) => isset($left[$p])));
    if (!$stale && !$drop) { return null; }
    return (string) wp_json_encode(['stale' => $stale, 'drop' => $drop, 'listings' => false]);
}

/** How long to wait before the one resend: the storefront's Retry-After (60 s in practice), clamped to 1..60 s. Pure. */
function mos_shell_poke_retry_after(?string $header): int {
    $secs = is_string($header) && ctype_digit(trim($header)) ? (int) trim($header) : 60;
    return max(1, min(60, $secs));
}

/** Where pokes go and the headers they carry, or null when no storefront address is configured. */
function mos_shell_poke_target(): ?array {
    $base = function_exists('mos_headless_target_base') ? mos_headless_target_base() : '';
    if ($base === '') { return null; }
    $headers = ['Content-Type' => 'application/json'];
    if (mos_shell_poke_keyed()) { $headers['X-Mos-Shell-Key'] = MOS_SHELL_POKE_KEY; }
    return ['url' => $base . '/api/shell-refresh', 'headers' => $headers];
}

function mos_shell_poke_keyed(): bool {
    return defined('MOS_SHELL_POKE_KEY') && is_string(MOS_SHELL_POKE_KEY) && MOS_SHELL_POKE_KEY !== '';
}

/** One poke; the answer as WordPress gives it. */
function mos_shell_poke_post(array $target, string $body) {
    return wp_remote_post($target['url'], ['timeout' => 5, 'redirection' => 0, 'headers' => $target['headers'], 'body' => $body]);
}

/** Where the bodies waiting for their one resend are kept: an option that is not loaded with every request. */
const MOS_SHELL_POKE_RESEND_OPTION = 'mos_shell_poke_resend_queue';
/** The most the waiting bodies may weigh together. Refused pokes past it are logged and not sent again, so the option
 *  cannot grow while WP-Cron is not running. */
const MOS_SHELL_POKE_RESEND_BYTES = 32768;

/** The waiting bodies with more added: oldest first, each once, until the next would pass the byte cap. Pure. */
function mos_shell_poke_resend_queue(array $waiting, array $more, int $cap): array {
    $out = [];
    $bytes = 0;
    foreach (array_merge($waiting, $more) as $body) {
        if (!is_string($body) || $body === '' || in_array($body, $out, true)) { continue; }
        if ($bytes + strlen($body) > $cap) { break; }
        $out[] = $body;
        $bytes += strlen($body);
    }
    return $out;
}

/** End of the request: answer the editor first (php-fpm), then tell the storefront once. Never throws; a refused or
 *  failed poke is logged (the page then stays as it was until its own lifetime ends). A 429 that names the paths it
 *  did not apply (untaken) is sent again once, with exactly those paths, after its Retry-After: the storefront answers
 *  429 for a partly applied poke too, so that is not a failure. The resend is one cron event over a small queue, never
 *  a wait in this request: a sleeping PHP worker per refused poke could use up the pool during a bulk edit. */
function mos_shell_poke_flush(): void {
    $q = $GLOBALS['mos_shell_poke'] ?? null;
    $GLOBALS['mos_shell_poke'] = null;
    if (!$q) { return; }
    if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); }
    $bodies = mos_shell_poke_bodies($q['stale'], $q['drop'], (bool) $q['listings'], mos_shell_poke_keyed());
    $target = mos_shell_poke_target();
    if ($target === null) { return; }
    $resend = [];
    $after = 1;
    foreach ($bodies as $body) {
        $res = mos_shell_poke_post($target, $body);
        $code = is_wp_error($res) ? 0 : (int) wp_remote_retrieve_response_code($res);
        if ($code === 429 && !is_wp_error($res)) {
            // Partly applied: the paths it names are the ones to send again.
            $again = mos_shell_poke_resend_body($body, mos_shell_poke_untaken((string) wp_remote_retrieve_body($res)));
            if ($again !== null) {
                $resend[] = $again;
                $after = max($after, mos_shell_poke_retry_after(wp_remote_retrieve_header($res, 'retry-after')));
                continue;
            }
        }
        if ($code !== 204 && $code !== 200) {
            error_log('[mos-shell-poke] storefront answered ' . ($code ?: 'no answer') . ': the page stays as it was for now');
        }
    }
    if ($resend) { mos_shell_poke_resend_later($resend, $after); }
}

/** Keeps the refused bodies for the one resend and makes sure its cron event is queued, after the longest Retry-After
 *  asked for, so it is not sent into the same spent budget. */
function mos_shell_poke_resend_later(array $resend, int $after): void {
    if (!function_exists('wp_schedule_single_event')) { return; }
    $waiting = get_option(MOS_SHELL_POKE_RESEND_OPTION, []);
    $waiting = is_array($waiting) ? $waiting : [];
    $queue = mos_shell_poke_resend_queue($waiting, $resend, MOS_SHELL_POKE_RESEND_BYTES);
    $left = count(array_unique(array_merge($waiting, $resend))) - count($queue);
    if ($left > 0) { error_log('[mos-shell-poke] ' . $left . ' refused poke(s) are not sent again: those pages stay as they were for now'); }
    update_option(MOS_SHELL_POKE_RESEND_OPTION, $queue, false);
    if (!wp_next_scheduled('mos_shell_poke_resend') && wp_schedule_single_event(time() + $after, 'mos_shell_poke_resend') === false) {
        error_log('[mos-shell-poke] the resend could not be scheduled: those pages stay as they were for now');
    }
}

/** The one resend (the cron event): each waiting body once; a refused or failed one is only logged. The queue is
 *  emptied first, so a body is never sent a second time. */
function mos_shell_poke_resend(): void {
    $bodies = get_option(MOS_SHELL_POKE_RESEND_OPTION, []);
    delete_option(MOS_SHELL_POKE_RESEND_OPTION);
    $target = mos_shell_poke_target();
    if ($target === null || !is_array($bodies)) { return; }
    foreach (mos_shell_poke_resend_queue($bodies, [], MOS_SHELL_POKE_RESEND_BYTES) as $body) {
        $res = mos_shell_poke_post($target, $body);
        $code = is_wp_error($res) ? 0 : (int) wp_remote_retrieve_response_code($res);
        if ($code !== 204 && $code !== 200) {
            error_log('[mos-shell-poke] resend answered ' . ($code ?: 'no answer') . ': the page stays as it was for now');
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
add_action('mos_shell_poke_resend', 'mos_shell_poke_resend');
/** A product that becomes visible without a WooCommerce save: a scheduled one going live (WP-Cron's wp_publish_post writes
 *  the status itself and never runs the product save hooks), or a draft or pending one published. Its page and the
 *  listings are stale. The path is taken from the post as it now is (its new status), not from the capture that a later
 *  save hook still needs. */
function mos_shell_poke_shown(WP_Post $post, string $status): void {
    $id = (int) $post->ID;
    if ($id <= 0) { return; }
    if (!mos_shell_poke_is_editor(defined('WP_CLI') && WP_CLI, current_user_can('edit_products'), mos_shell_poke_scheduled())) { return; }
    $as = clone $post;
    $as->post_status = $status;
    $path = mos_shell_poke_path((string) get_permalink($as));
    mos_shell_poke_queue($path ? [$path] : [], [], true);
}

// Any status change that flips the product's visibility pokes, whatever the old status was. A save through WooCommerce
// also sends these from its own hooks in the same request; the queue keeps each path once.
add_action('transition_post_status', static function (string $new, string $old, $post): void {
    if (!$post instanceof WP_Post || $post->post_type !== 'product') { return; }
    $change = mos_shell_poke_visibility_change($old, $new);
    if ($change === 'hidden') { mos_shell_poke_gone((int) $post->ID); }
    elseif ($change === 'shown') { mos_shell_poke_shown($post, $new); }
}, 10, 3);
