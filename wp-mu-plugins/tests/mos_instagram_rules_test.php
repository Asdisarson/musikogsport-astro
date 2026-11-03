<?php
/**
 * Unit test for the pure rules in ../mos-instagram.php (no WordPress needed): the API normaliser (which posts are
 * kept, which picture each one uses), the caption excerpt, when the token is renewed, and the public payload (never
 * the token, only mirrored files).
 *
 * Run: php wp-mu-plugins/tests/mos_instagram_rules_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
const DAY_IN_SECONDS = 86400;
const HOUR_IN_SECONDS = 3600;
const MINUTE_IN_SECONDS = 60;
function add_action(...$args): void {}
function add_filter(...$args): void {}

require __DIR__ . '/../mos-instagram.php';

$pass = 0;
$fail = 0;
function check(string $label, $got, $want): void {
    global $pass, $fail;
    if ($got === $want) { $pass++; return; }
    $fail++;
    printf("FAIL %s\n  want %s\n  got  %s\n", $label, json_encode($want, JSON_UNESCAPED_UNICODE), json_encode($got, JSON_UNESCAPED_UNICODE));
}

function post(array $over = []): array {
    return $over + [
        'id' => '17900000000000001',
        'caption' => 'Ný sending af hlaupaskóm',
        'media_type' => 'IMAGE',
        'media_url' => 'https://scontent.cdninstagram.com/a.jpg',
        'permalink' => 'https://www.instagram.com/p/DfPHivOjHad/',
        'timestamp' => '2026-11-01T10:00:00+0000',
    ];
}

// --- normaliser ---
$one = mos_instagram_normalise(['data' => [post()]]);
check('image post kept', $one, [[
    'id' => '17900000000000001', 'href' => 'https://www.instagram.com/p/DfPHivOjHad/',
    'caption' => 'Ný sending af hlaupaskóm', 'remote' => 'https://scontent.cdninstagram.com/a.jpg',
]]);

$video = mos_instagram_normalise(['data' => [post(['media_type' => 'VIDEO', 'media_url' => 'https://x.cdninstagram.com/v.mp4',
    'thumbnail_url' => 'https://x.cdninstagram.com/t.jpg', 'permalink' => 'https://www.instagram.com/reel/DfPEm6XsuvX/'])]]);
check('video uses its cover picture', $video[0]['remote'] ?? null, 'https://x.cdninstagram.com/t.jpg');
check('reel permalink kept', $video[0]['href'] ?? null, 'https://www.instagram.com/reel/DfPEm6XsuvX/');

$noAudioUrl = mos_instagram_normalise(['data' => [post(['media_type' => 'VIDEO', 'media_url' => null, 'thumbnail_url' => null])]]);
check('video without any picture dropped', $noAudioUrl, []);

$album = mos_instagram_normalise(['data' => [post(['media_type' => 'CAROUSEL_ALBUM'])]]);
check('carousel album uses its cover media_url', $album[0]['remote'] ?? null, 'https://scontent.cdninstagram.com/a.jpg');

$fallback = mos_instagram_normalise(['data' => [post(['media_url' => null, 'thumbnail_url' => 'https://x.cdninstagram.com/t.jpg'])]]);
check('missing media_url falls back to thumbnail_url', $fallback[0]['remote'] ?? null, 'https://x.cdninstagram.com/t.jpg');

check('http picture dropped', mos_instagram_normalise(['data' => [post(['media_url' => 'http://x/a.jpg'])]]), []);
check('foreign permalink dropped', mos_instagram_normalise(['data' => [post(['permalink' => 'https://evil.example/p/x/'])]]), []);
check('javascript permalink dropped', mos_instagram_normalise(['data' => [post(['permalink' => 'javascript:alert(1)'])]]), []);
check('look-alike host dropped', mos_instagram_normalise(['data' => [post(['permalink' => 'https://www.instagram.com.evil.example/p/x/'])]]), []);
check('non-numeric id dropped', mos_instagram_normalise(['data' => [post(['id' => '../../etc'])]]), []);
check('missing caption is empty', mos_instagram_normalise(['data' => [post(['caption' => null])]])[0]['caption'] ?? null, '');

$many = [];
for ($i = 0; $i < 20; $i++) { $many[] = post(['id' => (string) (1000 + $i)]); }
$capped = mos_instagram_normalise(['data' => $many]);
check('at most 12 posts', count($capped), 12);
check('API order kept', $capped[0]['id'] . ',' . $capped[11]['id'], '1000,1011');
check('custom cap', count(mos_instagram_normalise(['data' => $many], 3)), 3);
check('duplicate ids kept once', count(mos_instagram_normalise(['data' => [post(), post()]])), 1);

check('picture on another host dropped', mos_instagram_normalise(['data' => [post(['media_url' => 'https://evil.example/a.jpg'])]]), []);
check('picture on a look-alike host dropped', mos_instagram_normalise(['data' => [post(['media_url' => 'https://cdninstagram.com.evil.example/a.jpg'])]]), []);
check('picture on fbcdn kept', mos_instagram_normalise(['data' => [post(['media_url' => 'https://scontent.xx.fbcdn.net/v/a.jpg?x=1'])]])[0]['remote'] ?? null,
    'https://scontent.xx.fbcdn.net/v/a.jpg?x=1');
check('id with a trailing newline dropped', mos_instagram_normalise(['data' => [post(['id' => "1790\n"])]]), []);
check('permalink with a trailing newline dropped', mos_instagram_normalise(['data' => [post(['permalink' => "https://www.instagram.com/p/X/\n"])]]), []);

check('usable answer: a data list', mos_instagram_answer_usable(['data' => []]), true);
check('usable answer: no data key', mos_instagram_answer_usable(['paging' => []]), false);
check('usable answer: data not a list', mos_instagram_answer_usable(['data' => 'x']), false);

check('account: the store', mos_instagram_account_ok('musikogsport'), true);
check('account: case-insensitive', mos_instagram_account_ok('MusikOgSport'), true);
check('account: another account', mos_instagram_account_ok('someoneelse'), false);

check('garbage: not a list', mos_instagram_normalise(['data' => 'x']), []);
check('garbage: no data', mos_instagram_normalise([]), []);
check('garbage: item not an array', mos_instagram_normalise(['data' => ['x', 5, null]]), []);

// --- caption excerpt ---
check('excerpt: short caption untouched', mos_instagram_excerpt('Halló heimur'), 'Halló heimur');
check('excerpt: whitespace collapsed', mos_instagram_excerpt("Ný\n\nsending   komin \t"), 'Ný sending komin');
$long = str_repeat('Æfingaföt og skór ', 20);
$cut = mos_instagram_excerpt($long, 40);
check('excerpt: cut on a word with an ellipsis', $cut, 'Æfingaföt og skór Æfingaföt og skór…');
check('excerpt: within the limit (chars, not bytes)', mb_strlen($cut) <= 41, true);
check('excerpt: one huge word cut hard', mos_instagram_excerpt(str_repeat('á', 50), 10), str_repeat('á', 10) . '…');
$emoji = mos_instagram_excerpt('Æfingaföt😀😀😀 og meira', 11); // no space to cut on: the cut ends on an emoji
check('excerpt: a cut next to an emoji stays valid UTF-8', mb_check_encoding($emoji, 'UTF-8'), true);
check('excerpt: the emoji is kept whole', $emoji, 'Æfingaföt😀😀…');
check('excerpt: trailing en dash and comma trimmed', mos_instagram_excerpt('Tilboð – frábært verð', 8), 'Tilboð…');
check('excerpt: tags and entities stripped', mos_instagram_excerpt('<b>Tilboð</b> &amp; afsláttur'), 'Tilboð & afsláttur');

// --- token renewal ---
$now = 1_800_000_000;
check('token: fresh is not due', mos_instagram_token_due($now - 29 * DAY_IN_SECONDS, $now), false);
check('token: 30 days exactly is not due', mos_instagram_token_due($now - 30 * DAY_IN_SECONDS, $now), false);
check('token: past 30 days is due', mos_instagram_token_due($now - 30 * DAY_IN_SECONDS - 1, $now), true);
check('token: unknown issue date is due', mos_instagram_token_due(0, $now), true);

// --- public payload ---
$feed = ['fetched' => $now, 'posts' => [
    ['id' => '1', 'href' => 'https://www.instagram.com/p/A/', 'caption' => 'Tilboð', 'file' => '1.jpg', 'width' => 640, 'height' => 640],
    ['id' => '2', 'href' => 'https://www.instagram.com/p/B/', 'caption' => '', 'file' => '2.jpg', 'width' => 480, 'height' => 480],
    ['id' => '3', 'href' => 'https://www.instagram.com/p/C/', 'caption' => 'x', 'file' => '', 'width' => 0, 'height' => 0],
]];
$out = mos_instagram_payload($feed, 'https://wp.example.test/wp-content/uploads');
check('payload: handle and profile', [$out['handle'], $out['profile_href']], ['musikogsport', 'https://www.instagram.com/musikogsport/']);
check('payload: post without a mirrored file dropped', count($out['posts']), 2);
check('payload: first post', $out['posts'][0], [
    'id' => '1', 'href' => 'https://www.instagram.com/p/A/', 'caption' => 'Tilboð',
    'image' => ['url' => 'https://wp.example.test/wp-content/uploads/mos-instagram/1.jpg', 'width' => 640, 'height' => 640, 'alt' => 'Tilboð'],
]);
check('payload: alt when there is no caption', $out['posts'][1]['image']['alt'], 'Mynd af Instagram');
check('payload: empty feed', mos_instagram_payload([], 'https://x')['posts'], []);
check('payload: never a token key', strpos(json_encode(mos_instagram_payload($feed + ['token' => 'IGAAsecret'], 'https://x')), 'IGAA'), false);

// --- log redaction (WordPress's HTTP errors quote the request URL, token included) ---
check('redact: token in a quoted URL', mos_instagram_redact(
    'blocked requests through HTTP to the URL: https://graph.instagram.com/v26.0/me/media?fields=id&limit=12&access_token=IGAAsecret123.'),
    'blocked requests through HTTP to the URL: https://graph.instagram.com/v26.0/me/media?fields=id&limit=12&access_token=[redacted].');
check('redact: token first, other params kept', mos_instagram_redact('x?access_token=IGAA-a_b.c|d&grant_type=ig_refresh_token'),
    'x?access_token=[redacted]&grant_type=ig_refresh_token');
check('redact: encoded key', mos_instagram_redact('x?access%5Ftoken=IGAAs'), 'x?access%5Ftoken=[redacted]');
check('redact: nothing to hide', mos_instagram_redact('cURL error 28: Operation timed out'), 'cURL error 28: Operation timed out');

// --- token shape ---
check('token shape: typical', mos_instagram_token_shape_ok('IGAAR' . str_repeat('x', 150)), true);
check('token shape: too short', mos_instagram_token_shape_ok('abc'), false);
check('token shape: spaces/quotes', mos_instagram_token_shape_ok('IGAA' . str_repeat('x', 40) . '" onclick'), false);

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail === 0 ? 0 : 1);
