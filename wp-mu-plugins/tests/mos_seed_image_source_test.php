<?php
/**
 * Unit test for mos_seed_image_download_allowed() in ../seed/seed-image-source.php (pure, no WordPress needed):
 * the seed script downloads a spec image only over https from the live store's own hosts.
 *
 * Run: php wp-mu-plugins/tests/mos_seed_image_source_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

require __DIR__ . '/../seed/seed-image-source.php';

$pass = 0;
$fail = 0;
function check(string $label, $got, $want): void {
    global $pass, $fail;
    if ($got === $want) { $pass++; return; }
    $fail++;
    printf("FAIL %s\n  want %s\n  got  %s\n", $label, json_encode($want), json_encode($got));
}

$ok = static fn (string $url): bool => mos_seed_image_download_allowed($url);

check('live upload', $ok('https://musikogsport.is/wp-content/uploads/2026/04/banner.webp'), true);
check('www host', $ok('https://www.musikogsport.is/wp-content/uploads/logo.png'), true);
check('host case', $ok('https://MusikOgSport.is/wp-content/uploads/logo.png'), true);
check('http refused', $ok('http://musikogsport.is/wp-content/uploads/logo.png'), false);
check('other host refused', $ok('https://example.com/logo.png'), false);
check('look-alike suffix refused', $ok('https://musikogsport.is.evil.example/logo.png'), false);
check('look-alike prefix refused', $ok('https://evilmusikogsport.is/logo.png'), false);
check('userinfo trick refused', $ok('https://musikogsport.is@evil.example/logo.png'), false);
check('credentials refused', $ok('https://user:pw@musikogsport.is/logo.png'), false);
check('port refused', $ok('https://musikogsport.is:8443/logo.png'), false);
check('not an image refused', $ok('https://musikogsport.is/wp-config.php'), false);
check('query-hidden extension refused', $ok('https://musikogsport.is/x.php?f=a.png'), false);
check('local address refused', $ok('https://127.0.0.1/logo.png'), false);
check('empty refused', $ok(''), false);
check('junk refused', $ok('not a url'), false);
check('another allow-list', mos_seed_image_download_allowed('https://wp.example.is/a.jpg', ['wp.example.is']), true);

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail === 0 ? 0 : 1);
