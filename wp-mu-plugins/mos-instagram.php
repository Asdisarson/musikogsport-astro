<?php
/**
 * Plugin Name: MOS Instagram feed (headless bridge)
 * Description: The storefront's "Músík og Sport á Instagram" row: `GET /wp-json/mos/v1/instagram` lists the latest
 *  posts of @musikogsport (link, caption excerpt, a square picture). WordPress fetches them from the Instagram API
 *  (Instagram Login) at most once an hour and mirrors each picture into uploads/mos-instagram/ (Instagram's own
 *  picture URLs expire within days), so the browser never talks to Instagram. The access token is pasted on the
 *  wp-admin "Stillingar" page (administrators only), renewed here before its 60 days run out, and never leaves
 *  WordPress. Without a token, or while Instagram is down with nothing fetched yet, the list is empty and the
 *  storefront shows a "Fylgdu okkur" banner instead.
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_INSTAGRAM_HANDLE = 'musikogsport';
const MOS_INSTAGRAM_API = 'https://graph.instagram.com/v26.0/';
const MOS_INSTAGRAM_REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';
const MOS_INSTAGRAM_TOKEN_OPTION = 'mos_instagram_token';   // ['token' => …, 'issued' => unix, 'username' => …]
const MOS_INSTAGRAM_FEED_OPTION = 'mos_instagram_feed';     // ['fetched' => unix, 'posts' => [...]] (last good)
const MOS_INSTAGRAM_FRESH = 'mos_instagram_fresh';          // transient: set while the feed needs no refresh
const MOS_INSTAGRAM_LOCK = 'mos_instagram_lock';            // option (add_option is atomic): one refresh at a time
const MOS_INSTAGRAM_LOCK_TTL = 5 * 60;                      // > a worst-case refresh (2 API calls + 12 pictures)
const MOS_INSTAGRAM_DIR = 'mos-instagram';                  // under uploads/
const MOS_INSTAGRAM_POSTS = 12;
const MOS_INSTAGRAM_SIZE = 640;                             // mirrored pictures: square, at most this many px
const MOS_INSTAGRAM_TOKEN_RENEW_DAYS = 30;                  // tokens live 60 days; renew halfway
const MOS_INSTAGRAM_MAX_BYTES = 15 * 1024 * 1024;           // a picture larger than this is not decoded
// Instagram serves its pictures from these CDNs only; anything else in an answer is not fetched.
const MOS_INSTAGRAM_PICTURE_URL = '#^https://(?:[a-z0-9-]+\.)*(?:cdninstagram\.com|fbcdn\.net)/\S+\z#i';

// ---------------------------------------------------------------------------------------------------------------
// Pure rules (no WordPress calls; tests/mos_instagram_rules_test.php)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The posts worth showing from a `/me/media` answer, in its order (newest first): a numeric id, a permalink on
 * www.instagram.com, and an https picture on Instagram's CDN: a video's cover (`thumbnail_url`), otherwise `media_url` (a carousel
 * album's is its first item), falling back to `thumbnail_url` (Instagram omits `media_url` for videos with
 * licensed audio). Anything else is dropped, never guessed.
 *
 * @return list<array{id: string, href: string, caption: string, remote: string}>
 */
function mos_instagram_normalise(array $api, int $max = MOS_INSTAGRAM_POSTS): array {
    $items = $api['data'] ?? null;
    if (!is_array($items)) { return []; }
    $out = [];
    $seen = [];
    foreach ($items as $item) {
        if (count($out) >= $max) { break; }
        if (!is_array($item)) { continue; }
        $id = is_string($item['id'] ?? null) ? $item['id'] : '';
        if (!preg_match('/^\d{1,30}\z/', $id) || isset($seen[$id])) { continue; }
        $href = is_string($item['permalink'] ?? null) ? $item['permalink'] : '';
        if (!preg_match('#^https://www\.instagram\.com/(?:p|reel|tv)/[A-Za-z0-9_-]{1,64}/?\z#', $href)) { continue; }
        $media = is_string($item['media_url'] ?? null) ? $item['media_url'] : '';
        $thumb = is_string($item['thumbnail_url'] ?? null) ? $item['thumbnail_url'] : '';
        $remote = ($item['media_type'] ?? '') === 'VIDEO' ? $thumb : ($media !== '' ? $media : $thumb);
        if (!preg_match(MOS_INSTAGRAM_PICTURE_URL, $remote)) { continue; }
        $seen[$id] = true;
        $caption = is_string($item['caption'] ?? null) ? $item['caption'] : '';
        $out[] = ['id' => $id, 'href' => $href, 'caption' => mos_instagram_excerpt($caption), 'remote' => $remote];
    }
    return $out;
}

