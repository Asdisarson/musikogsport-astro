<?php
/**
 * Unit test for the pure rules in ../mos-shell-admin.php (no WordPress needed).
 *
 * Run: php wp-mu-plugins/tests/mos_shell_admin_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
function add_action(...$args): void {}
function add_submenu_page(...$args): void {}

require __DIR__ . '/../mos-shell-admin.php';

$pass = 0;
$fail = 0;
function check(string $label, $got, $want): void {
    global $pass, $fail;
    if ($got === $want) { $pass++; return; }
    $fail++;
    printf("FAIL %s\n  want %s\n  got  %s\n", $label, json_encode($want), json_encode($got));
}

// Sizes, durations and times, as the page shows them (Icelandic: comma decimal, klst/mín/sek).
check('bytes: zero', mos_shell_admin_bytes(0), '0 B');
check('bytes: kilobytes with one decimal', mos_shell_admin_bytes(1536), '1,5 KB');
check('bytes: megabytes', mos_shell_admin_bytes(2000000), '1,9 MB');
check('bytes: whole tens drop the decimal', mos_shell_admin_bytes(104857600), '100 MB');
check('bytes: gigabytes', mos_shell_admin_bytes(1073741824), '1,0 GB');
check('duration: seconds', mos_shell_admin_duration(4000), '4 sek');
check('duration: minutes and seconds', mos_shell_admin_duration(252000), '4 mín 12 sek');
check('duration: hours and minutes', mos_shell_admin_duration(3780000), '1 klst 3 mín');
check('duration: whole hours', mos_shell_admin_duration(86400000), '24 klst');
check('duration: zero', mos_shell_admin_duration(0), '0 sek');
check('when: the epoch in Reykjavik (UTC)', mos_shell_admin_when(0), '1.1.1970 00:00');
check('when: a day on', mos_shell_admin_when(86400000 + 5 * 3600000), '2.1.1970 05:00');

// Paths typed into the refresh field: a URL or a path, the same shape the poke route takes.
check('path: a full URL with a query', mos_shell_admin_path('https://musikogsport.is/vara/treyja-1/?x=1'), '/vara/treyja-1/');
check('path: a category path without its slash', mos_shell_admin_path('/verslun/skor/vara-1'), '/verslun/skor/vara-1/');
check('path: no leading slash', mos_shell_admin_path('vara/a'), '/vara/a/');
check('path: an Icelandic slug', mos_shell_admin_path('/verslun/íþróttir/þrúgu-æði/'), '/verslun/íþróttir/þrúgu-æði/');
check('path: percent-encoded slug', mos_shell_admin_path('/verslun/%C3%BE%C3%BA/'), '/verslun/þú/');
check('path: the home page is refused', mos_shell_admin_path('https://musikogsport.is/'), null);
check('path: karfa is refused', mos_shell_admin_path('/karfa/'), null);
check('path: traversal is refused', mos_shell_admin_path('/vara/../karfa/'), null);
check('path: a capital letter is refused, as the poke route refuses it', mos_shell_admin_path('/vara/Treyja/'), null);
check('path: empty is refused', mos_shell_admin_path('   '), null);
check('path: over 200 characters is refused', mos_shell_admin_path('/vara/' . str_repeat('a', 200) . '/'), null);

// The status: a good one, narrowed; a bad one, refused.
$good = [
    'ok' => true,
    'at' => 1000,
    'store' => [
        'on' => true, 'build' => 'abcdef01', 'folder' => 'temp', 'pagesInMemory' => 3, 'pagesOnDisk' => 40,
        'diskBytes' => 2000000, 'diskAt' => 999000,
        'fresh' => ['productMs' => 86400000, 'contentMs' => 86400000, 'listingMs' => 300000, 'filteredMs' => 120000, 'hardMaxMs' => 604800000, 'overrideMs' => null],
    ],
    'scheduler' => ['armed' => true, 'why' => null, 'at' => '05:00', 'hasBase' => true, 'nextRunAt' => 2000000, 'lastStart' => 900000, 'lastEnd' => 905000],
    'run' => ['running' => false, 'startedAt' => null, 'total' => null, 'visited' => 0, 'hits' => 0, 'rendered' => 0, 'gone' => 0, 'failures' => 0, 'pauseMs' => null, 'lastPath' => null, 'stopRequested' => false, 'workers' => 2, 'concurrency' => 2],
    'lastRun' => ['startedAt' => 1, 'endedAt' => 4001, 'durationMs' => 4000, 'visited' => 5, 'hits' => 2, 'rendered' => 2, 'gone' => 1, 'failures' => 1, 'stoppedEarly' => true, 'stoppedWhy' => 'failures'],
    'failures' => [['path' => '/vara/a/', 'status' => 500, 'at' => 7]],
];
$p = mos_shell_admin_parse($good);
check('status: parsed', is_array($p), true);
check('status: store values', [$p['on'], $p['build'], $p['folder'], $p['pagesInMemory'], $p['pagesOnDisk'], $p['diskBytes']], [true, 'abcdef01', 'temp', 3, 40, 2000000]);
check('status: scheduler values', [$p['armed'], $p['why'], $p['at'], $p['nextRunAt']], [true, null, '05:00', 2000000]);
check('status: last run', $p['lastRun']['stoppedWhy'], 'failures');
check('status: failure list', $p['failureList'], [['path' => '/vara/a/', 'status' => 500, 'at' => 7]]);
check('status: the override is kept as null', $p['fresh']['overrideMs'], null);
check('status: a non-status is refused', mos_shell_admin_parse(['ok' => false]), null);
check('status: not an array is refused', mos_shell_admin_parse('<html>'), null);
check('status: a missing section is refused', mos_shell_admin_parse(['ok' => true, 'store' => []]), null);

$odd = $good;
$odd['store']['folder'] = '/etc/passwd';
$odd['scheduler']['why'] = '<script>';
$odd['lastRun']['stoppedWhy'] = 'whatever';
$odd['store']['build'] = str_repeat('x', 40);
$odd['run']['visited'] = '12';
$odd['run']['lastPath'] = ['not', 'a', 'string'];
$q = mos_shell_admin_parse($odd);
check('status: an unknown folder is dropped', $q['folder'], null);
check('status: an unknown why is dropped', $q['why'], null);
check('status: an unknown stop reason is dropped', $q['lastRun']['stoppedWhy'], null);
check('status: a long build is cut', strlen((string) $q['build']), 16);
check('status: a number sent as text is not a number', $q['visited'], 0);
check('status: a path that is not text is dropped', $q['lastPath'], null);

$many = $good;
$many['failures'] = [];
for ($i = 0; $i < 25; $i++) { $many['failures'][] = ['path' => "/vara/p$i/", 'status' => 500, 'at' => $i]; }
$many['failures'][] = ['status' => 500, 'at' => 1];
check('status: the failure list is capped at 20 rows', count(mos_shell_admin_parse($many)['failureList']), MOS_SHELL_ADMIN_FAILURES);
$noPath = $good;
$noPath['failures'] = [['status' => 500, 'at' => 1]];
check('status: a failure without a path is dropped', mos_shell_admin_parse($noPath)['failureList'], []);

// Progress, problems, outcomes, requests and texts.
check('percent: half', mos_shell_admin_percent(5, 10), 50);
check('percent: over the total is 100', mos_shell_admin_percent(12, 10), 100);
check('percent: unknown total is none', mos_shell_admin_percent(3, null), null);
check('percent: zero total is none', mos_shell_admin_percent(0, 0), null);

check('problem: no key', mos_shell_admin_problem(-2), 'nokey');
check('problem: no base', mos_shell_admin_problem(-1), 'nobase');
check('problem: no answer', mos_shell_admin_problem(0), 'unreachable');
check('problem: refused key', mos_shell_admin_problem(403), 'forbidden');
check('problem: other', mos_shell_admin_problem(500), 'failed');

check('outcome: run started', mos_shell_admin_outcome('run', 202), 'run-started');
check('outcome: run refused', mos_shell_admin_outcome('run', 409), 'run-refused');
check('outcome: stop sent', mos_shell_admin_outcome('stop', 202), 'stop-sent');
check('outcome: stop with nothing running', mos_shell_admin_outcome('stop', 409), 'stop-refused');
check('outcome: rebuilt', mos_shell_admin_outcome('refresh', 200), 'refresh-done');
check('outcome: cleared', mos_shell_admin_outcome('clear', 200), 'clear-done');
check('outcome: clear refused while running', mos_shell_admin_outcome('clear', 409), 'clear-refused');
check('outcome: a refused key wins over the action', mos_shell_admin_outcome('clear', 403), 'forbidden');
check('outcome: a server error', mos_shell_admin_outcome('run', 503), 'failed');
check('outcome: an unknown action', mos_shell_admin_outcome('x', 200), 'unknown');

check('request: run', mos_shell_admin_request('run', '', false), ['body' => ['action' => 'run']]);
check('request: stop', mos_shell_admin_request('stop', '', false), ['body' => ['action' => 'stop']]);
check('request: rebuild one page', mos_shell_admin_request('refresh', 'https://musikogsport.is/vara/a', false), ['body' => ['action' => 'refresh', 'path' => '/vara/a/']]);
check('request: rebuild a bad path', mos_shell_admin_request('refresh', '/karfa/', false), ['notice' => 'refresh-bad-path']);
check('request: clear needs the confirm box', mos_shell_admin_request('clear', '', false), ['notice' => 'clear-unconfirmed']);
check('request: clear when confirmed', mos_shell_admin_request('clear', '', true), ['body' => ['action' => 'clear']]);
check('request: anything else', mos_shell_admin_request('delete', '', true), ['notice' => 'unknown']);

foreach (['run-started', 'run-refused', 'stop-sent', 'stop-refused', 'refresh-done', 'refresh-refused', 'refresh-bad-path', 'clear-done', 'clear-refused', 'clear-unconfirmed', 'nokey', 'nobase', 'unreachable', 'forbidden', 'bad', 'failed', 'unknown'] as $key) {
    $t = mos_shell_admin_text($key);
    check("text for $key", is_array($t) && $t[1] !== '' && in_array($t[0], ['success', 'warning', 'error'], true), true);
}
check('text: an unknown key has none', mos_shell_admin_text('whatever'), null);
foreach (['store-off', 'off', 'no-base', 'waiting'] as $why) {
    check("why text for $why", mos_shell_admin_why_text($why) !== null, true);
}
check('why: armed has no reason', mos_shell_admin_why_text(null), null);

// Who may run or clear: a run and a clear are the storefront's heavy actions, so only an administrator; the rest
// (stop, refresh one page) stay with an editor.
check('allowed: an administrator may run', mos_shell_admin_allowed('run', true), true);
check('allowed: an editor may not run', mos_shell_admin_allowed('run', false), false);
check('allowed: an administrator may clear', mos_shell_admin_allowed('clear', true), true);
check('allowed: an editor may not clear', mos_shell_admin_allowed('clear', false), false);
check('allowed: an editor may stop', mos_shell_admin_allowed('stop', false), true);
check('allowed: an editor may refresh one page', mos_shell_admin_allowed('refresh', false), true);
check('allowed: an unknown action is refused', mos_shell_admin_allowed('delete', true), false);

// The walk's workers, as the page shows them.
check('workers: two at once', mos_shell_admin_workers_text(2, 2), '2 síður í einu');
check('workers: one page at once, healthy', mos_shell_admin_workers_text(1, 1), '1 síða í einu');
check('workers: degraded to one of two', mos_shell_admin_workers_text(1, 2), '1 síða í einu (hægt á vegna svartíma)');
check('workers: no run going', mos_shell_admin_workers_text(null, null), '');
check('status: workers kept', [$p['workers'], $p['concurrency']], [2, 2]);

// The storefront's clear removes every page file, so it gets longer than the other calls.
check('timeout: a clear waits longer', mos_shell_admin_timeout('clear') > 5, true);
check('timeout: the other calls keep 5 s', mos_shell_admin_timeout('run'), 5);
check('timeout: a status read keeps 5 s', mos_shell_admin_timeout('get'), 5);

echo "$pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
