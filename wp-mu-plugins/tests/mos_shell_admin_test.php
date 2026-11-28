<?php
/**
 * Unit test for the pure rules in ../mos-shell-admin.php (no WordPress needed).
 *
 * Run: php wp-mu-plugins/tests/mos_shell_admin_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
function add_action(...$args): void {}
function add_filter(...$args): void {}
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
check('outcome: clear refused while running', mos_shell_admin_outcome('clear', 409, ['error' => 'running']), 'clear-running');
check('outcome: clear refused, reason unknown, reads as running', mos_shell_admin_outcome('clear', 409), 'clear-running');
check('outcome: clear refused with the store off', mos_shell_admin_outcome('clear', 409, ['error' => 'store-off']), 'clear-off');
check('outcome: a refused key wins over the action', mos_shell_admin_outcome('clear', 403), 'forbidden');
check('outcome: a server error', mos_shell_admin_outcome('run', 503), 'failed');
check('outcome: an unknown action', mos_shell_admin_outcome('x', 200), 'unknown');

check('request: run', mos_shell_admin_request('run', '', false), ['body' => ['action' => 'run']]);
check('request: run with the choices', mos_shell_admin_request('run', '', false, ['concurrency' => '2', 'pauseMs' => '800', 'photos' => true]), ['body' => ['action' => 'run', 'concurrency' => 2, 'pauseMs' => 800, 'photos' => true]]);
check('request: stop', mos_shell_admin_request('stop', '', false), ['body' => ['action' => 'stop']]);
check('request: rebuild one page', mos_shell_admin_request('refresh', 'https://musikogsport.is/vara/a', false), ['body' => ['action' => 'refresh', 'path' => '/vara/a/']]);
check('request: rebuild a bad path', mos_shell_admin_request('refresh', '/karfa/', false), ['notice' => 'refresh-bad-path']);
check('request: clear needs the confirm box', mos_shell_admin_request('clear', '', false), ['notice' => 'clear-unconfirmed']);
check('request: clear when confirmed', mos_shell_admin_request('clear', '', true), ['body' => ['action' => 'clear']]);
check('request: anything else', mos_shell_admin_request('delete', '', true), ['notice' => 'unknown']);

foreach (['run-started', 'run-refused', 'stop-sent', 'stop-refused', 'refresh-done', 'refresh-refused', 'refresh-bad-path', 'clear-done', 'clear-running', 'clear-off', 'clear-unconfirmed', 'nokey', 'nobase', 'unreachable', 'forbidden', 'bad', 'failed', 'unknown'] as $key) {
    $t = mos_shell_admin_text($key);
    check("text for $key", is_array($t) && $t[1] !== '' && in_array($t[0], ['success', 'warning', 'error'], true), true);
}
check('text: an unknown key has none', mos_shell_admin_text('whatever'), null);
foreach (['run-invalid', 'clearphotos-done', 'clearphotos-partial', 'clearphotos-running', 'clearphotos-clearing', 'clearphotos-unconfirmed', 'clearphotos-failed'] as $key) {
    $t = mos_shell_admin_text($key);
    check("text for $key", is_array($t) && $t[1] !== '' && in_array($t[0], ['success', 'warning', 'error'], true), true);
}
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
check('allowed: an editor may not clear photos', mos_shell_admin_allowed('clearphotos', false), false);
check('allowed: an administrator may clear photos', mos_shell_admin_allowed('clearphotos', true), true);
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
check('timeout: a photo clear waits longer too', mos_shell_admin_timeout('clear-photos'), 30);
check('timeout: a status read keeps 5 s', mos_shell_admin_timeout('get'), 5);

// The nightly settings: one bound per field, refused and never clamped (the same bounds as src/lib/nightlySettings.ts).
check('settings: a valid time', mos_shell_settings_problem('at', '23:59'), null);
check('settings: an hour of 24 is refused', mos_shell_settings_problem('at', '24:00') !== null, true);
check('settings: a time without a leading zero is refused', mos_shell_settings_problem('at', '5:00') !== null, true);
check('settings: concurrency 1 and 4 are fine', [mos_shell_settings_problem('concurrency', 1), mos_shell_settings_problem('concurrency', 4)], [null, null]);
check('settings: concurrency 5 is refused', mos_shell_settings_problem('concurrency', 5) !== null, true);
check('settings: a string concurrency is refused', mos_shell_settings_problem('concurrency', '2') !== null, true);
check('settings: pause 30000 is fine', mos_shell_settings_problem('pauseMs', 30000), null);
check('settings: pause 30001 is refused', mos_shell_settings_problem('pauseMs', 30001) !== null, true);
check('settings: enabled must be a bool', mos_shell_settings_problem('enabled', 1) !== null, true);

// The form: checkboxes not ticked are false; a bad number is a problem, not a clamp.
$form = mos_shell_settings_from_form(['at' => '06:30', 'concurrency' => '3', 'pauseMs' => '250', 'enabled' => '1']);
check('form: values typed', $form['values'], ['enabled' => true, 'at' => '06:30', 'concurrency' => 3, 'pauseMs' => 250, 'catchUp' => false, 'photos' => false]);
check('form: no problems', $form['problems'], []);
$bad = mos_shell_settings_from_form(['at' => '06:30', 'concurrency' => '5', 'pauseMs' => '30001', 'catchUp' => '1']);
check('form: two problems for the two bad numbers', count($bad['problems']), 2);
check('form: a bad value is kept as typed, not clamped (the problem refuses the save)', $bad['values']['concurrency'], 5);
$junk = mos_shell_settings_from_form(['concurrency' => '2.5', 'pauseMs' => '-1', 'at' => 'x']);
check('form: fractions and minus signs are refused', count($junk['problems']) >= 3, true);

// The canonical forms and the comparison the self-heal makes.
$full = ['enabled' => true, 'at' => '05:00', 'concurrency' => 2, 'pauseMs' => 100, 'catchUp' => true];
check('full: a complete option is kept (photos missing = off)', mos_shell_settings_full($full), $full + ['photos' => false]);
check('full: a partial one is not a full option', mos_shell_settings_full(['at' => '05:00']), null);
check('full: a non-array is not', mos_shell_settings_full('x'), null);
check('canon: unknown keys dropped', mos_shell_settings_canon(['at' => '05:00', 'speed' => 9]), ['at' => '05:00', 'photos' => false]);
check('differs: no option, nothing to send', mos_shell_settings_differs(null, null), false);
check('differs: an option and no copy', mos_shell_settings_differs($full, null), true);
check('differs: the same copy', mos_shell_settings_differs($full, $full), false);
check('differs: the same values in another order', mos_shell_settings_differs($full, array_reverse($full, true)), false);
check('differs: one field changed', mos_shell_settings_differs($full, array_merge($full, ['concurrency' => 4])), true);
check('differs: a partial copy differs from a full option', mos_shell_settings_differs($full, ['at' => '05:00']), true);

// The self-heal decision: push when they differ, never twice within a minute.
check('push: a lost copy is sent', mos_shell_settings_should_push($full, null, null, 1000), true);
check('push: nothing to send, nothing sent', mos_shell_settings_should_push(null, null, null, 1000), false);
check('push: the same copy is not sent again', mos_shell_settings_should_push($full, $full, null, 1000), false);
check('push: a failure in the last minute waits', mos_shell_settings_should_push($full, null, 990, 1000), false);
check('push: a failure a minute ago may be tried again', mos_shell_settings_should_push($full, null, 940, 1000), true);
check('push: a reset in progress holds the heal', mos_shell_settings_should_push($full, null, null, 1000, true), false);
check('push: a reset in progress holds it even for a lost copy', mos_shell_settings_should_push($full, $full, null, 1000, true), false);
check('push body: the saved values', mos_shell_settings_body($full), ['action' => 'settings', 'settings' => $full]);
check('push body: null drops the copy', mos_shell_settings_body(null), ['action' => 'settings', 'settings' => null]);

// The notices of a save and a reset.
check('notice: saved and sent', mos_shell_settings_notice('settings', 200), 'settings-saved');
check('notice: saved here, not sent', mos_shell_settings_notice('settings', 0), 'settings-saved-unsent');
check('notice: answered 200 but not kept on disk', mos_shell_settings_notice('settings', 200, false), 'settings-saved-unsent');
check('notice: answered 200 and kept on disk', mos_shell_settings_notice('settings', 200, true), 'settings-saved');
check('notice: a refused write (503) is not saved', mos_shell_settings_notice('settings', 503), 'settings-saved-unsent');
check('notice: reset done', mos_shell_settings_notice('defaults', 200), 'settings-defaults');
check('notice: reset refused keeps the option', mos_shell_settings_notice('defaults', 500), 'settings-defaults-failed');
check('texts: the new notices have one', mos_shell_admin_text('settings-invalid')[0], 'error');
check('texts: the resent notice is info', mos_shell_admin_text('settings-resent')[0], 'info');

// The per-page figures and the stop reason, as text.
check('per page: 800 ms and 75 a minute', mos_shell_admin_per_page(800.0, 75.0), '0,8 sek á síðu, 75 síður á mínútu');
check('per page: no measure', mos_shell_admin_per_page(null, null), null);
check('stop: an ordinary end', mos_shell_admin_stop_text(false, null), '–');
check('stop: the failure run', mos_shell_admin_stop_text(true, 'failures'), 'stöðvaðist eftir röð villna');
check('why: saved off names the settings on the page', str_contains((string) mos_shell_admin_why_text('off', 'saved'), 'hér á síðunni'), true);
check('why: default off names the settings on the page', str_contains((string) mos_shell_admin_why_text('off', 'env/default'), 'hér á síðunni'), true);
check('why: off by default points at the settings', str_contains((string) mos_shell_admin_why_text('off', 'env/default'), 'sjálfgefið'), true);

// Who may change the settings: administrators only.
check('allowed: an administrator may save settings', mos_shell_admin_allowed('settings', true), true);
check('allowed: an editor may not save settings', mos_shell_admin_allowed('settings', false), false);
check('allowed: an editor may not reset settings', mos_shell_admin_allowed('defaults', false), false);

// The status: the settings and the runs are narrowed; a storefront without them gives null.
$withSettings = $good + [
    'settings' => [
        'effective' => ['enabled' => true, 'at' => '06:30', 'concurrency' => 3, 'pauseMs' => 250, 'catchUp' => false],
        'source' => ['enabled' => 'env/default', 'at' => 'saved', 'concurrency' => 'saved', 'pauseMs' => 'saved', 'catchUp' => 'env/default'],
        'saved' => ['at' => '06:30', 'concurrency' => 3, 'pauseMs' => 250, 'junk' => 1],
        'estimateMs' => 9000,
    ],
    'recentRuns' => [
        ['startedAt' => 5, 'endedAt' => 9, 'durationMs' => 4000, 'total' => 10, 'visited' => 5, 'hits' => 1, 'rendered' => 4, 'gone' => 0, 'failures' => 0, 'stoppedEarly' => false, 'stoppedWhy' => null, 'concurrency' => 2, 'msPerPage' => 800.0, 'pagesPerMinute' => 75.0],
        'not a run',
    ],
];
$ps = mos_shell_admin_parse($withSettings);
check('status: effective settings', $ps['settings']['effective'], ['enabled' => true, 'at' => '06:30', 'concurrency' => 3, 'pauseMs' => 250, 'catchUp' => false, 'photos' => false]);
check('status: sources kept', $ps['settings']['source']['at'], 'saved');
check('status: the saved copy keeps only known values', $ps['settings']['saved'], ['at' => '06:30', 'concurrency' => 3, 'pauseMs' => 250, 'photos' => false]);
check('status: the estimate', $ps['settings']['estimateMs'], 9000);
check('status: one run, the bad entry dropped', count($ps['runs']), 1);
check('status: per page kept as a float', $ps['runs'][0]['msPerPage'], 800.0);
check('status: a last run without a measure has no per-page figure', $ps['lastRun']['msPerPage'], null);
check('status: no settings from an older storefront', mos_shell_admin_parse($good)['settings'], null);
$noCopy = $withSettings;
$noCopy['settings']['saved'] = [];
check('status: an empty saved copy is no copy', mos_shell_admin_parse($noCopy)['settings']['saved'], null);

// --- Review fixes: a status with recent runs keeps the run's own fields (the loop once overwrote them), a clear is a clear,
// the interrupted run, the reload guard, the pause in ms, and a clear that left files behind.

$withRun = $withSettings;
$withRun['run']['running'] = true;
$withRun['run']['visited'] = 4;
$pr = mos_shell_admin_parse($withRun);
check('status: a walk going is still a walk when recent runs are sent', $pr['running'], true);
check('status: its visited count survives the recent runs', $pr['visited'], 4);

$withClear = $withSettings;
$withClear['run']['clearing'] = true;
$pc = mos_shell_admin_parse($withClear);
check('status: a clear is parsed as clearing', $pc['clearing'], true);
check('status: a clear is never a walk', $pc['running'], false);
check('status: no clear by default', mos_shell_admin_parse($good)['clearing'], false);
check('status: a clear is kept when recent runs are sent too', mos_shell_admin_parse($withClear)['clearing'], true);

$withUnfinished = $good;
$withUnfinished['scheduler']['unfinishedStart'] = 950000;
check('status: an interrupted run start is kept', mos_shell_admin_parse($withUnfinished)['unfinishedStart'], 950000);
check('status: no interrupted run is null', mos_shell_admin_parse($good)['unfinishedStart'], null);

// The page's buttons and the auto-refresh follow the run and the clear (review 3).
// may_run(store on, base set, walk going, clear going, administrator)
check('run button: an administrator, store on, base set, nothing going', mos_shell_admin_may_run(true, true, false, false, true), true);
check('run button: refused while a clear goes', mos_shell_admin_may_run(true, true, false, true, true), false);
check('run button: refused while a walk goes', mos_shell_admin_may_run(true, true, true, false, true), false);
check('run button: refused for an editor', mos_shell_admin_may_run(true, true, false, false, false), false);
check('run button: refused with the store off', mos_shell_admin_may_run(false, true, false, false, true), false);
check('run button: refused with no base', mos_shell_admin_may_run(true, false, false, false, true), false);
check('clear button: an administrator when nothing clears', mos_shell_admin_may_clear(true, false), true);
check('clear button: disabled while a clear goes', mos_shell_admin_may_clear(true, true), false);
check('clear button: an editor may not clear', mos_shell_admin_may_clear(false, false), false);
check('stop button: only for a walk', mos_shell_admin_may_stop(true, false), true);
check('stop button: never for a clear', mos_shell_admin_may_stop(false, true), false);
check('stop button: not without a run', mos_shell_admin_may_stop(false, false), false);
check('clearing notice: a clear is named as a clear', mos_shell_admin_clearing_notice(true), 'Tæming í gangi. Keyrsla og önnur tæming bíða þar til henni lýkur.');
check('clearing notice: none when no clear goes', mos_shell_admin_clearing_notice(false), null);

check('reload: a walk going refreshes the page', mos_shell_admin_reloads(true, false), true);
check('reload: a clear going refreshes the page too', mos_shell_admin_reloads(false, true), true);
check('reload: nothing going, no refresh', mos_shell_admin_reloads(false, false), false);
$js = mos_shell_admin_reload_script('https://wp.test/wp-admin/admin.php?page=mos-sidugeymsla', 15000);
check('reload script: one script block', substr_count($js, '<script>'), 1);
check('reload script: the address is a JS string', str_contains($js, '"https://wp.test/wp-admin/admin.php?page=mos-sidugeymsla"'), true);
check('reload script: the delay is the constant', str_contains($js, '15000'), true);
check('reload script: waits while a control has focus', str_contains($js, 'document.activeElement'), true);
check('reload script: waits while a control differs from the page as loaded', str_contains($js, 'defaultValue') && str_contains($js, 'defaultChecked') && str_contains($js, 'defaultSelected'), true);
check('reload script: checks again later, not one timer', str_contains($js, 'setTimeout(tick'), true);
check('reload script: replaces the address, no history entry', str_contains($js, 'location.replace'), true);

// The interrupted run is the 'Síðasta keyrsla' row, saying it did not finish; the older finished run is not shown there (review 1).
$finishedRun = mos_shell_admin_parse($good)['lastRun'];
$finishedRows = mos_shell_admin_last_run_rows($finishedRun, null, null);
check('last run: a finished run shows its start and its tally', array_column($finishedRows, 0), ['Síðasta keyrsla', 'Niðurstaða']);
check('last run: the start of a finished run', $finishedRows[0][1], '1.1.1970 00:00, tók 4 sek');
check('last run: an interrupted run replaces the finished one', mos_shell_admin_last_run_rows($finishedRun, 950000, null), [['Síðasta keyrsla', 'Hófst ' . mos_shell_admin_when(950000) . '. Lauk ekki: keyrslan stöðvaðist áður en hún kláraðist.']]);
check('last run: an interrupted run with no finished one before it', mos_shell_admin_last_run_rows(null, 950000, null), [['Síðasta keyrsla', 'Hófst ' . mos_shell_admin_when(950000) . '. Lauk ekki: keyrslan stöðvaðist áður en hún kláraðist.']]);
check('last run: a stamp older than the finished run does not hide it', array_column(mos_shell_admin_last_run_rows($finishedRun, 0, null), 0), ['Síðasta keyrsla', 'Niðurstaða']);
check('last run: an older storefront with only the start stamp', mos_shell_admin_last_run_rows(null, null, 900000), [['Síðasta keyrsla', 'Hófst ' . mos_shell_admin_when(900000) . '. Lokin eru ekki skráð í þessu ferli.']]);
check('last run: nothing on record', mos_shell_admin_last_run_rows(null, null, null), [['Síðasta keyrsla', 'Engin keyrsla skráð.']]);

// The pause as the progress line shows it: milliseconds under a second (review 35).
check('pause: the default 100 ms', mos_shell_admin_pause(100), '100 ms');
check('pause: zero', mos_shell_admin_pause(0), '0 ms');
check('pause: 800 ms', mos_shell_admin_pause(800), '800 ms');
check('pause: 999 ms is still ms', mos_shell_admin_pause(999), '999 ms');
check('pause: a second is seconds', mos_shell_admin_pause(1000), '1 sek');
check('pause: 2.5 s is 2 sek, as the durations floor', mos_shell_admin_pause(2500), '2 sek');

// Refusals and answers name their reason (review 3 and 4).
check('outcome: a run refused while a clear goes', mos_shell_admin_outcome('run', 409, ['error' => 'clearing']), 'run-refused-clearing');
check('outcome: a run refused while a walk goes', mos_shell_admin_outcome('run', 409, ['error' => 'running']), 'run-refused');
check('outcome: a run refused with the store off', mos_shell_admin_outcome('run', 409, ['error' => 'store-off']), 'run-refused-off');
check('outcome: a run refused with no base', mos_shell_admin_outcome('run', 409, ['error' => 'no-base']), 'run-refused-nobase');
check('outcome: a run refused with no reason stays a plain refusal', mos_shell_admin_outcome('run', 409, null), 'run-refused');
check('outcome: a clear refused while another clear goes', mos_shell_admin_outcome('clear', 409, ['error' => 'clearing']), 'clear-clearing');
check('outcome: a clear refused while a walk goes', mos_shell_admin_outcome('clear', 409, ['error' => 'running']), 'clear-running');
check('outcome: a clear that removed every file', mos_shell_admin_outcome('clear', 200, ['ok' => true, 'removed' => 4, 'failed' => 0]), 'clear-done');
check('outcome: a clear that left files behind is a warning', mos_shell_admin_outcome('clear', 200, ['ok' => true, 'removed' => 4, 'failed' => 2]), 'clear-partial');
check('outcome: a clear answer without the failed count is done (older storefront)', mos_shell_admin_outcome('clear', 200, ['ok' => true, 'removed' => 4]), 'clear-done');
foreach (['run-refused-clearing', 'run-refused-off', 'run-refused-nobase', 'clear-clearing', 'clear-partial'] as $key) {
    $t = mos_shell_admin_text($key);
    check("text for $key is a warning with words", is_array($t) && $t[0] === 'warning' && $t[1] !== '', true);
}
check('texts: each run refusal has its own words', count(array_unique([mos_shell_admin_text('run-refused')[1], mos_shell_admin_text('run-refused-clearing')[1], mos_shell_admin_text('run-refused-off')[1], mos_shell_admin_text('run-refused-nobase')[1]])), 4);
check('texts: a clear refusal for another clear differs from the walk one', mos_shell_admin_text('clear-clearing')[1] !== mos_shell_admin_text('clear-running')[1], true);

// --- Photos (review of the wire contract): the run's choices, the photo block, the settings key, the page look.

// The run's choices: values in range are sent; a bad value is refused, never clamped; absent means the saved setting.
check('run: a bad concurrency is refused, not clamped', mos_shell_admin_request('run', '', false, ['concurrency' => '5']), ['notice' => 'run-invalid']);
check('run: concurrency 0 is refused', mos_shell_admin_request('run', '', false, ['concurrency' => '0']), ['notice' => 'run-invalid']);
check('run: a fraction is refused', mos_shell_admin_request('run', '', false, ['concurrency' => '2.5']), ['notice' => 'run-invalid']);
check('run: a pause over the bound is refused', mos_shell_admin_request('run', '', false, ['pauseMs' => '30001']), ['notice' => 'run-invalid']);
check('run: a pause of 0 is fine', mos_shell_admin_request('run', '', false, ['pauseMs' => '0']), ['body' => ['action' => 'run', 'pauseMs' => 0]]);
check('run: a text pause is refused', mos_shell_admin_request('run', '', false, ['pauseMs' => 'abc']), ['notice' => 'run-invalid']);
check('run: photos off is sent as false', mos_shell_admin_request('run', '', false, ['photos' => false]), ['body' => ['action' => 'run', 'photos' => false]]);
check('run: no choice given keeps the saved setting (no key sent)', mos_shell_admin_request('run', '', false, ['photos' => null, 'concurrency' => null]), ['body' => ['action' => 'run']]);
check('run: an integer is accepted as well', mos_shell_admin_request('run', '', false, ['concurrency' => 4]), ['body' => ['action' => 'run', 'concurrency' => 4]]);
check('run: the form values of the saved nightly settings', mos_shell_admin_run_defaults(['enabled' => false, 'at' => '05:00', 'concurrency' => 3, 'pauseMs' => 250, 'catchUp' => true, 'photos' => true], ['enabled' => true, 'at' => '06:00', 'concurrency' => 1, 'pauseMs' => 0, 'catchUp' => false, 'photos' => false]), ['concurrency' => 3, 'pauseMs' => 250, 'photos' => true]);
check('run: without a saved option the storefront values are shown', mos_shell_admin_run_defaults(null, ['enabled' => true, 'at' => '06:00', 'concurrency' => 1, 'pauseMs' => 0, 'catchUp' => false, 'photos' => false]), ['concurrency' => 1, 'pauseMs' => 0, 'photos' => false]);

// Clearing the photos: confirm tick, its own notices.
check('request: clear photos needs the confirm box', mos_shell_admin_request('clearphotos', '', false), ['notice' => 'clearphotos-unconfirmed']);
check('request: clear photos when confirmed', mos_shell_admin_request('clearphotos', '', true), ['body' => ['action' => 'clear-photos']]);
check('outcome: photos cleared', mos_shell_admin_outcome('clearphotos', 200, ['ok' => true, 'removed' => 3, 'failed' => 0]), 'clearphotos-done');
check('outcome: photos cleared with files left behind', mos_shell_admin_outcome('clearphotos', 200, ['ok' => true, 'removed' => 3, 'failed' => 2]), 'clearphotos-partial');
check('outcome: photos refused while a run goes', mos_shell_admin_outcome('clearphotos', 409, ['error' => 'running']), 'clearphotos-running');
check('outcome: photos refused while a clear goes', mos_shell_admin_outcome('clearphotos', 409, ['error' => 'clearing']), 'clearphotos-clearing');
check('outcome: photos clear server error is a photo failure notice', mos_shell_admin_outcome('clearphotos', 503), 'clearphotos-failed');
check('outcome: photos clear answered without a reason is a photo failure notice', mos_shell_admin_outcome('clearphotos', 500, null), 'clearphotos-failed');
check('outcome: photos clear with no answer at all keeps the connection notice', mos_shell_admin_outcome('clearphotos', 0), mos_shell_admin_problem(0));
check('outcome: photos clear with a refused key keeps the key notice', mos_shell_admin_outcome('clearphotos', 403), 'forbidden');
check('notice: a photo clear failure is an error', mos_shell_admin_text('clearphotos-failed')[0], 'error');
check('outcome: a refused run while photos clear goes', mos_shell_admin_outcome('run', 409, ['error' => 'clearing']), 'run-refused-clearing');
check('request: an unknown action still refused', mos_shell_admin_request('delete', '', true), ['notice' => 'unknown']);

// The photo block of the status: absent from an older storefront (null), narrowed when present.
check('photos block: absent from an older storefront', mos_shell_admin_photos_block($good), null);
$withPhotos = $good + ['photos' => ['files' => 12, 'bytes' => 3145728, 'at' => 5000, 'folder' => 'durable']];
check('photos block: durable folder', mos_shell_admin_photos_block($withPhotos), ['files' => 12, 'bytes' => 3145728, 'at' => 5000, 'folder' => 'durable']);
check('photos block: an unknown folder is dropped', mos_shell_admin_photos_block(['photos' => ['files' => 1, 'bytes' => 2, 'at' => null, 'folder' => '/tmp']]), ['files' => 1, 'bytes' => 2, 'at' => null, 'folder' => null]);
check('photos block: not an object is absent', mos_shell_admin_photos_block(['photos' => 'x']), null);
$pp = mos_shell_admin_parse($withPhotos);
check('status: the photo block is kept', $pp['photos']['files'], 12);
check('status: an older storefront has no photo block', $p['photos'], null);
$withRunPhotos = $withPhotos;
$withRunPhotos['run'] += ['photos' => true, 'photosConverted' => 4, 'photosKept' => 7, 'photosFailed' => 1];
$prp = mos_shell_admin_parse($withRunPhotos);
check('status: a run that prepares photos', [$prp['runPhotos'], $prp['runPhotosConverted'], $prp['runPhotosKept'], $prp['runPhotosFailed']], [true, 4, 7, 1]);
check('status: a run without photos', [$pp['runPhotos'], $pp['runPhotosConverted']], [false, null]);

// A run record: the photo fields are optional (null for records from before this change).
$recPhotos = ['startedAt' => 1, 'endedAt' => 2, 'durationMs' => 1000, 'visited' => 2, 'photos' => true, 'photosConverted' => 2, 'photosKept' => 0, 'photosFailed' => 0];
$rr = mos_shell_admin_run($recPhotos);
check('run record: photos kept', [$rr['photos'], $rr['photosConverted'], $rr['photosKept'], $rr['photosFailed']], [true, 2, 0, 0]);
$rr0 = mos_shell_admin_run(['startedAt' => 1, 'endedAt' => 2, 'durationMs' => 1000]);
check('run record from before the change: photos are null', [$rr0['photos'], $rr0['photosConverted'], $rr0['photosKept'], $rr0['photosFailed']], [null, null, null, null]);
check('run record: a non-bool photos flag is null', mos_shell_admin_run(['startedAt' => 1, 'photos' => 'yes'])['photos'], null);

// The photo text of a run and the last-run rows.
check('photo text: a run that prepares photos', mos_shell_admin_photos_text($rr['photos'], 2, 0, 0), 'breytt: 2, þegar í geymslu: 0, mistókst: 0');
check('photo text: a run without photos has none', mos_shell_admin_photos_text(false, null, null, null), null);
check('photo text: an old record has none', mos_shell_admin_photos_text(null, null, null, null), null);
$lastPhotos = $finishedRun;
$lastPhotos['photos'] = true;
$lastPhotos['photosConverted'] = 4;
$lastPhotos['photosKept'] = 2;
$lastPhotos['photosFailed'] = 1;
$photoRows = mos_shell_admin_last_run_rows($lastPhotos, null, null);
check('last run: photo counts shown when the record has them', end($photoRows), ['Myndir', 'breytt: 4, þegar í geymslu: 2, mistókst: 1']);
check('last run: no photo row for an old record', count(mos_shell_admin_last_run_rows($finishedRun, null, null)), 2);

// The photo card: folder wording, the old-storefront line, the warning, the photos in the settings.
check('photo folder: durable is named after the variable', mos_shell_admin_photo_folder_text('durable'), 'Varanleg mappa (MOS_IMG_CACHE_DIR)');
check('photo folder: temp empties on a restart', mos_shell_admin_photo_folder_text('temp'), 'Tímabundin mappa: tæmist við endurræsingu');
check('photo folder: unknown is a dash', mos_shell_admin_photo_folder_text(null), '–');
check('photo old storefront line', mos_shell_admin_photos_old_text(), 'Vefurinn kann ekki myndir enn: uppfærðu hann.');
check('photo clear warning says visitors get the originals meanwhile', str_contains(mos_shell_admin_photos_warn(), 'upprunalegu'), true);
check('settings: photos must be a bool', mos_shell_settings_problem('photos', 1) !== null, true);
check('settings: photos true is fine', mos_shell_settings_problem('photos', true), null);
check('form: photos ticked', mos_shell_settings_from_form(['at' => '06:30', 'concurrency' => '2', 'pauseMs' => '100', 'photos' => '1'])['values']['photos'], true);
check('form: photos not ticked is false', mos_shell_settings_from_form(['at' => '06:30', 'concurrency' => '2', 'pauseMs' => '100'])['values']['photos'], false);

// Photos are optional in the saved copy: an option from before the change counts as saved, with photos off.
check('full: an option from before the change is full', mos_shell_settings_full(['enabled' => true, 'at' => '05:00', 'concurrency' => 2, 'pauseMs' => 100, 'catchUp' => true]) !== null, true);
check('full: photos on is kept', mos_shell_settings_full($full + ['photos' => true])['photos'], true);
check('full: a bad photos value is off', mos_shell_settings_full($full + ['photos' => 'yes'])['photos'], false);
check('differs: an option with photos off equals a copy without the key', mos_shell_settings_differs($full, $full + ['photos' => false]), false);
check('differs: photos on against a copy with photos off differs', mos_shell_settings_differs($full + ['photos' => true], $full + ['photos' => false]), true);
check('for storefront: photos kept for a new storefront', mos_shell_settings_for_storefront($full + ['photos' => true], true), $full + ['photos' => true]);
check('for storefront: no option, nothing sent', mos_shell_settings_for_storefront(null, false), null);
check('push body: a storefront without photos gets no photos key', mos_shell_settings_for_storefront($full + ['photos' => true], false), $full);

// The status dot: green when on, yellow while something goes, grey when off.
check('dot: a walk going is busy', mos_shell_admin_dot_class(true, true), 'busy');
check('dot: on and idle is ok', mos_shell_admin_dot_class(true, false), 'ok');
check('dot: off is off', mos_shell_admin_dot_class(false, false), 'off');
check('dot: off while busy is still busy', mos_shell_admin_dot_class(false, true), 'busy');

// The page's look: rules on .mos-sg, the intro, the one-column layout under 1100 px, no web fonts.
$css = mos_shell_admin_css();
check('css: variables are defined on .mos-sg', str_contains($css, '.mos-sg {') && str_contains($css, '--mos-sg-line'), true);
check('css: the wide grid is two columns from 1100 px', str_contains($css, '@media (min-width: 1100px)') && str_contains($css, 'repeat(2, minmax(0, 1fr))'), true);
check('css: the status dots exist', str_contains($css, '.mos-sg__dot--ok') && str_contains($css, '.mos-sg__dot--busy') && str_contains($css, '.mos-sg__dot--off'), true);
check('css: no web fonts or imports', str_contains($css, '@import') || str_contains($css, '@font-face') || str_contains($css, 'fonts.g'), false);
check('css: the intro box', str_contains($css, '.mos-sg__intro'), true);
check('css: tables scroll inside their card, not the page', str_contains($css, '.mos-sg__scroll'), true);
check('intro text: two plain sentences', substr_count(mos_shell_admin_intro_text(), '.') >= 2, true);

// --- The photo card's rows (review: the run's counts while a run prepares photos) and its status dot.
$photoStore = ['files' => 3, 'bytes' => 1536, 'at' => 5000, 'folder' => 'durable'];
$photoRowsStore = [['Geymdar myndir', '3'], ['Stærð á diski', '1,5 KB'], ['Mappa', 'Varanleg mappa (MOS_IMG_CACHE_DIR)']];
check('photo rows: running with photos shows the run counts', mos_shell_admin_photo_rows($photoStore, true, true, 4, 2, 1), array_merge($photoRowsStore, [['Keyrsla núna', 'breytt: 4, þegar í geymslu: 2, mistókst: 1']]));
check('photo rows: a running photo walk with no counts yet shows zeros', mos_shell_admin_photo_rows($photoStore, true, true, null, null, null), array_merge($photoRowsStore, [['Keyrsla núna', 'breytt: 0, þegar í geymslu: 0, mistókst: 0']]));
check('photo rows: running without photos says so', mos_shell_admin_photo_rows($photoStore, true, false, null, null, null), array_merge($photoRowsStore, [['Keyrsla núna', 'Þessi keyrsla undirbýr ekki myndir.']]));
check('photo rows: idle shows only the store', mos_shell_admin_photo_rows($photoStore, false, true, 4, 2, 1), $photoRowsStore);
check('photo rows: an older storefront has no rows', mos_shell_admin_photo_rows(null, true, true, 4, 2, 1), []);
check('photo rows: unknown store values read as a dash', mos_shell_admin_photo_rows(['files' => null, 'bytes' => null, 'at' => null, 'folder' => null], false, false, null, null, null), [['Geymdar myndir', '–'], ['Stærð á diski', '–'], ['Mappa', '–']]);
check('photos dot: a run that prepares photos is busy', mos_shell_admin_photos_busy(true, true, false), true);
check('photos dot: a run without photos is not busy', mos_shell_admin_photos_busy(true, false, false), false);
check('photos dot: a clear going is busy', mos_shell_admin_photos_busy(false, false, true), true);
check('photos dot: stored photos are ok', mos_shell_admin_photos_ok($photoStore), true);
check('photos dot: no stored photos is off', mos_shell_admin_photos_ok(['files' => 0, 'bytes' => 0, 'at' => null, 'folder' => null]), false);

// The page's look, part 2: help lines keep a measure; a path field has room above its button.
$css2 = mos_shell_admin_css();
check('css: help lines in fields and groups have a measure', str_contains($css2, 'max-width: 72ch'), true);
check('css: the path field has room above its button', str_contains($css2, '.mos-sg__group input.regular-text'), true);

// --- Whether the storefront has photos: three states. A status with a photo block: yes. A status without one: an older
// storefront, no. No status at all (the call failed, or the answer was not a status): unknown, and nothing is sent or changed.
check('has photos: a status with a photo block is yes', mos_shell_admin_has_photos($withPhotos), true);
check('has photos: a status without one is an older storefront (no)', mos_shell_admin_has_photos($good), false);
check('has photos: no status at all is unknown', mos_shell_admin_has_photos(null), null);
check('has photos: an answer that is not a status is unknown', mos_shell_admin_has_photos(['ok' => false, 'photos' => ['files' => 1]]), null);

// --- The settings save, by the storefront's photo state. Unknown refuses the save (null); an older storefront keeps the
// saved photos value, whatever the form said (the tick is not shown to it); a storefront with photos takes the tick.
$saveForm = ['enabled' => true, 'at' => '06:30', 'concurrency' => 3, 'pauseMs' => 250, 'catchUp' => false, 'photos' => false];
$saveBefore = ['enabled' => false, 'at' => '05:00', 'concurrency' => 2, 'pauseMs' => 100, 'catchUp' => true, 'photos' => true];
check('save plan: a storefront with photos takes the form as posted', mos_shell_admin_settings_for_save($saveForm, $saveBefore, true), $saveForm);
check('save plan: an older storefront keeps the saved photos value', mos_shell_admin_settings_for_save($saveForm, $saveBefore, false), array_merge($saveForm, ['photos' => true]));
check('save plan: an older storefront with nothing saved keeps photos off', mos_shell_admin_settings_for_save($saveForm, null, false), $saveForm);
check('save plan: unknown refuses the save', mos_shell_admin_settings_for_save($saveForm, $saveBefore, null), null);
check('save plan: unknown refuses it even with nothing saved', mos_shell_admin_settings_for_save($saveForm, null, null), null);

// --- The run's choices, by the storefront's photo state. Unknown refuses the run (null); an older storefront gets no
// choices at all (it would ignore them), so the body is the plain run; a storefront with photos gets them all.
$runPosted = ['run_concurrency' => '2', 'run_pauseMs' => '800', 'run_photos' => '1'];
check('run choices: a storefront with photos gets them all', mos_shell_admin_run_choices(true, $runPosted), ['concurrency' => '2', 'pauseMs' => '800', 'photos' => true]);
check('run choices: an unticked photos box is false', mos_shell_admin_run_choices(true, ['run_concurrency' => '2', 'run_pauseMs' => '800']), ['concurrency' => '2', 'pauseMs' => '800', 'photos' => false]);
check('run choices: an older storefront gets none', mos_shell_admin_run_choices(false, $runPosted), []);
check('run choices: unknown refuses the run', mos_shell_admin_run_choices(null, $runPosted), null);
check('run request: an older storefront gets the plain run body', mos_shell_admin_request('run', '', false, mos_shell_admin_run_choices(false, $runPosted)), ['body' => ['action' => 'run']]);
check('run request: a storefront with photos gets the choices', mos_shell_admin_request('run', '', false, mos_shell_admin_run_choices(true, $runPosted)), ['body' => ['action' => 'run', 'concurrency' => 2, 'pauseMs' => 800, 'photos' => true]]);

// --- The run form's own fields: shown only to a storefront with photos; an older one gets the one line.
check('run form: the choices are shown to a storefront with photos', mos_shell_admin_run_shows_choices(true), true);
check('run form: the choices are hidden from an older storefront', mos_shell_admin_run_shows_choices(false), false);
check('run form: the one line for an older storefront', mos_shell_admin_run_old_text(), 'Vefurinn kann ekki val fyrir staka keyrslu enn: uppfærðu hann. Keyrslan notar vistuðu stillingarnar.');
check('texts: unknown storefront is an error notice', mos_shell_admin_text('storefront-unknown')[0], 'error');
check('texts: unknown storefront says nothing was sent', mos_shell_admin_text('storefront-unknown')[1], 'Vefurinn svaraði ekki, svo ekkert var sent. Prófaðu aftur.');

echo "$pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