/** A caption as one plain line of at most `$limit` characters, cut on a word with "…" when longer. */
function mos_instagram_excerpt(string $caption, int $limit = 140): string {
    $text = html_entity_decode(strip_tags($caption), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = trim((string) preg_replace('/\s+/u', ' ', $text));
    if (mb_strlen($text) <= $limit) { return $text; }
    $cut = mb_substr($text, 0, $limit);
    $space = mb_strrpos($cut, ' ');
    if ($space !== false && $space > $limit / 2) { $cut = mb_substr($cut, 0, $space); }
    return preg_replace('/[\s,.;:\x{2013}-]+\z/u', '', $cut) . '…';
}

/** Whether a token issued (or last renewed) at `$issued` should be renewed now. */
function mos_instagram_token_due(int $issued, int $now): bool {
    return $issued <= 0 || $now - $issued > MOS_INSTAGRAM_TOKEN_RENEW_DAYS * DAY_IN_SECONDS;
}

/** Instagram tokens are long runs of letters, digits and a few separators; anything else is a paste mistake. */
function mos_instagram_token_shape_ok(string $token): bool {
    return (bool) preg_match('/^[A-Za-z0-9_\-.|]{40,1024}\z/', $token);
}

/** A message with any `access_token=` value replaced: WordPress's HTTP errors quote the whole request URL. */
function mos_instagram_redact(string $message): string {
    return (string) preg_replace('/(access(?:_|%5F)token=)[^&\s"\']+?(?=[&\s"\']|\.?\z)/i', '$1[redacted]', $message);
}

/** Whether a `/me/media` answer is a real list (possibly empty): anything else must not replace the stored feed. */
function mos_instagram_answer_usable(array $api): bool {
    return is_array($api['data'] ?? null);
}

/** Whether a token belongs to the store's own account (the row is labelled @musikogsport). */
function mos_instagram_account_ok(string $username): bool {
    return strcasecmp($username, MOS_INSTAGRAM_HANDLE) === 0;
}

/**
 * The public answer: only posts whose picture was mirrored, each as the storefront's tile. Built from the stored feed
 * field by field, so nothing else stored there (or the token) can leak into it.
 *
 * @return array{handle: string, profile_href: string, posts: list<array>}
 */
function mos_instagram_payload(array $feed, string $uploads_url): array {
    $base = rtrim($uploads_url, '/') . '/' . MOS_INSTAGRAM_DIR . '/';
    $posts = [];
    foreach (is_array($feed['posts'] ?? null) ? $feed['posts'] : [] as $p) {
        $file = is_array($p) && is_string($p['file'] ?? null) ? $p['file'] : '';
        if (!preg_match('/^\d{1,30}\.jpg\z/', $file)) { continue; }
        $caption = (string) ($p['caption'] ?? '');
        $posts[] = [
            'id' => (string) $p['id'],
            'href' => (string) $p['href'],
            'caption' => $caption,
            'image' => [
                'url' => $base . $file,
                'width' => (int) ($p['width'] ?? 0),
                'height' => (int) ($p['height'] ?? 0),
                'alt' => $caption !== '' ? $caption : 'Mynd af Instagram',
            ],
        ];
    }
    return [
        'handle' => MOS_INSTAGRAM_HANDLE,
        'profile_href' => 'https://www.instagram.com/' . MOS_INSTAGRAM_HANDLE . '/',
        'posts' => $posts,
    ];
}

// ---------------------------------------------------------------------------------------------------------------
// Token and API
// ---------------------------------------------------------------------------------------------------------------

/** The saved connection, or null when not connected. A `MOS_INSTAGRAM_TOKEN` constant (wp-config) wins; it is
 *  never renewed here, so whoever sets it rotates it. */
function mos_instagram_connection(): ?array {
    if (defined('MOS_INSTAGRAM_TOKEN') && is_string(MOS_INSTAGRAM_TOKEN) && MOS_INSTAGRAM_TOKEN !== '') {
        return ['token' => MOS_INSTAGRAM_TOKEN, 'issued' => PHP_INT_MAX, 'username' => '', 'constant' => true];
    }
    $saved = get_option(MOS_INSTAGRAM_TOKEN_OPTION);
    if (!is_array($saved) || !is_string($saved['token'] ?? null) || $saved['token'] === '') { return null; }
    return ['token' => $saved['token'], 'issued' => (int) ($saved['issued'] ?? 0),
        'username' => (string) ($saved['username'] ?? ''), 'constant' => false];
}

/** Log a problem (or, with `$problem` false, an event worth a trace: connect, renew, refresh). Never the token. */
function mos_instagram_log(string $message, bool $problem = true): void {
    $message = mos_instagram_redact($message);
    if (defined('WP_CLI') && WP_CLI) {
        $problem ? WP_CLI::warning($message) : WP_CLI::log($message);
        return;
    }
    error_log('[mos-instagram] ' . $message);
}

/** GET an Instagram endpoint as JSON, or null (logged without the token or its URL). */
function mos_instagram_get(string $url, array $query, string $label): ?array {
    $resp = wp_remote_get($url . '?' . http_build_query($query), ['timeout' => 8, 'redirection' => 0]);
    if (is_wp_error($resp)) {
        mos_instagram_log("$label failed: " . $resp->get_error_message());
        return null;
    }
    $code = (int) wp_remote_retrieve_response_code($resp);
    $body = json_decode((string) wp_remote_retrieve_body($resp), true);
    if ($code !== 200 || !is_array($body)) {
        $err = is_array($body) && is_array($body['error'] ?? null) ? (string) ($body['error']['message'] ?? '') : '';
        mos_instagram_log("$label -> HTTP $code" . ($err !== '' ? ": $err" : ''));
        return null;
    }
    return $body;
}

/** The account a token belongs to, or null when Instagram refuses it. */
function mos_instagram_whoami(string $token): ?string {
    $me = mos_instagram_get(MOS_INSTAGRAM_API . 'me', ['fields' => 'user_id,username', 'access_token' => $token], 'me');
    $name = is_array($me) ? (string) ($me['username'] ?? '') : '';
    return $name !== '' ? $name : null;
}

/** Renew a saved (not constant) token past MOS_INSTAGRAM_TOKEN_RENEW_DAYS; returns the token to use now. */
function mos_instagram_renew_if_due(array $conn): string {
    if ($conn['constant'] || !mos_instagram_token_due($conn['issued'], time())) { return $conn['token']; }
    $new = mos_instagram_get(MOS_INSTAGRAM_REFRESH_URL,
        ['grant_type' => 'ig_refresh_token', 'access_token' => $conn['token']], 'refresh_access_token');
    $token = is_array($new) && is_string($new['access_token'] ?? null) ? $new['access_token'] : '';
    if ($token === '') {
        mos_instagram_log('token renewal failed; the old one stays valid until day 60 and is tried again next refresh');
        return $conn['token'];
    }
    update_option(MOS_INSTAGRAM_TOKEN_OPTION,
        ['token' => $token, 'issued' => time(), 'username' => $conn['username']], false);
    mos_instagram_log('token renewed', false);
    return $token;
}

// ---------------------------------------------------------------------------------------------------------------
// Refresh: fetch, mirror, store
// ---------------------------------------------------------------------------------------------------------------

function mos_instagram_dir(): string {
    return trailingslashit(wp_upload_dir()['basedir']) . MOS_INSTAGRAM_DIR;
}

/**
 * Mirror one picture as `<id>.jpg`: a centred square, at most MOS_INSTAGRAM_SIZE px, re-encoded through the image
 * editor (so only a real image is ever written). Keeps an existing file. Returns [file, width, height] or null.
 */
function mos_instagram_mirror(string $id, string $remote, string $dir): ?array {
    $file = $id . '.jpg';
    $path = "$dir/$file";
    if (is_file($path)) {
        $size = @getimagesize($path);
        if (is_array($size)) { return [$file, (int) $size[0], (int) $size[1]]; }
        @unlink($path);
    }
    if (!function_exists('download_url')) { require_once ABSPATH . 'wp-admin/includes/file.php'; }
    $tmp = download_url($remote, 10);
    if (is_wp_error($tmp)) {
        mos_instagram_log("picture $id: " . $tmp->get_error_message());
        return null;
    }
    $bytes = (int) @filesize($tmp);
    $editor = $bytes > 0 && $bytes <= MOS_INSTAGRAM_MAX_BYTES ? wp_get_image_editor($tmp) : null;
    $result = null;
    if ($editor !== null && !is_wp_error($editor)) {
        $size = $editor->get_size();
        $side = min((int) $size['width'], (int) $size['height']);
        $out = min($side, MOS_INSTAGRAM_SIZE);
        if ($side > 0) {
            $editor->set_quality(82);
            $cropped = $editor->crop(intdiv((int) $size['width'] - $side, 2), intdiv((int) $size['height'] - $side, 2),
                $side, $side, $out, $out);
            $saved = is_wp_error($cropped) ? $cropped : $editor->save($path, 'image/jpeg');
            if (!is_wp_error($saved)) { $result = [$file, $out, $out]; }
        }
    }
    @unlink($tmp);
    if ($result === null) { mos_instagram_log("picture $id: not a usable image"); }
    return $result;
}

/**
 * Fetch the latest posts and mirror their pictures; on success the stored feed is replaced and pictures no longer in
 * it are deleted. On any failure the last good feed stays. Returns whether it succeeded.
 */
function mos_instagram_refresh(): bool {
    $conn = mos_instagram_connection();
    if ($conn === null) { return false; }
    $token = mos_instagram_renew_if_due($conn);
    $api = mos_instagram_get(MOS_INSTAGRAM_API . 'me/media', [
        'fields' => 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',
        'limit' => (string) MOS_INSTAGRAM_POSTS,
        'access_token' => $token,
    ], 'me/media');
    if ($api === null) { return false; }
    if (!mos_instagram_answer_usable($api)) {
        mos_instagram_log('me/media answered without a post list; the last feed stays');
        return false;
    }
    $dir = mos_instagram_dir();
    if (!wp_mkdir_p($dir)) {
        mos_instagram_log('cannot create uploads/' . MOS_INSTAGRAM_DIR);
        return false;
    }
    $normalised = mos_instagram_normalise($api);
    $posts = [];
    foreach ($normalised as $p) {
        $m = mos_instagram_mirror($p['id'], $p['remote'], $dir);
        if ($m === null) { continue; }
        [$file, $w, $h] = $m;
        $posts[] = ['id' => $p['id'], 'href' => $p['href'], 'caption' => $p['caption'], 'file' => $file,
            'width' => $w, 'height' => $h];
    }
    if ($posts === [] && $normalised !== []) {
        mos_instagram_log('no picture could be copied; the last feed stays');
        return false;
    }
    update_option(MOS_INSTAGRAM_FEED_OPTION, ['fetched' => time(), 'posts' => $posts], false);
    mos_instagram_prune($dir, array_column($posts, 'file'));
    mos_instagram_log(sprintf('feed refreshed: %d posts', count($posts)), false);
    return true;
}

/** Delete mirrored pictures not in `$keep` (only our own `<digits>.jpg` names). */
function mos_instagram_prune(string $dir, array $keep): void {
    $keep = array_flip($keep);
    foreach (glob("$dir/*.jpg") ?: [] as $path) {
        $name = basename($path);
        if (preg_match('/^\d{1,30}\.jpg\z/', $name) && !isset($keep[$name])) { @unlink($path); }
    }
}

/** Take the refresh lock (atomic: add_option inserts or fails); a lock older than its TTL is a crashed run's. */
function mos_instagram_lock(): bool {
    if (add_option(MOS_INSTAGRAM_LOCK, time(), '', false)) { return true; }
    if (time() - (int) get_option(MOS_INSTAGRAM_LOCK, 0) < MOS_INSTAGRAM_LOCK_TTL) { return false; }
    delete_option(MOS_INSTAGRAM_LOCK);
    return add_option(MOS_INSTAGRAM_LOCK, time(), '', false);
}

function mos_instagram_unlock(): void {
    delete_option(MOS_INSTAGRAM_LOCK);
}

/** Whether a refresh is due: connected, and an hour past a success (15 minutes past a failure). */
function mos_instagram_due(): bool {
    return mos_instagram_connection() !== null && get_transient(MOS_INSTAGRAM_FRESH) === false;
}

/** Refresh now under the lock and set the next due time. Null when not due or another refresh is running. */
function mos_instagram_maybe_refresh(bool $force = false): ?bool {
    $wanted = $force ? mos_instagram_connection() !== null : mos_instagram_due();
    if (!$wanted || !mos_instagram_lock()) { return null; }
    try {
        $ok = mos_instagram_refresh();
        set_transient(MOS_INSTAGRAM_FRESH, 1, $ok ? HOUR_IN_SECONDS : 15 * MINUTE_IN_SECONDS);
        return $ok;
    } finally {
        mos_instagram_unlock();
    }
}

/** The public GET never waits for Instagram: a due refresh runs at shutdown, after the answer has been sent. */
function mos_instagram_refresh_after_response(): void {
    if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); }
    ignore_user_abort(true);
    mos_instagram_maybe_refresh();
}

