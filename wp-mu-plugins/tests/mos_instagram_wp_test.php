<?php
/**
 * WordPress-level test for ../mos-instagram.php, with Meta's Graph API stubbed through `pre_http_request` (no real call):
 *  - not connected: `GET mos/v1/instagram` answers the handle and no posts (the storefront's follow banner);
 *  - the GET never calls Instagram itself: a due refresh is queued for shutdown (after the answer); it is public-cached
 *    for a minute like the other mos/v1 reads;
 *  - connected: a refresh mirrors each kept post's picture as a centred square (≤ 640 px) and the answer lists them,
 *    never the token; within the hour nothing is due;
 *  - Instagram down (500), an answer without a post list, or every picture failing: the last good feed stays (no
 *    picture deleted), retried after 15 minutes; one refresh at a time (atomic lock; a crashed run's lock expires);
 *  - posts are read from the saved account ID's `/media`; a later, shorter feed deletes the pictures it dropped;
 *  - the token form: refused without manage_options, without a valid nonce, for a malformed token or account ID, for
 *    a token or account ID Meta rejects and for another account (the saved one stays); a good pair is saved with its
 *    username and fetched at once; the Stillingar box is not shown to non-administrators and never echoes the token.
 *
 * Writes only its own options/transients and uploads/mos-instagram/ test files, and puts the previous ones back.
 * Run (local site, after copying the plugin in): wpms eval-file wp-mu-plugins/tests/mos_instagram_wp_test.php
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($ok || $detail === '' ? '' : " — $detail") . "\n";
    if (!$ok) { $fail++; }
};

if (!function_exists('mos_instagram_rest')) {
    echo "FAIL mos-instagram.php is not installed in mu-plugins\n";
    return;
}

final class MosIgDie extends Exception {}
final class MosIgRedirect extends Exception {}

$backup = [
    'token' => get_option(MOS_INSTAGRAM_TOKEN_OPTION),
    'feed' => get_option(MOS_INSTAGRAM_FEED_OPTION),
    'fresh' => get_transient(MOS_INSTAGRAM_FRESH),
];
$backup_user = get_current_user_id();
$dir = mos_instagram_dir();
$before_files = glob("$dir/*.jpg") ?: [];

// The stub: `$mode` picks Instagram's behaviour; `$calls` counts what was asked.
$mode = 'ok';
$feed_posts = [];
$account = 'musikogsport';
$media_body = null; // null: {"data": $feed_posts}
$calls = [];
$token = 'EAAtest' . str_repeat('k', 60);
$account_id = '17841400000000001'; // the only account ID the stub knows
$jpeg = static function (string $path, int $w, int $h): void {
    $im = imagecreatetruecolor($w, $h);
    imagefill($im, 0, 0, imagecolorallocate($im, 240, 90, 20));
    imagejpeg($im, $path, 90);
    imagedestroy($im);
};
$stub = static function ($pre, $args, $url) use (&$mode, &$feed_posts, &$calls, &$account, &$media_body, $account_id, $jpeg) {
    $host = (string) parse_url($url, PHP_URL_HOST);
    $path = (string) parse_url($url, PHP_URL_PATH);
    $ok = static fn(string $body) => ['headers' => [], 'body' => $body, 'response' => ['code' => 200, 'message' => 'OK'],
        'cookies' => [], 'filename' => null];
    $fail = static fn(int $code, string $message) => ['headers' => [], 'response' => ['code' => $code, 'message' => 'Error'],
        'body' => (string) json_encode(['error' => ['message' => $message]]), 'cookies' => [], 'filename' => null];
    if ($host === 'graph.facebook.com') {
        $calls[] = $path;
        if ($mode === 'down') { return $fail(500, 'Service unavailable'); }
        if (!preg_match('#^/v26\.0/(\d+)(/media)?\z#', $path, $m)) { return $fail(400, 'Unknown path'); }
        if ($m[1] !== $account_id) { return $fail(400, 'Unsupported get request'); }
        return ($m[2] ?? '') === '/media'
            ? $ok($media_body ?? (string) json_encode(['data' => $feed_posts]))
            : $ok((string) json_encode(['id' => $account_id, 'username' => $account]));
    }
    if ($host === 'scontent.cdninstagram.com') {
        $calls[] = 'picture';
        if ($mode === 'pictures-404') {
            return ['headers' => [], 'body' => '', 'response' => ['code' => 404, 'message' => 'Not Found'],
                'cookies' => [], 'filename' => $args['filename'] ?? null];
        }
        if (!empty($args['filename'])) { $jpeg($args['filename'], 1200, 900); }
        return ['headers' => [], 'body' => '', 'response' => ['code' => 200, 'message' => 'OK'], 'cookies' => [],
            'filename' => $args['filename'] ?? null];
    }
    return $pre;
};
$post = static fn(string $id, array $over = []) => $over + [
    'id' => $id, 'caption' => "Færsla $id", 'media_type' => 'IMAGE',
    'media_url' => "https://scontent.cdninstagram.com/$id.jpg", 'permalink' => "https://www.instagram.com/p/T$id/",
];
$ask = static function (): array {
    $res = rest_do_request(new WP_REST_Request('GET', '/mos/v1/instagram'));
    return ['status' => $res->get_status(), 'data' => $res->get_data()];
};
$reset = static function (): void {
    delete_transient(MOS_INSTAGRAM_FRESH);
    mos_instagram_unlock();
};
// What the queued shutdown refresh does, run here (WP-CLI's own shutdown must never reach Instagram).
$refresh = static function () {
    remove_action('shutdown', 'mos_instagram_refresh_after_response');
    return mos_instagram_maybe_refresh();
};
$die_handler = static fn() => static function ($message, $title = '', $args = []) {
    throw new MosIgDie(is_array($args) ? (string) ($args['response'] ?? '') : '');
};
$redirect = static function ($location) { throw new MosIgRedirect((string) $location); };

add_filter('pre_http_request', $stub, 10, 3);
add_filter('wp_die_handler', $die_handler, PHP_INT_MAX);
add_filter('wp_redirect', $redirect, PHP_INT_MAX);

try {
    // --- not connected ---
    delete_option(MOS_INSTAGRAM_TOKEN_OPTION);
    delete_option(MOS_INSTAGRAM_FEED_OPTION);
    $reset();
    $r = $ask();
    $check('not connected: 200 with the handle', $r['status'] === 200 && ($r['data']['handle'] ?? '') === 'musikogsport'
        && ($r['data']['profile_href'] ?? '') === 'https://www.instagram.com/musikogsport/');
    $check('not connected: no posts', ($r['data']['posts'] ?? null) === []);
    $check('not connected: Instagram not called', $calls === [], implode(',', $calls));

    // --- connected: refresh and mirror ---
    update_option(MOS_INSTAGRAM_TOKEN_OPTION,
        ['token' => $token, 'account_id' => $account_id, 'username' => 'musikogsport'], false);
    $feed_posts = [
        $post('990001'),
        $post('990002', ['media_type' => 'VIDEO', 'media_url' => 'https://scontent.cdninstagram.com/v.mp4',
            'thumbnail_url' => 'https://scontent.cdninstagram.com/990002.jpg', 'permalink' => 'https://www.instagram.com/reel/T990002/']),
        $post('990003', ['permalink' => 'https://evil.example/p/x/']),
    ];
    $reset();
    $calls = [];
    $res = rest_do_request(new WP_REST_Request('GET', '/mos/v1/instagram'));
    $check('due: the GET calls nobody itself', $calls === [], implode(',', $calls));
    $check('due: a refresh is queued for after the answer',
        has_action('shutdown', 'mos_instagram_refresh_after_response') !== false);
    $check('answer is public-cached for a minute', ($res->get_headers()['Cache-Control'] ?? '') === 'public, max-age=60');
    $check('connected: the refresh succeeds', $refresh() === true);
    $r = $ask();
    $posts = $r['data']['posts'] ?? [];
    $check('connected: two kept posts', count($posts) === 2, (string) count($posts));
    $check('connected: newest first', array_column($posts, 'id') === ['990001', '990002']);
    $first = $posts[0] ?? [];
    $check('connected: tile shape', ($first['href'] ?? '') === 'https://www.instagram.com/p/T990001/'
        && ($first['caption'] ?? '') === 'Færsla 990001' && ($first['image']['alt'] ?? '') === 'Færsla 990001'
        && str_ends_with((string) ($first['image']['url'] ?? ''), '/' . MOS_INSTAGRAM_DIR . '/990001.jpg'));
    $size = @getimagesize("$dir/990001.jpg");
    $check('mirror: square, capped at 640', is_array($size) && $size[0] === 640 && $size[1] === 640 && $size['mime'] === 'image/jpeg',
        is_array($size) ? "{$size[0]}x{$size[1]}" : 'missing');
    $check('mirror: dimensions in the answer', ($first['image']['width'] ?? 0) === 640 && ($first['image']['height'] ?? 0) === 640);
    $check('mirror: video uses its cover', is_file("$dir/990002.jpg"));
    $check('mirror: dropped post has no file', !is_file("$dir/990003.jpg"));
    $json = (string) wp_json_encode($r['data']);
    $check('answer never carries the token', !str_contains($json, $token) && !str_contains($json, 'EAA'));
    $check('posts read from the saved account', in_array("/v26.0/$account_id/media", $calls, true), implode(',', $calls));

    $calls = [];
    $ask();
    $check('within the hour: nothing queued', has_action('shutdown', 'mos_instagram_refresh_after_response') === false);
    $check('within the hour: nothing due', $refresh() === null && $calls === [], implode(',', $calls));

    // --- one refresh at a time ---
    $reset();
    $check('lock: taken', mos_instagram_lock());
    $check('lock: a second run waits', !mos_instagram_lock() && $refresh() === null);
    update_option(MOS_INSTAGRAM_LOCK, time() - MOS_INSTAGRAM_LOCK_TTL - 1, false);
    $check('lock: a crashed run\'s lock expires', mos_instagram_lock());
    mos_instagram_unlock();

    // --- Instagram down: last good feed stays ---
    $mode = 'down';
    $reset();
    $check('down: the refresh fails', $refresh() === false);
    $r = $ask();
    $check('down: last good feed served', count($r['data']['posts'] ?? []) === 2);
    $ttl = (int) get_option('_transient_timeout_' . MOS_INSTAGRAM_FRESH) - time();
    $check('down: retried after about 15 minutes', $ttl > 10 * MINUTE_IN_SECONDS && $ttl <= 15 * MINUTE_IN_SECONDS, (string) $ttl);

    // --- every picture fails: last good feed stays ---
    // --- a 200 without a post list: last good feed stays, no picture deleted ---
    $mode = 'ok';
    $media_body = '{"paging":{}}';
    $reset();
    $check('no post list: the refresh fails', $refresh() === false);
    $r = $ask();
    $check('no post list: last good feed served', array_column($r['data']['posts'] ?? [], 'id') === ['990001', '990002']);
    $check('no post list: pictures kept', is_file("$dir/990001.jpg") && is_file("$dir/990002.jpg"));
    $media_body = null;

    $mode = 'pictures-404';
    $feed_posts = [$post('990004'), $post('990005')];
    $reset();
    $refresh();
    $r = $ask();
    $check('pictures fail: last good feed served', array_column($r['data']['posts'] ?? [], 'id') === ['990001', '990002']);

    // --- a picture outside Instagram's CDN is never fetched ---
    $mode = 'ok';
    $feed_posts = [$post('990006', ['media_url' => 'https://evil.example/990006.jpg'])];
    $reset();
    $calls = [];
    $refresh();
    $check('foreign picture host: not fetched', !in_array('picture', $calls, true) && !is_file("$dir/990006.jpg"));

    // --- pruning ---
    $mode = 'ok';
    $feed_posts = [$post('990001')];
    $reset();
    $refresh();
    $r = $ask();
    $check('shorter feed: one post', array_column($r['data']['posts'] ?? [], 'id') === ['990001']);
    $check('shorter feed: dropped picture deleted', !is_file("$dir/990002.jpg") && is_file("$dir/990001.jpg"));

    // --- the token form ---
    $admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
    $admin = (int) ($admins[0] ?? 0);
    $saved_before = get_option(MOS_INSTAGRAM_TOKEN_OPTION);

    wp_set_current_user(0);
    $other = 'EAAother' . str_repeat('o', 60);
    $_POST = $_REQUEST = ['token' => $other, 'account_id' => $account_id];
    try { mos_instagram_handle_token(); $check('form: anonymous refused', false, 'no die'); }
    catch (MosIgDie $e) { $check('form: anonymous refused (403)', $e->getMessage() === '403', $e->getMessage()); }

    $check('form: an administrator exists', $admin > 0);
    wp_set_current_user($admin);
    try { mos_instagram_handle_token(); $check('form: no nonce refused', false, 'no die'); }
    catch (MosIgDie $e) { $check('form: no nonce refused', true); }
    catch (MosIgRedirect $e) { $check('form: no nonce refused', false, 'redirected'); }

    $form = static function (string $tok, string $id): array {
        return ['token' => $tok, 'account_id' => $id, '_wpnonce' => wp_create_nonce('mos_instagram_token')];
    };
    $submit = static function (string $name, string $notice) use ($check): void {
        try { mos_instagram_handle_token(); $check($name, false, 'no redirect'); }
        catch (MosIgRedirect $e) { $check("$name -> $notice notice", str_contains($e->getMessage(), "mos_ig=$notice#"), $e->getMessage()); }
    };
    $_POST = $_REQUEST = $form('not a token', $account_id);
    $submit('form: malformed token', 'shape');
    $_POST = $_REQUEST = $form($other, '1784140000000000x');
    $calls = [];
    $submit('form: malformed account ID', 'account_id');
    $check('form: malformed account ID never sent to Meta', $calls === [], implode(',', $calls));
    $_POST = $_REQUEST = $form($other, '17841499999999999');
    $submit('form: account ID Meta does not know', 'invalid');

    $mode = 'down';
    $_POST = $_REQUEST = $form($other, $account_id);
    $submit('form: rejected token', 'invalid');
    $mode = 'ok';
    $account = 'someoneelse';
    $_POST = $_REQUEST = $form($other, $account_id);
    $submit('form: another account', 'account');
    $account = 'musikogsport';
    $check('form: saved token kept after failures', get_option(MOS_INSTAGRAM_TOKEN_OPTION) === $saved_before);

    $_POST = $_REQUEST = $form($other, $account_id);
    $calls = [];
    $submit('form: good pair', 'connected');
    $saved = get_option(MOS_INSTAGRAM_TOKEN_OPTION);
    $check('form: good pair saved with its username', $saved === ['token' => $other, 'account_id' => $account_id,
        'username' => 'musikogsport'], (string) wp_json_encode(array_keys((array) $saved)));
    $check('form: good pair fetched at once', in_array("/v26.0/$account_id/media", $calls, true));

    $_GET = [];
    ob_start();
    mos_instagram_admin_box();
    $box = (string) ob_get_clean();
    $check('box: shown to an administrator', str_contains($box, 'Instagram') && str_contains($box, '@musikogsport'));
    $check('box: never echoes the token', !str_contains($box, $other) && !str_contains($box, 'EAA'));
    $check('box: account ID prefilled', str_contains($box, 'name="account_id"') && str_contains($box, 'value="' . $account_id . '"'));
    $check('box: says the key does not expire', str_contains($box, 'rennur ekki út'));
    $deny = static function ($caps) { $caps['manage_options'] = false; return $caps; };
    add_filter('user_has_cap', $deny);
    ob_start();
    mos_instagram_admin_box();
    $check('box: hidden without manage_options', (string) ob_get_clean() === '');
    remove_filter('user_has_cap', $deny);

    // --- disconnect ---
    $_POST = $_REQUEST = ['_wpnonce' => wp_create_nonce('mos_instagram_disconnect')];
    try { mos_instagram_handle_disconnect(); } catch (MosIgRedirect $e) {
        $check('disconnect -> notice', str_contains($e->getMessage(), 'mos_ig=disconnected'));
    }
    $check('disconnect: everything forgotten', get_option(MOS_INSTAGRAM_TOKEN_OPTION) === false
        && get_option(MOS_INSTAGRAM_FEED_OPTION) === false && !is_file("$dir/990001.jpg"));

    // --- a saved token without an account ID (e.g. from the first, Instagram Login build) is named, not silent ---
    update_option(MOS_INSTAGRAM_TOKEN_OPTION, ['token' => $other, 'issued' => time(), 'username' => 'musikogsport'], false);
    $check('legacy save: not connected', mos_instagram_connection() === null);
    $check('legacy save: problem named', str_contains((string) mos_instagram_config_problem(), 'auðkenni'));
    ob_start();
    mos_instagram_admin_box();
    $check('legacy save: box warns', str_contains((string) ob_get_clean(), 'notice-warning'));

    // --- wp-config override (last: constants cannot be undone in this process) ---
    update_option(MOS_INSTAGRAM_TOKEN_OPTION, ['token' => $other, 'account_id' => $account_id, 'username' => 'musikogsport'], false);
    $check('good save: no problem', mos_instagram_config_problem() === null);
    if (!defined('MOS_INSTAGRAM_TOKEN')) { define('MOS_INSTAGRAM_TOKEN', $token); }
    $conn = mos_instagram_connection();
    $check('override: a lone MOS_INSTAGRAM_TOKEN falls back to the saved pair',
        ($conn['token'] ?? '') === $other && ($conn['constant'] ?? null) === false);
    $check('override: a lone constant is named as a problem',
        str_contains((string) mos_instagram_config_problem(), 'MOS_INSTAGRAM_ACCOUNT_ID'));
    if (!defined('MOS_INSTAGRAM_ACCOUNT_ID')) { define('MOS_INSTAGRAM_ACCOUNT_ID', '17841400000000002'); }
    $conn = mos_instagram_connection();
    $check('override: the constant pair wins over the saved one', ($conn['token'] ?? '') === MOS_INSTAGRAM_TOKEN
        && ($conn['account_id'] ?? '') === '17841400000000002' && ($conn['constant'] ?? null) === true);
    $check('override: a complete pair is no problem', mos_instagram_config_problem() === null);
    ob_start();
    mos_instagram_admin_box();
    $box = (string) ob_get_clean();
    $check('override: box shows no token form', !str_contains($box, 'name="token"') && str_contains($box, 'wp-config.php'));
} catch (Throwable $e) {
    $check('no unexpected error', false, get_class($e) . ': ' . $e->getMessage());
} finally {
    remove_action('shutdown', 'mos_instagram_refresh_after_response');
    remove_filter('pre_http_request', $stub, 10);
    remove_filter('wp_die_handler', $die_handler, PHP_INT_MAX);
    remove_filter('wp_redirect', $redirect, PHP_INT_MAX);
    $_POST = $_REQUEST = $_GET = [];
    wp_set_current_user($backup_user);
    foreach (['990001', '990002', '990003', '990004', '990005', '990006'] as $id) {
        if (!in_array("$dir/$id.jpg", $before_files, true)) { @unlink("$dir/$id.jpg"); }
    }
    $backup['token'] === false ? delete_option(MOS_INSTAGRAM_TOKEN_OPTION) : update_option(MOS_INSTAGRAM_TOKEN_OPTION, $backup['token'], false);
    $backup['feed'] === false ? delete_option(MOS_INSTAGRAM_FEED_OPTION) : update_option(MOS_INSTAGRAM_FEED_OPTION, $backup['feed'], false);
    $backup['fresh'] === false ? delete_transient(MOS_INSTAGRAM_FRESH) : set_transient(MOS_INSTAGRAM_FRESH, 1, HOUR_IN_SECONDS);
    mos_instagram_unlock();
}

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