/** Forget the connection, the feed and the mirrored pictures. */
function mos_instagram_disconnect(): void {
    delete_option(MOS_INSTAGRAM_TOKEN_OPTION);
    delete_option(MOS_INSTAGRAM_FEED_OPTION);
    delete_transient(MOS_INSTAGRAM_FRESH);
    mos_instagram_unlock();
    mos_instagram_prune(mos_instagram_dir(), []);
}

// ---------------------------------------------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------------------------------------------

add_action('rest_api_init', static function () {
    register_rest_route('mos/v1', '/instagram', [
        'methods'             => 'GET',
        'permission_callback' => '__return_true', // public, read-only
        'callback'            => 'mos_instagram_rest',
    ]);
});

function mos_instagram_rest(): WP_REST_Response {
    if (mos_instagram_due() && !has_action('shutdown', 'mos_instagram_refresh_after_response')) {
        add_action('shutdown', 'mos_instagram_refresh_after_response');
    }
    $feed = get_option(MOS_INSTAGRAM_FEED_OPTION);
    $payload = mos_instagram_payload(is_array($feed) ? $feed : [], (string) wp_upload_dir()['baseurl']);
    $response = new WP_REST_Response($payload, 200);
    $response->header('Cache-Control', 'public, max-age=60'); // as the other public mos/v1 reads
    return $response;
}

// ---------------------------------------------------------------------------------------------------------------
// wp-admin: the "Instagram" box on the Stillingar page (administrators only)
// ---------------------------------------------------------------------------------------------------------------

const MOS_INSTAGRAM_NOTICES = [
    'connected'    => ['success', 'Instagram tengt. Færslurnar birtast á forsíðunni innan fárra mínútna.'],
    'invalid'      => ['error', 'Instagram hafnaði lyklinum. Afritaðu hann aftur úr Meta (Generate access tokens).'],
    'shape'        => ['error', 'Þetta lítur ekki út eins og Instagram-lykill.'],
    'account'      => ['error', 'Lykillinn er fyrir annan Instagram-aðgang en @' . MOS_INSTAGRAM_HANDLE . '.'],
    'disconnected' => ['success', 'Instagram aftengt. Forsíðan sýnir „Fylgdu okkur“ í staðinn.'],
];

function mos_instagram_admin_url(string $notice): string {
    $slug = defined('MOS_STILLINGAR_SLUG') ? MOS_STILLINGAR_SLUG : 'mos-stillingar';
    return add_query_arg(['page' => $slug, 'mos_ig' => $notice], admin_url('admin.php'));
}

add_action('mos_stillingar_after', 'mos_instagram_admin_box');

function mos_instagram_admin_box(): void {
    if (!current_user_can('manage_options')) { return; }
    $notice = isset($_GET['mos_ig']) ? sanitize_key(wp_unslash($_GET['mos_ig'])) : '';
    echo '<hr style="margin:32px 0 16px"><h2 id="instagram">Instagram</h2>';
    if (isset(MOS_INSTAGRAM_NOTICES[$notice])) {
        [$kind, $text] = MOS_INSTAGRAM_NOTICES[$notice];
        echo '<div class="notice notice-' . esc_attr($kind) . ' inline"><p>' . esc_html($text) . '</p></div>';
    }
    $conn = mos_instagram_connection();
    $feed = get_option(MOS_INSTAGRAM_FEED_OPTION);
    $count = is_array($feed) && is_array($feed['posts'] ?? null) ? count($feed['posts']) : 0;
    $fetched = is_array($feed) ? (int) ($feed['fetched'] ?? 0) : 0;
    $post_url = admin_url('admin-post.php');
    if ($conn === null) {
        echo '<p>Ekki tengt: forsíðan sýnir „Fylgdu okkur á Instagram“. Til að sýna nýjustu færslurnar: búðu til '
            . 'aðgangslykil í Meta (Instagram API with Instagram Login → Generate access tokens) og límdu hann hér.</p>';
    } else {
        $who = $conn['username'] !== '' ? '@' . $conn['username'] : 'lykli úr wp-config.php';
        $when = $fetched > 0 ? wp_date('j.n.Y H:i', $fetched) : 'aldrei';
        echo '<p>Tengt sem <strong>' . esc_html($who) . '</strong>. ' . (int) $count . ' færslur á forsíðunni, '
            . 'síðast sóttar ' . esc_html($when) . '. '
            . ($conn['constant'] ? 'Lykillinn er í wp-config.php og endurnýjast ekki sjálfkrafa.'
                : 'Lykillinn var endurnýjaður ' . esc_html(wp_date('j.n.Y', $conn['issued'])) . ' og endurnýjast sjálfkrafa.')
            . '</p>';
    }
    if ($conn === null || !$conn['constant']) {
        echo '<form method="post" action="' . esc_url($post_url) . '" style="display:flex;gap:8px;max-width:640px">';
        echo '<input type="hidden" name="action" value="mos_instagram_token">';
        wp_nonce_field('mos_instagram_token');
        echo '<input type="password" name="token" class="regular-text" style="flex:1" autocomplete="off" '
            . 'spellcheck="false" placeholder="' . ($conn === null ? 'Aðgangslykill' : 'Nýr aðgangslykill') . '" '
            . 'aria-label="Aðgangslykill Instagram" required>';
        echo '<button class="button button-primary">' . ($conn === null ? 'Tengja' : 'Skipta um lykil') . '</button></form>';
    }
    if ($conn !== null && !$conn['constant']) {
        echo '<form method="post" action="' . esc_url($post_url) . '" style="margin-top:8px">';
        echo '<input type="hidden" name="action" value="mos_instagram_disconnect">';
        wp_nonce_field('mos_instagram_disconnect');
        echo '<button class="button">Aftengja</button></form>';
    }
}

add_action('admin_post_mos_instagram_token', 'mos_instagram_handle_token');
add_action('admin_post_mos_instagram_disconnect', 'mos_instagram_handle_disconnect');

function mos_instagram_handle_token(): void {
    if (!current_user_can('manage_options')) {
        wp_die('Aðeins stjórnendur geta tengt Instagram.', 'Instagram', ['response' => 403]);
    }
    check_admin_referer('mos_instagram_token');
    $token = isset($_POST['token']) ? trim((string) wp_unslash($_POST['token'])) : '';
    if (!mos_instagram_token_shape_ok($token)) {
        wp_safe_redirect(mos_instagram_admin_url('shape') . '#instagram');
        exit;
    }
    $username = mos_instagram_whoami($token);
    if ($username === null) {
        wp_safe_redirect(mos_instagram_admin_url('invalid') . '#instagram');
        exit;
    }
    if (!mos_instagram_account_ok($username)) {
        mos_instagram_log("token refused: it belongs to @$username");
        wp_safe_redirect(mos_instagram_admin_url('account') . '#instagram');
        exit;
    }
    // A token from the dashboard is new: count its 60 days from now.
    update_option(MOS_INSTAGRAM_TOKEN_OPTION, ['token' => $token, 'issued' => time(), 'username' => $username], false);
    mos_instagram_log(sprintf('connected as @%s by user %d', $username, get_current_user_id()), false);
    mos_instagram_maybe_refresh(true);
    wp_safe_redirect(mos_instagram_admin_url('connected') . '#instagram');
    exit;
}

function mos_instagram_handle_disconnect(): void {
    if (!current_user_can('manage_options')) {
        wp_die('Aðeins stjórnendur geta aftengt Instagram.', 'Instagram', ['response' => 403]);
    }
    check_admin_referer('mos_instagram_disconnect');
    mos_instagram_disconnect();
    mos_instagram_log(sprintf('disconnected by user %d', get_current_user_id()), false);
    wp_safe_redirect(mos_instagram_admin_url('disconnected') . '#instagram');
    exit;
}

// ---------------------------------------------------------------------------------------------------------------
// WP-CLI: wp mos-instagram status | refresh
// ---------------------------------------------------------------------------------------------------------------

if (defined('WP_CLI') && WP_CLI) {
    WP_CLI::add_command('mos-instagram status', static function (): void {
        $conn = mos_instagram_connection();
        if ($conn === null) { WP_CLI::log('Not connected (the storefront shows the follow banner).'); return; }
        $feed = get_option(MOS_INSTAGRAM_FEED_OPTION);
        $posts = is_array($feed) && is_array($feed['posts'] ?? null) ? count($feed['posts']) : 0;
        $fetched = is_array($feed) ? (int) ($feed['fetched'] ?? 0) : 0;
        WP_CLI::log(sprintf('Connected as %s; token %s; %d posts, fetched %s.',
            $conn['username'] !== '' ? '@' . $conn['username'] : '(wp-config constant)',
            $conn['constant'] ? 'from MOS_INSTAGRAM_TOKEN (not auto-renewed)' : 'renewed ' . gmdate('Y-m-d', $conn['issued']),
            $posts, $fetched > 0 ? gmdate('Y-m-d H:i', $fetched) . ' UTC' : 'never'));
    });
    WP_CLI::add_command('mos-instagram refresh', static function (): void {
        if (mos_instagram_connection() === null) { WP_CLI::error('Not connected.'); }
        $ok = mos_instagram_maybe_refresh(true);
        if ($ok === null) { WP_CLI::error('Another refresh is running; try again in a few minutes.'); }
        if ($ok === false) { WP_CLI::error('Refresh failed (see the warnings above); the last feed stays.'); }
        $feed = get_option(MOS_INSTAGRAM_FEED_OPTION);
        $posts = is_array($feed) && is_array($feed['posts'] ?? null) ? count($feed['posts']) : 0;
        WP_CLI::success("$posts posts stored.");
    });
}
