<?php
/**
 * Plugin Name: MOS Shell Admin
 * Description: The "Síðugeymsla" subpage under Stillingar: the storefront's rendered-page store and its nightly rebuild.
 *  Shows an overview (store on or off, pages kept, disk use, build, freshness), the nightly card (next run, last run with
 *  its tally and duration, progress while it runs, recent failures) and the actions: run now, stop, rebuild one page,
 *  clear the store. Reads and drives the storefront's GET/POST /api/shell-admin (app-astro src/pages/api/shell-admin.ts)
 *  with the shared key MOS_SHELL_POKE_KEY (X-Mos-Shell-Key). Without the key, or when the storefront does not answer or
 *  refuses it, the page explains what to set instead of the cards.
 *
 *  The nightly rebuild's settings (on or off, time, pages at a time, pause, catch-up) are saved here, in the option
 *  mos_shell_settings (never autoloaded), and sent to the storefront; the page re-sends them when the storefront has lost
 *  its copy (see mos_shell_admin_heal).
 *
 * Author: Músík og Sport
 * Version: 1.1.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_SHELL_ADMIN_SLUG = 'mos-sidugeymsla';
/** The storefront's limit for one path (src/lib/shellPoke.ts MAX_PATH), in characters. */
const MOS_SHELL_ADMIN_PATH_MAX = 200;
const MOS_SHELL_ADMIN_FAILURES = 20;
const MOS_SHELL_ADMIN_WHY = ['store-off', 'off', 'no-base', 'waiting'];
const MOS_SHELL_ADMIN_STOPPED = ['failures', 'stopped', 'error'];
const MOS_SHELL_ADMIN_FOLDERS = ['durable', 'temp'];
/** The status is read at most this often (seconds), whatever the number of open tabs: the storefront's limiter counts it. */
const MOS_SHELL_ADMIN_TTL = 10;
/** The page reloads itself this often (ms) while a run is going. */
const MOS_SHELL_ADMIN_RELOAD_MS = 15000;
const MOS_SHELL_ADMIN_CACHE = 'mos_shell_admin_status';
/** The saved nightly settings: one option, never autoloaded (the page's source of truth; the storefront holds a copy). */
const MOS_SHELL_ADMIN_SETTINGS = 'mos_shell_settings';
/** Set when a push of the settings failed: the next push waits this long (seconds), so a broken storefront is not hammered. */
const MOS_SHELL_ADMIN_PUSH_FAILED = 'mos_shell_settings_push_failed';
const MOS_SHELL_ADMIN_PUSH_WAIT = 60;
/** Set while a reset is on its way to the storefront: the self-heal holds off, so it does not send back the copy the reset
 *  is removing (seconds; the reset clears it when done). */
const MOS_SHELL_ADMIN_RESETTING = 'mos_shell_settings_resetting';
const MOS_SHELL_ADMIN_RESET_HOLD = 60;
const MOS_SHELL_ADMIN_SETTING_KEYS = ['enabled', 'at', 'concurrency', 'pauseMs', 'catchUp'];
/** The finished runs the storefront keeps and the page lists (the same bound as src/lib/nightlySettings.ts RUNS_KEPT). */
const MOS_SHELL_ADMIN_RUNS = 7;
/** The bounds of the settings (the same as src/lib/nightlySettings.ts). */
const MOS_SHELL_ADMIN_PAUSE_MAX = 30000;
const MOS_SHELL_ADMIN_CONCURRENCY_MAX = 4;

/** Bytes as Icelandic text (1536 is "1,5 KB"). Pure. */
function mos_shell_admin_bytes(int $bytes): string {
    if ($bytes < 1024) { return max(0, $bytes) . ' B'; }
    $units = ['KB', 'MB', 'GB', 'TB'];
    $value = $bytes / 1024;
    $i = 0;
    while ($value >= 1024 && $i < count($units) - 1) { $value /= 1024; $i++; }
    return number_format($value, $value < 10 ? 1 : 0, ',', '.') . ' ' . $units[$i];
}

/** A span in ms as Icelandic text: "4 sek", "4 mín 12 sek", "1 klst 3 mín", "24 klst". Pure. */
function mos_shell_admin_duration(int $ms): string {
    $s = intdiv(max(0, $ms), 1000);
    $h = intdiv($s, 3600);
    $m = intdiv($s % 3600, 60);
    $sec = $s % 60;
    if ($h > 0) { return $m > 0 ? "$h klst $m mín" : "$h klst"; }
    if ($m > 0) { return "$m mín $sec sek"; }
    return "$sec sek";
}

/** A time in ms as "d.m.Y H:i". Iceland is UTC all year, so no offset is needed. Pure. */
function mos_shell_admin_when(int $ms): string {
    return gmdate('j.n.Y H:i', intdiv($ms, 1000));
}

/** The storefront path for what an editor typed: a URL or a path, with or without the trailing slash. Null when it is
 *  not a product or category path of the storefront (the same shape the poke route takes). Pure. */
function mos_shell_admin_path(string $input): ?string {
    $p = trim($input);
    $p = (string) preg_replace('#^[a-z][a-z0-9+.-]*://[^/]*#i', '', $p);
    $p = (string) preg_replace('/[?#].*$/s', '', $p);
    $p = rawurldecode($p);
    if ($p === '') { return null; }
    if ($p[0] !== '/') { $p = '/' . $p; }
    if (substr($p, -1) !== '/') { $p .= '/'; }
    if (strpos($p, '..') !== false || strpos($p, '//') !== false) { return null; }
    if ((function_exists('mb_strlen') ? mb_strlen($p, 'UTF-8') : strlen($p)) > MOS_SHELL_ADMIN_PATH_MAX) { return null; }
    if (!preg_match('#^/(vara|verslun)(/[\p{Ll}\p{N}_-]+)+/$#u', $p)) { return null; }
    return $p;
}

function mos_shell_admin_int($v): ?int {
    return is_int($v) ? $v : null;
}

function mos_shell_admin_str($v, int $max = 200): ?string {
    if (!is_string($v)) { return null; }
    return function_exists('mb_substr') ? mb_substr($v, 0, $max, 'UTF-8') : substr($v, 0, $max);
}

/** The problem with one setting's value, as Icelandic text, or null when it is fine (the same bounds and words as
 *  src/lib/nightlySettings.ts). Pure. */
function mos_shell_settings_problem(string $key, $v): ?string {
    switch ($key) {
        case 'enabled':
        case 'catchUp':
            return is_bool($v) ? null : ($key === 'enabled' ? 'Kveikt' : 'Bæta upp keyrslu') . ' þarf að vera true eða false.';
        case 'at':
            return is_string($v) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v) === 1 ? null : 'Tíminn þarf að vera á forminu HH:MM (00:00 til 23:59).';
        case 'concurrency':
            return is_int($v) && $v >= 1 && $v <= MOS_SHELL_ADMIN_CONCURRENCY_MAX ? null : 'Fjöldi síðna í einu þarf að vera heiltala frá 1 til ' . MOS_SHELL_ADMIN_CONCURRENCY_MAX . '.';
        case 'pauseMs':
            return is_int($v) && $v >= 0 && $v <= MOS_SHELL_ADMIN_PAUSE_MAX ? null : 'Hlé milli síðna þarf að vera heiltala frá 0 til ' . MOS_SHELL_ADMIN_PAUSE_MAX . ' millisekúndur.';
    }
    return 'Óþekktur reitur.';
}

/** The values a settings form posted, typed and checked: ['values' => all five, 'problems' => [...]]. A checkbox that is
 *  not ticked is false. Pure. */
function mos_shell_settings_from_form(array $post): array {
    $cRaw = is_string($post['concurrency'] ?? null) ? $post['concurrency'] : '';
    $pRaw = is_string($post['pauseMs'] ?? null) ? trim($post['pauseMs']) : '';
    $values = [
        'enabled' => (string) ($post['enabled'] ?? '') === '1',
        'at' => is_string($post['at'] ?? null) ? trim($post['at']) : '',
        'concurrency' => preg_match('/^\d+$/', $cRaw) === 1 ? (int) $cRaw : null,
        'pauseMs' => preg_match('/^\d{1,6}$/', $pRaw) === 1 ? (int) $pRaw : null,
        'catchUp' => (string) ($post['catchUp'] ?? '') === '1',
    ];
    $problems = [];
    foreach (MOS_SHELL_ADMIN_SETTING_KEYS as $key) {
        $p = mos_shell_settings_problem($key, $values[$key]);
        if ($p !== null) { $problems[] = $p; }
    }
    return ['values' => $values, 'problems' => $problems];
}

/** The known settings only, valid ones only, in key order: what is compared and kept. Pure. */
function mos_shell_settings_canon(array $s): array {
    $out = [];
    foreach (MOS_SHELL_ADMIN_SETTING_KEYS as $key) {
        if (array_key_exists($key, $s) && mos_shell_settings_problem($key, $s[$key]) === null) { $out[$key] = $s[$key]; }
    }
    return $out;
}

/** The option's value when it holds all five settings, valid, or null. Pure. */
function mos_shell_settings_full($v): ?array {
    if (!is_array($v)) { return null; }
    $c = mos_shell_settings_canon($v);
    return count($c) === count(MOS_SHELL_ADMIN_SETTING_KEYS) ? $c : null;
}

/** Whether the storefront's copy differs from the saved option. No option means nothing to send: false. A missing copy
 *  differs. Pure. */
function mos_shell_settings_differs(?array $option, ?array $remote): bool {
    if ($option === null) { return false; }
    if ($remote === null) { return true; }
    return mos_shell_settings_canon($option) !== mos_shell_settings_canon($remote);
}

/** The self-heal decision: push the option when it differs from the storefront's copy, no push failed within the last
 *  MOS_SHELL_ADMIN_PUSH_WAIT seconds, and no reset is in progress (`held`). Pure. */
function mos_shell_settings_should_push(?array $option, ?array $remote, ?int $failedAt, int $now, bool $held = false): bool {
    if ($held) { return false; }
    if (!mos_shell_settings_differs($option, $remote)) { return false; }
    return $failedAt === null || $now - $failedAt >= MOS_SHELL_ADMIN_PUSH_WAIT;
}

/** The request that sends the saved settings, or clears the storefront's copy (null). Pure. */
function mos_shell_settings_body(?array $values): array {
    return ['action' => 'settings', 'settings' => $values];
}

/** The notice key for a settings save or a reset, from the storefront's code and whether it kept the copy on disk (null when
 *  it did not say). A save is always kept here, even when the storefront did not take it: the self-heal sends it again.
 *  Pure. */
function mos_shell_settings_notice(string $do, int $code, ?bool $persisted = true): string {
    if ($do === 'settings') { return $code === 200 && $persisted !== false ? 'settings-saved' : 'settings-saved-unsent'; }
    return $code === 200 ? 'settings-defaults' : 'settings-defaults-failed';
}

/** How a finished run ended, as Icelandic text; '' when it ended on its own. Pure. */
function mos_shell_admin_stop_text(bool $early, ?string $why): string {
    if (!$early) { return '–'; }
    return [
        'failures' => 'stöðvaðist eftir röð villna',
        'stopped' => 'stöðvuð handvirkt',
        'error' => 'stöðvaðist vegna villu',
    ][$why ?? ''] ?? 'stöðvaðist snemma';
}

/** The measured time per page and the pages per minute of a run, as Icelandic text, or null when there is no measure. Pure. */
function mos_shell_admin_per_page(?float $msPerPage, ?float $pagesPerMinute): ?string {
    if ($msPerPage === null) { return null; }
    $sec = number_format($msPerPage / 1000, 1, ',', '.') . ' sek á síðu';
    if ($pagesPerMinute === null) { return $sec; }
    return $sec . ', ' . number_format($pagesPerMinute, 0, ',', '.') . ' síður á mínútu';
}

/** One run as the status gives it, narrowed. Null when it is not a run. Pure. */
function mos_shell_admin_run($l): ?array {
    if (!is_array($l)) { return null; }
    $stoppedWhy = $l['stoppedWhy'] ?? null;
    $num = static fn($v): ?float => is_int($v) || is_float($v) ? (float) $v : null;
    return [
        'startedAt' => mos_shell_admin_int($l['startedAt'] ?? null) ?? 0,
        'endedAt' => mos_shell_admin_int($l['endedAt'] ?? null),
        'durationMs' => mos_shell_admin_int($l['durationMs'] ?? null) ?? 0,
        'total' => mos_shell_admin_int($l['total'] ?? null),
        'visited' => mos_shell_admin_int($l['visited'] ?? null) ?? 0,
        'hits' => mos_shell_admin_int($l['hits'] ?? null) ?? 0,
        'rendered' => mos_shell_admin_int($l['rendered'] ?? null) ?? 0,
        'gone' => mos_shell_admin_int($l['gone'] ?? null) ?? 0,
        'failures' => mos_shell_admin_int($l['failures'] ?? null) ?? 0,
        'stoppedEarly' => ($l['stoppedEarly'] ?? false) === true,
        'stoppedWhy' => in_array($stoppedWhy, MOS_SHELL_ADMIN_STOPPED, true) ? $stoppedWhy : null,
        'concurrency' => mos_shell_admin_int($l['concurrency'] ?? null),
        'msPerPage' => $num($l['msPerPage'] ?? null),
        'pagesPerMinute' => $num($l['pagesPerMinute'] ?? null),
    ];
}

/** The storefront's status JSON, checked and narrowed to the values the page uses. Anything that is not of the expected
 *  shape is dropped (null or the default), so nothing the storefront sends reaches the page unchecked. Null when the
 *  answer is not a status at all. Pure. */
function mos_shell_admin_parse($json): ?array {
    if (!is_array($json) || ($json['ok'] ?? null) !== true) { return null; }
    $store = is_array($json['store'] ?? null) ? $json['store'] : null;
    $sch = is_array($json['scheduler'] ?? null) ? $json['scheduler'] : null;
    $run = is_array($json['run'] ?? null) ? $json['run'] : null;
    $fresh = is_array($store['fresh'] ?? null) ? $store['fresh'] : [];
    if ($store === null || $sch === null || $run === null) { return null; }

    $why = $sch['why'] ?? null;
    $folder = $store['folder'] ?? null;
    $last = mos_shell_admin_run($json['lastRun'] ?? null);
    $runs = [];
    foreach (is_array($json['recentRuns'] ?? null) ? array_slice($json['recentRuns'], 0, MOS_SHELL_ADMIN_RUNS) : [] as $r) {
        $run = mos_shell_admin_run($r);
        if ($run !== null) { $runs[] = $run; }
    }

    // The storefront's settings: the effective values, where each comes from, its saved copy, the estimate. Null for a
    // storefront that does not report them (an older one).
    $settings = null;
    if (is_array($json['settings'] ?? null)) {
        $set = $json['settings'];
        $eff = is_array($set['effective'] ?? null) ? $set['effective'] : [];
        $src = is_array($set['source'] ?? null) ? $set['source'] : [];
        $source = [];
        foreach (MOS_SHELL_ADMIN_SETTING_KEYS as $key) { $source[$key] = ($src[$key] ?? null) === 'saved' ? 'saved' : 'env/default'; }
        $saved = is_array($set['saved'] ?? null) ? mos_shell_settings_canon($set['saved']) : [];
        $settings = [
            'effective' => [
                'enabled' => ($eff['enabled'] ?? false) === true,
                'at' => mos_shell_admin_str($eff['at'] ?? null, 5) ?? '05:00',
                'concurrency' => mos_shell_admin_int($eff['concurrency'] ?? null) ?? 2,
                'pauseMs' => mos_shell_admin_int($eff['pauseMs'] ?? null) ?? 100,
                'catchUp' => ($eff['catchUp'] ?? true) === true,
            ],
            'source' => $source,
            'saved' => $saved === [] ? null : $saved,
            'estimateMs' => mos_shell_admin_int($set['estimateMs'] ?? null),
        ];
    }

    $failures = [];
    $rows = is_array($json['failures'] ?? null) ? array_slice($json['failures'], 0, MOS_SHELL_ADMIN_FAILURES) : [];
    foreach ($rows as $f) {
        $path = is_array($f) ? mos_shell_admin_str($f['path'] ?? null) : null;
        if ($path === null) { continue; }
        $failures[] = ['path' => $path, 'status' => mos_shell_admin_int($f['status'] ?? null) ?? 0, 'at' => mos_shell_admin_int($f['at'] ?? null)];
    }

    return [
        'on' => ($store['on'] ?? false) === true,
        'build' => mos_shell_admin_str($store['build'] ?? null, 16),
        'folder' => in_array($folder, MOS_SHELL_ADMIN_FOLDERS, true) ? $folder : null,
        'pagesInMemory' => mos_shell_admin_int($store['pagesInMemory'] ?? null) ?? 0,
        'pagesOnDisk' => mos_shell_admin_int($store['pagesOnDisk'] ?? null),
        'diskBytes' => mos_shell_admin_int($store['diskBytes'] ?? null),
        'diskAt' => mos_shell_admin_int($store['diskAt'] ?? null),
        'fresh' => [
            'productMs' => mos_shell_admin_int($fresh['productMs'] ?? null) ?? 0,
            'contentMs' => mos_shell_admin_int($fresh['contentMs'] ?? null) ?? 0,
            'listingMs' => mos_shell_admin_int($fresh['listingMs'] ?? null) ?? 0,
            'filteredMs' => mos_shell_admin_int($fresh['filteredMs'] ?? null) ?? 0,
            'hardMaxMs' => mos_shell_admin_int($fresh['hardMaxMs'] ?? null) ?? 0,
            'overrideMs' => mos_shell_admin_int($fresh['overrideMs'] ?? null),
        ],
        'armed' => ($sch['armed'] ?? false) === true,
        'why' => in_array($why, MOS_SHELL_ADMIN_WHY, true) ? $why : null,
        'at' => mos_shell_admin_str($sch['at'] ?? null, 5),
        'hasBase' => ($sch['hasBase'] ?? false) === true,
        'nextRunAt' => mos_shell_admin_int($sch['nextRunAt'] ?? null),
        'lastStart' => mos_shell_admin_int($sch['lastStart'] ?? null),
        'lastEnd' => mos_shell_admin_int($sch['lastEnd'] ?? null),
        'running' => ($run['running'] ?? false) === true,
        'startedAt' => mos_shell_admin_int($run['startedAt'] ?? null),
        'total' => mos_shell_admin_int($run['total'] ?? null),
        'visited' => mos_shell_admin_int($run['visited'] ?? null) ?? 0,
        'hits' => mos_shell_admin_int($run['hits'] ?? null) ?? 0,
        'rendered' => mos_shell_admin_int($run['rendered'] ?? null) ?? 0,
        'gone' => mos_shell_admin_int($run['gone'] ?? null) ?? 0,
        'failures' => mos_shell_admin_int($run['failures'] ?? null) ?? 0,
        'pauseMs' => mos_shell_admin_int($run['pauseMs'] ?? null),
        'workers' => mos_shell_admin_int($run['workers'] ?? null),
        'concurrency' => mos_shell_admin_int($run['concurrency'] ?? null),
        'lastPath' => mos_shell_admin_str($run['lastPath'] ?? null),
        'stopRequested' => ($run['stopRequested'] ?? false) === true,
        'lastRun' => $last,
        'runs' => $runs,
        'settings' => $settings,
        'failureList' => $failures,
    ];
}

/** Percent of a run done, or null when the total is not known. Pure. */
function mos_shell_admin_percent(int $visited, ?int $total): ?int {
    if ($total === null || $total <= 0) { return null; }
    return min(100, intdiv(max(0, $visited) * 100, $total));
}

/** Why the storefront could not give a status, from its HTTP code (0 or -1: no answer, or not configured). Pure. */
function mos_shell_admin_problem(int $code): string {
    if ($code === -2) { return 'nokey'; }
    if ($code === -1) { return 'nobase'; }
    if ($code === 0) { return 'unreachable'; }
    if ($code === 403) { return 'forbidden'; }
    return 'failed';
}

/** The notice key for an action's answer, from the action and the HTTP code. Pure. */
function mos_shell_admin_outcome(string $do, int $code): string {
    if ($code === 403) { return 'forbidden'; }
    if ($code === 0 || $code === -1 || $code === -2) { return mos_shell_admin_problem($code); }
    if ($do === 'run') { return $code === 202 ? 'run-started' : ($code === 409 ? 'run-refused' : 'failed'); }
    if ($do === 'stop') { return $code === 202 ? 'stop-sent' : ($code === 409 ? 'stop-refused' : 'failed'); }
    if ($do === 'refresh') { return $code === 200 ? 'refresh-done' : ($code === 409 ? 'refresh-refused' : 'failed'); }
    if ($do === 'clear') { return $code === 200 ? 'clear-done' : ($code === 409 ? 'clear-refused' : 'failed'); }
    return 'unknown';
}

/** Whether the user may send an action. Run and clear are for administrators (they walk every page, or empty the
 *  store); stop and a single page refresh stay with editors. Pure. */
function mos_shell_admin_allowed(string $do, bool $manage): bool {
    if ($do === 'run' || $do === 'clear' || $do === 'settings' || $do === 'defaults') { return $manage; }
    return in_array($do, ['stop', 'refresh'], true);
}

/** The HTTP timeout (seconds) for a storefront call: a clear removes every page file, so it gets longer. Pure. */
function mos_shell_admin_timeout(string $action): int {
    return $action === 'clear' ? 30 : 5;
}

/** The storefront request for a form's action: ['body' => …] to send, or ['notice' => key] when nothing is sent. Pure. */
function mos_shell_admin_request(string $do, string $path, bool $confirmed): array {
    if ($do === 'run' || $do === 'stop') { return ['body' => ['action' => $do]]; }
    if ($do === 'refresh') {
        $p = mos_shell_admin_path($path);
        return $p === null ? ['notice' => 'refresh-bad-path'] : ['body' => ['action' => 'refresh', 'path' => $p]];
    }
    if ($do === 'clear') {
        return $confirmed ? ['body' => ['action' => 'clear']] : ['notice' => 'clear-unconfirmed'];
    }
    return ['notice' => 'unknown'];
}

/** The text and the notice type ('success', 'warning' or 'error') for a notice key, or null. Pure. */
function mos_shell_admin_text(string $key): ?array {
    $texts = [
        'run-started' => ['success', 'Keyrsla hófst. Síðan uppfærist á meðan hún er í gangi.'],
        'run-refused' => ['warning', 'Ekki var hægt að keyra: keyrsla er þegar í gangi, geymslan er slökkt eða engin grunnslóð er stillt.'],
        'stop-sent' => ['success', 'Beðið um stöðvun. Keyrslan stöðvast eftir núverandi síðu.'],
        'stop-refused' => ['warning', 'Engin keyrsla er í gangi.'],
        'refresh-done' => ['success', 'Síðan er merkt til endurbyggingar við næstu heimsókn.'],
        'settings-saved' => ['success', 'Stillingarnar eru vistaðar og komnar til vefsins.'],
        'settings-saved-unsent' => ['warning', 'Stillingarnar eru vistaðar hér, en vefurinn tók þær ekki. Þær eru sendar aftur við næstu uppfærslu síðunnar.'],
        'settings-invalid' => ['error', 'Stillingarnar eru ekki gildar: athugaðu að tíminn sé HH:MM, fjöldinn 1 til 4 og hléið 0 til 30000 ms.'],
        'settings-defaults' => ['success', 'Vistuðu stillingunum er eytt. Vefurinn notar nú gildi umhverfisins eða sjálfgefin gildi.'],
        'settings-defaults-failed' => ['warning', 'Ekki tókst að eyða stillingunum á vefnum. Vistuðu stillingarnar gilda enn hér.'],
        'settings-resent' => ['info', 'Vefurinn hafði ekki vistuðu stillingarnar, svo þær voru sendar aftur.'],
        'refresh-refused' => ['warning', 'Ekki var hægt að merkja síðuna: geymslan er slökkt.'],
        'refresh-bad-path' => ['warning', 'Slóðin er ekki vörusíða eða flokkssíða vefsins, til dæmis /vara/nafn/ eða /verslun/flokkur/nafn/.'],
        'clear-done' => ['success', 'Geymslan var tæmd. Síðurnar endurbyggjast við heimsóknir.'],
        'clear-refused' => ['warning', 'Ekki var hægt að tæma: keyrsla er í gangi (stöðvaðu hana fyrst) eða geymslan er slökkt.'],
        'clear-unconfirmed' => ['warning', 'Staðfestu að tæma geymsluna með gátreitnum.'],
        'not-allowed' => ['error', 'Aðeins stjórnandi getur keyrt eða tæmt geymsluna.'],
        'nokey' => ['warning', 'Stilltu MOS_SHELL_POKE_KEY í wp-config.php með sama gildi og MOS_SHELL_POKE_KEY í umhverfi vefsins. Án lykils svarar þessi síða ekki.'],
        'nobase' => ['warning', 'Stilltu MOS_STOREFRONT_URL í wp-config.php, slóð vefsins (til dæmis https://musikogsport.is).'],
        'unreachable' => ['error', 'Vefurinn svarar ekki. Reyndu aftur eftir smástund.'],
        'forbidden' => ['error', 'Vefurinn hafnar lyklinum (403). Athugaðu að MOS_SHELL_POKE_KEY sé eins í wp-config.php og í umhverfi vefsins.'],
        'bad' => ['error', 'Vefurinn svaraði, en ekki með stöðu síðugeymslunnar. Er vefurinn uppfærður?'],
        'failed' => ['error', 'Ekki tókst. Sjá villuskrá vefsins.'],
        'unknown' => ['error', 'Óþekkt aðgerð.'],
    ];
    return $texts[$key] ?? null;
}

/** The storefront base for the admin calls (mos_headless_target_base: MOS_STOREFRONT_URL, else the local dev shim). */
function mos_shell_admin_base(): string {
    return function_exists('mos_headless_target_base') ? mos_headless_target_base() : (defined('MOS_STOREFRONT_URL') ? rtrim((string) MOS_STOREFRONT_URL, '/') : '');
}

/** The shared key, or '' when it is not set. Never printed. */
function mos_shell_admin_key(): string {
    return defined('MOS_SHELL_POKE_KEY') && is_string(MOS_SHELL_POKE_KEY) ? MOS_SHELL_POKE_KEY : '';
}

/** One request to the storefront's admin endpoint. ['code' => HTTP status, 'json' => the decoded body or null];
 *  code -1 when the key or the base is not set (no request is made), 0 when nothing answered. */
function mos_shell_admin_call(string $method, ?array $body = null): array {
    $base = mos_shell_admin_base();
    $key = mos_shell_admin_key();
    if ($key === '') { return ['code' => -2, 'json' => null]; }
    if ($base === '') { return ['code' => -1, 'json' => null]; }
    $headers = ['X-Mos-Shell-Key' => $key, 'Accept' => 'application/json'];
    $action = is_array($body) ? (string) ($body['action'] ?? '') : 'get';
    $args = ['timeout' => mos_shell_admin_timeout($action), 'redirection' => 0, 'headers' => $headers];
    if ($method === 'GET') {
        $res = wp_remote_get($base . '/api/shell-admin', $args);
    } else {
        $args['headers']['Content-Type'] = 'application/json';
        $args['body'] = (string) wp_json_encode($body ?? []);
        $res = wp_remote_post($base . '/api/shell-admin', $args);
    }
    if (is_wp_error($res)) { return ['code' => 0, 'json' => null]; }
    $json = json_decode((string) wp_remote_retrieve_body($res), true);
    return ['code' => (int) wp_remote_retrieve_response_code($res), 'json' => is_array($json) ? $json : null];
}

function mos_shell_admin_register(): void {
    $parent = defined('MOS_STILLINGAR_SLUG') ? MOS_STILLINGAR_SLUG : 'mos-stillingar';
    add_submenu_page($parent, 'Síðugeymsla', 'Síðugeymsla', 'edit_pages', MOS_SHELL_ADMIN_SLUG, 'mos_shell_admin_render');
}

function mos_shell_admin_css(): string {
    return '
.mos-sg { max-width: 1100px; }
.mos-sg__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-top: 16px; }
.mos-sg__card { background: #fff; border: 1px solid #dcdcde; border-radius: 4px; padding: 16px 20px; }
.mos-sg__card h2 { margin: 0 0 12px; font-size: 16px; }
.mos-sg__rows { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; }
.mos-sg__rows dt { color: #646970; }
.mos-sg__rows dd { margin: 0; }
.mos-sg__meta { color: #646970; font-size: 12px; }
.mos-sg progress { width: 100%; height: 14px; }
.mos-sg table { width: 100%; border-collapse: collapse; }
.mos-sg td, .mos-sg th { text-align: left; padding: 4px 6px; border-bottom: 1px solid #f0f0f1; vertical-align: top; }
.mos-sg__warn { color: #8a2424; }
.mos-sg form { margin: 0 0 12px; }
.mos-sg__field { margin: 0 0 14px; }
.mos-sg__field .mos-sg__meta { margin: 4px 0 0; }
';
}

/** The page's state: the status, or the problem to explain instead of it. */
function mos_shell_admin_fetch(): array {
    // A status read shortly before is shown again: every open tab reloads, so this keeps the storefront calls to a few a minute.
    $cached = get_transient(MOS_SHELL_ADMIN_CACHE);
    if (is_array($cached)) { return ['status' => $cached, 'problem' => null, 'pushed' => false]; }
    $res = mos_shell_admin_call('GET');
    if ($res['code'] === 200) {
        $status = mos_shell_admin_parse($res['json']);
        if ($status === null) { return ['status' => null, 'problem' => 'bad', 'pushed' => false]; }
        // Checked on a fresh read only (never on the cached one): a stale copy must not cause a push on every render.
        $pushed = mos_shell_admin_heal($status);
        set_transient(MOS_SHELL_ADMIN_CACHE, $status, MOS_SHELL_ADMIN_TTL);
        return ['status' => $status, 'problem' => null, 'pushed' => $pushed];
    }
    return ['status' => null, 'problem' => mos_shell_admin_problem($res['code']), 'pushed' => false];
}

/** Re-sends the saved settings when the storefront's copy differs from the option: its copy is lost when its temp folder
 *  is cleared by a reboot. At most one push per status fetch, and none while a push failed in the last minute. Returns
 *  true when one was sent; the status is then updated to the copy that was sent. A storefront that reports no settings
 *  is not pushed to. */
function mos_shell_admin_heal(array &$status): bool {
    if ($status['settings'] === null) { return false; }
    $option = mos_shell_settings_full(get_option(MOS_SHELL_ADMIN_SETTINGS, null));
    $failed = get_transient(MOS_SHELL_ADMIN_PUSH_FAILED);
    $held = get_transient(MOS_SHELL_ADMIN_RESETTING) !== false;
    if (!mos_shell_settings_should_push($option, $status['settings']['saved'], is_int($failed) ? $failed : null, time(), $held)) { return false; }
    $res = mos_shell_admin_call('POST', mos_shell_settings_body($option));
    if ($res['code'] === 200) {
        delete_transient(MOS_SHELL_ADMIN_PUSH_FAILED);
        $status['settings']['saved'] = $option;
        return true;
    }
    set_transient(MOS_SHELL_ADMIN_PUSH_FAILED, time(), MOS_SHELL_ADMIN_PUSH_WAIT);
    return false;
}

function mos_shell_admin_notice_html(string $type, string $text): string {
    return '<div class="notice notice-' . esc_attr($type) . ' inline"><p>' . esc_html($text) . '</p></div>';
}

function mos_shell_admin_render(): void {
    if (!current_user_can('edit_pages')) { wp_die('Þú hefur ekki heimild til þessa.', 'Síðugeymsla', ['response' => 403]); }
    $key = isset($_GET['mos_notice']) ? sanitize_key((string) wp_unslash($_GET['mos_notice'])) : '';
    echo '<div class="wrap mos-sg"><h1>Síðugeymsla</h1><style>' . mos_shell_admin_css() . '</style>';
    $notice = mos_shell_admin_text($key);
    if ($notice !== null) { echo mos_shell_admin_notice_html($notice[0], $notice[1]); }

    $state = mos_shell_admin_fetch();
    if ($state['status'] === null) {
        $explained = mos_shell_admin_text($state['problem']);
        echo mos_shell_admin_notice_html($explained[0], $explained[1]);
        echo '<p class="mos-sg__meta">Síðugeymslan og næturkeyrslan birtast þegar vefurinn svarar með réttum lykli.</p></div>';
        return;
    }
    $s = $state['status'];
    $running = $s['running'];
    if ($state['pushed']) {
        $resent = mos_shell_admin_text('settings-resent');
        echo mos_shell_admin_notice_html($resent[0], $resent[1]);
    }
    echo '<div class="mos-sg__cards">';
    mos_shell_admin_card_overview($s);
    mos_shell_admin_card_nightly($s);
    mos_shell_admin_card_settings($s, current_user_can('manage_options'));
    mos_shell_admin_card_actions($s);
    echo '</div>';
    if ($running) {
        // Auto-refresh only while a run is going, on the clean page address (no notice to show twice).
        $url = admin_url('admin.php?page=' . MOS_SHELL_ADMIN_SLUG);
        echo '<script>setTimeout(function(){window.location.replace(' . wp_json_encode($url, JSON_HEX_TAG | JSON_HEX_AMP) . ');},' . MOS_SHELL_ADMIN_RELOAD_MS . ');</script>';
    }
    echo '</div>';
}

function mos_shell_admin_row(string $label, string $value): string {
    return '<dt>' . esc_html($label) . '</dt><dd>' . esc_html($value) . '</dd>';
}

function mos_shell_admin_card_overview(array $s): void {
    $folder = $s['folder'] === 'durable' ? 'Varanleg mappa (MOS_SHELL_DIR)' : ($s['folder'] === 'temp' ? 'Tímabundin mappa (sjálfgefið)' : '–');
    $fresh = $s['fresh'];
    $life = 'Vörusíður ' . mos_shell_admin_duration($fresh['productMs']) . ', listar ' . mos_shell_admin_duration($fresh['listingMs'])
        . ', síur ' . mos_shell_admin_duration($fresh['filteredMs']) . ', hámark ' . mos_shell_admin_duration($fresh['hardMaxMs']);
    if ($fresh['overrideMs'] !== null) { $life .= '. MOS_SHELL_FRESH_MS yfirskrifar: ' . mos_shell_admin_duration($fresh['overrideMs']); }
    echo '<section class="mos-sg__card"><h2>Yfirlit</h2><dl class="mos-sg__rows">';
    echo mos_shell_admin_row('Geymsla', $s['on'] ? 'Kveikt' : 'Slökkt');
    echo mos_shell_admin_row('Síður í minni', (string) $s['pagesInMemory']);
    echo mos_shell_admin_row('Síður á diski', $s['pagesOnDisk'] === null ? '–' : (string) $s['pagesOnDisk']);
    echo mos_shell_admin_row('Stærð á diski', $s['diskBytes'] === null ? '–' : mos_shell_admin_bytes($s['diskBytes']));
    echo mos_shell_admin_row('Útgáfa', $s['build'] ?? '–');
    echo mos_shell_admin_row('Mappa', $folder);
    echo mos_shell_admin_row('Gildistími', $life);
    echo '</dl>';
    if ($s['diskAt'] !== null) { echo '<p class="mos-sg__meta">Diskatalning frá ' . esc_html(mos_shell_admin_when($s['diskAt'])) . ', uppfærð einu sinni á mínútu.</p>'; }
    echo '</section>';
}

function mos_shell_admin_card_nightly(array $s): void {
    echo '<section class="mos-sg__card"><h2>Næturkeyrsla' . ($s['at'] !== null ? ' (' . esc_html($s['at']) . ')' : '') . '</h2>';
    $source = $s['settings']['source']['enabled'] ?? 'env/default';
    $state = $s['armed'] ? 'Virk.' : (mos_shell_admin_why_text($s['why'], $source) ?? 'Óvirk.');
    echo '<p>' . esc_html($state) . '</p><dl class="mos-sg__rows">';
    echo mos_shell_admin_row('Næsta keyrsla', $s['nextRunAt'] === null ? '–' : mos_shell_admin_when($s['nextRunAt']));
    if ($s['lastRun'] !== null) {
        $l = $s['lastRun'];
        $why = $l['stoppedWhy'] === 'failures' ? ' Stöðvaðist eftir röð villna.' : ($l['stoppedWhy'] === 'stopped' ? ' Stöðvuð handvirkt.' : ($l['stoppedWhy'] === 'error' ? ' Stöðvaðist vegna villu.' : ''));
        $tally = $l['visited'] . ' síður: ' . $l['rendered'] . ' endurbyggðar, ' . $l['hits'] . ' í geymslu, ' . $l['gone'] . ' horfnar, ' . $l['failures'] . ' villur.' . $why;
        echo mos_shell_admin_row('Síðasta keyrsla', mos_shell_admin_when($l['startedAt']) . ', tók ' . mos_shell_admin_duration($l['durationMs']));
        echo mos_shell_admin_row('Niðurstaða', $tally);
        $per = mos_shell_admin_per_page($l['msPerPage'], $l['pagesPerMinute']);
        if ($per !== null) { echo mos_shell_admin_row('Mælt', $per); }
    } elseif ($s['lastStart'] !== null) {
        echo mos_shell_admin_row('Síðasta keyrsla', 'Hófst ' . mos_shell_admin_when($s['lastStart']) . '. Lokin eru ekki skráð í þessu ferli.');
    } else {
        echo mos_shell_admin_row('Síðasta keyrsla', 'Engin keyrsla skráð.');
    }
    echo '</dl>';
    if ($s['running']) { mos_shell_admin_progress($s); }
    if ($s['runs'] !== []) {
        echo '<h3>Síðustu keyrslur</h3><table><thead><tr><th>Byrjun</th><th>Tími</th><th>Síður</th><th>Endurbyggðar</th><th>Villur</th><th>Stöðvun</th></tr></thead><tbody>';
        foreach ($s['runs'] as $r) {
            $stop = mos_shell_admin_stop_text($r['stoppedEarly'], $r['stoppedWhy']);
            echo '<tr><td>' . esc_html(mos_shell_admin_when($r['startedAt'])) . '</td><td>' . esc_html(mos_shell_admin_duration($r['durationMs'])) . '</td>'
                . '<td>' . esc_html((string) $r['visited']) . '</td><td>' . esc_html((string) $r['rendered']) . '</td>'
                . '<td>' . esc_html((string) $r['failures']) . '</td><td>' . esc_html($stop) . '</td></tr>';
        }
        echo '</tbody></table>';
    }
    if ($s['failureList'] !== []) {
        echo '<h3>Nýlegar villur</h3><table><thead><tr><th>Slóð</th><th>Svar</th><th>Tími</th></tr></thead><tbody>';
        foreach ($s['failureList'] as $f) {
            $answer = $f['status'] === 0 ? 'ekkert svar' : (string) $f['status'];
            $when = $f['at'] === null ? '–' : mos_shell_admin_when($f['at']);
            echo '<tr><td>' . esc_html($f['path']) . '</td><td>' . esc_html($answer) . '</td><td>' . esc_html($when) . '</td></tr>';
        }
        echo '</tbody></table>';
    }
    echo '</section>';
}

function mos_shell_admin_why_text(?string $why, string $source = 'env/default'): ?string {
    $off = $source === 'saved' ? 'Slökkt í stillingunum hér að neðan.' : 'Slökkt (sjálfgefið). Kveiktu á henni í stillingunum hér til hliðar.';
    return [
        'store-off' => 'Geymslan er slökkt, svo næturkeyrslan gerir ekkert.',
        'off' => $off,
        'no-base' => 'Engin grunnslóð: stilltu MOS_SHELL_REBUILD_BASE eða MOS_EXTRA_ALLOWED_HOSTS í umhverfi vefsins.',
        'waiting' => 'Bíður eftir fyrstu beiðni í vefnum (hún ræsir tímateljarann).',
    ][$why ?? ''] ?? null;
}

/** How many pages walk at once, as Icelandic text: "2 síður í einu", or "1 síða í einu (hægt á vegna svartíma)" while
 *  the walk is degraded to one. Empty when no run is going. Pure. */
function mos_shell_admin_workers_text(?int $workers, ?int $configured): string {
    if ($workers === null || $configured === null || $workers < 1) { return ''; }
    $text = $workers . ($workers === 1 ? ' síða' : ' síður') . ' í einu';
    return $workers < $configured ? $text . ' (hægt á vegna svartíma)' : $text;
}

function mos_shell_admin_progress(array $s): void {
    $pct = mos_shell_admin_percent($s['visited'], $s['total']);
    $count = $s['total'] === null ? $s['visited'] . ' síður' : $s['visited'] . ' af ' . $s['total'] . ' síðum';
    echo '<h3>Keyrsla í gangi</h3>';
    if ($pct !== null) { echo '<progress max="100" value="' . (int) $pct . '" aria-label="Framvinda"></progress>'; }
    echo '<p class="mos-sg__meta">' . esc_html($count) . ($pct !== null ? ' (' . (int) $pct . '%)' : '') . '</p>';
    echo '<p class="mos-sg__meta">';
    $workers = mos_shell_admin_workers_text($s['workers'], $s['concurrency']);
    if ($workers !== '') { echo esc_html($workers) . '. '; }
    if ($s['lastPath'] !== null) { echo 'Síðast: ' . esc_html($s['lastPath']) . '. '; }
    if ($s['pauseMs'] !== null) { echo 'Hlé: ' . esc_html(mos_shell_admin_duration($s['pauseMs'])) . '. '; }
    if ($s['stopRequested']) { echo '<span class="mos-sg__warn">Stöðvun beðin: stöðvast eftir núverandi síðu.</span>'; }
    echo '</p>';
}

/** One settings control with its one-sentence explanation under it. */
function mos_shell_admin_field(string $control, string $help): string {
    return '<div class="mos-sg__field">' . $control . '<p class="mos-sg__meta">' . esc_html($help) . '</p></div>';
}

function mos_shell_admin_card_settings(array $s, bool $manage): void {
    echo '<section class="mos-sg__card"><h2>Stillingar næturkeyrslu</h2>';
    if ($s['settings'] === null) {
        echo '<p class="mos-sg__meta">Vefurinn sendir ekki stillingar: uppfærðu hann til að stilla keyrsluna hér.</p></section>';
        return;
    }
    $option = mos_shell_settings_full(get_option(MOS_SHELL_ADMIN_SETTINGS, null));
    $v = $option ?? $s['settings']['effective'];
    $url = esc_url(admin_url('admin-post.php'));
    $nonce = wp_nonce_field('mos_shell_admin_do', '_wpnonce', true, false);
    $dis = $manage ? '' : ' disabled';
    echo '<p class="mos-sg__meta">' . ($option !== null ? 'Sýnd gildi eru vistuð hér.' : 'Engin stilling er vistuð hér: sýnd eru gildi vefsins.') . '</p>';
    if (!$manage) { echo '<p class="mos-sg__meta">Aðeins stjórnendur geta breytt stillingunum.</p>'; }
    echo '<form method="post" action="' . $url . '">' . $nonce . '<input type="hidden" name="action" value="mos_shell_admin_do">';
    echo mos_shell_admin_field(
        '<label><input type="checkbox" name="enabled" value="1"' . ($v['enabled'] ? ' checked' : '') . $dis . '> Næturkeyrsla er kveikt</label>',
        'Slökkt: engin næturkeyrsla. Keyrsla sem er þegar í gangi heldur áfram þangað til hún er stöðvuð með „Stöðva keyrslu“.'
    );
    echo mos_shell_admin_field(
        '<label for="mos-sg-at">Tími (Reykjavík)</label> <input type="time" id="mos-sg-at" name="at" value="' . esc_attr($v['at']) . '" required'
        . ' pattern="([01][0-9]|2[0-3]):[0-5][0-9]"' . $dis . '>',
        'Hvenær síðurnar eru endurbyggðar á hverri nóttu. Ný stilling færir næstu keyrslu en ræsir ekki keyrslu strax.'
    );
    $select = '<label for="mos-sg-concurrency">Síður í einu</label> <select id="mos-sg-concurrency" name="concurrency"' . $dis . '>';
    for ($n = 1; $n <= MOS_SHELL_ADMIN_CONCURRENCY_MAX; $n++) {
        $select .= '<option value="' . $n . '"' . ($v['concurrency'] === $n ? ' selected' : '') . '>' . $n . '</option>';
    }
    $select .= '</select>';
    echo mos_shell_admin_field($select, 'Hversu margar síður eru endurbyggðar í einu. Vefurinn lækkar sig sjálfur í eina síðu meðan hann svarar illa.');
    echo mos_shell_admin_field(
        '<label for="mos-sg-pause">Hlé milli síðna (ms)</label> <input type="number" id="mos-sg-pause" name="pauseMs" min="0" max="' . MOS_SHELL_ADMIN_PAUSE_MAX
        . '" step="1" value="' . (int) $v['pauseMs'] . '" class="small-text" required' . $dis . '>',
        'Í millisekúndum, 0 til ' . MOS_SHELL_ADMIN_PAUSE_MAX . '. Tvöfaldast við hverja slæma svörun og lækkar aftur í þetta gildi.'
    );
    echo mos_shell_admin_field(
        '<label><input type="checkbox" name="catchUp" value="1"' . ($v['catchUp'] ? ' checked' : '') . $dis . '> Bæta upp keyrslu sem missist</label>',
        'Ef enginn vefþjónn var uppi um tímann keyrir hann næturkeyrsluna þegar hann vaknar, innan þriggja klukkustunda. Slökkt: aðeins fimm mínútur eftir tímann.'
    );
    $est = $s['settings']['estimateMs'];
    if ($est !== null) {
        echo '<p class="mos-sg__meta">Áætluð lengd keyrslu: ' . esc_html(mos_shell_admin_duration($est))
            . ', miðað við síðustu keyrslu og ' . (int) $s['settings']['effective']['concurrency'] . ' síður í einu.</p>';
    }
    echo '<button type="submit" name="do" value="settings" class="button button-primary"' . $dis . '>Vista stillingar</button></form>';
    echo '<form method="post" action="' . $url . '">' . $nonce
        . '<input type="hidden" name="action" value="mos_shell_admin_do"><input type="hidden" name="do" value="defaults">'
        . '<button type="submit" class="button"' . $dis . '>Nota sjálfgefin gildi</button>'
        . '<p class="mos-sg__meta">Eyðir vistuðu stillingunum hér og á vefnum. Þá gilda gildi umhverfisins (MOS_SHELL_REBUILD_*) eða sjálfgefin gildi.</p></form>';
    echo '</section>';
}

function mos_shell_admin_card_actions(array $s): void {
    $url = esc_url(admin_url('admin-post.php'));
    $nonce = wp_nonce_field('mos_shell_admin_do', '_wpnonce', true, false);
    $manage = current_user_can('manage_options');
    $can_run = $s['on'] && $s['hasBase'] && !$s['running'] && $manage;
    echo '<section class="mos-sg__card"><h2>Aðgerðir</h2>';
    if (!$manage) { echo '<p class="mos-sg__meta">Keyrsla og tæming eru fyrir stjórnendur.</p>'; }
    echo '<form method="post" action="' . $url . '">' . $nonce
        . '<input type="hidden" name="action" value="mos_shell_admin_do"><input type="hidden" name="do" value="run">'
        . '<button type="submit" class="button button-primary"' . ($can_run ? '' : ' disabled') . '>Keyra núna</button></form>';
    if ($s['running']) {
        echo '<form method="post" action="' . $url . '">' . $nonce
            . '<input type="hidden" name="action" value="mos_shell_admin_do"><input type="hidden" name="do" value="stop">'
            . '<button type="submit" class="button">Stöðva keyrslu</button></form>';
    }
    echo '<form method="post" action="' . $url . '">' . $nonce
        . '<input type="hidden" name="action" value="mos_shell_admin_do"><input type="hidden" name="do" value="refresh">'
        . '<label for="mos-sg-path">Slóð síðu</label> <input type="text" id="mos-sg-path" name="path" class="regular-text" '
        . 'placeholder="/vara/nafn-vorunnar/" maxlength="' . MOS_SHELL_ADMIN_PATH_MAX . '"> '
        . '<button type="submit" class="button">Endurbyggja síðu</button>'
        . '<p class="mos-sg__meta">Síðan er endurbyggð við næstu heimsókn. Slóð úr vefslóð (https://…) gengur líka.</p></form>';
    echo '<form method="post" action="' . $url . '">' . $nonce
        . '<input type="hidden" name="action" value="mos_shell_admin_do"><input type="hidden" name="do" value="clear">'
        . '<p class="mos-sg__warn">Tæmir allar geymdar síður. Hver síða verður þá endurbyggð við sína heimsókn, og vefurinn '
        . 'verður hægari meðan það gerist. Þetta verður ekki afturkallað.</p>'
        . '<label><input type="checkbox" name="confirm" value="1"' . ($manage ? ' required' : ' disabled') . '> Ég vil tæma geymsluna</label><br>'
        . '<button type="submit" class="button button-secondary" style="margin-top:8px"' . ($manage ? '' : ' disabled') . '>Tæma geymslu</button></form>';
    echo '</section>';
}

/** Saves the posted settings (checked first; a refused set changes nothing), then sends them to the storefront. The option
 *  is written before the push, so a push that fails is sent again by the self-heal. Returns the notice key. */
function mos_shell_admin_save_settings(): string {
    $form = mos_shell_settings_from_form(wp_unslash($_POST));
    if ($form['problems'] !== []) { return 'settings-invalid'; }
    update_option(MOS_SHELL_ADMIN_SETTINGS, $form['values'], false);
    $res = mos_shell_admin_call('POST', mos_shell_settings_body($form['values']));
    if ($res['code'] === 200) { delete_transient(MOS_SHELL_ADMIN_PUSH_FAILED); }
    else { set_transient(MOS_SHELL_ADMIN_PUSH_FAILED, time(), MOS_SHELL_ADMIN_PUSH_WAIT); }
    delete_transient(MOS_SHELL_ADMIN_CACHE);
    $persisted = is_array($res['json']) && array_key_exists('persisted', $res['json']) ? (bool) $res['json']['persisted'] : null;
    return mos_shell_settings_notice('settings', $res['code'], $persisted);
}

/** Drops the saved settings: the storefront's copy first, and the option only once it has gone (if the storefront cannot
 *  take the reset, the option stays, so the self-heal does not restore the copy it had). Returns the notice key. */
function mos_shell_admin_reset_settings(): string {
    // Held before the request, so a status read in the gap between the storefront's answer and the option's removal does
    // not push the old copy back.
    set_transient(MOS_SHELL_ADMIN_RESETTING, time(), MOS_SHELL_ADMIN_RESET_HOLD);
    $res = mos_shell_admin_call('POST', mos_shell_settings_body(null));
    if ($res['code'] === 200) {
        delete_option(MOS_SHELL_ADMIN_SETTINGS);
        delete_transient(MOS_SHELL_ADMIN_PUSH_FAILED);
    }
    delete_transient(MOS_SHELL_ADMIN_RESETTING);
    delete_transient(MOS_SHELL_ADMIN_CACHE);
    return mos_shell_settings_notice('defaults', $res['code']);
}

/** Admin-post handler for every form on the page: checks the nonce and the right, sends the storefront's request and
 *  redirects back with a notice key (never the storefront's own words). */
function mos_shell_admin_handle(): void {
    check_admin_referer('mos_shell_admin_do');
    if (!current_user_can('edit_pages')) { wp_die('Þú hefur ekki heimild til þessa.', 'Síðugeymsla', ['response' => 403]); }
    $do = isset($_POST['do']) ? sanitize_key((string) wp_unslash($_POST['do'])) : '';
    $path = isset($_POST['path']) ? (string) wp_unslash($_POST['path']) : '';
    $confirmed = isset($_POST['confirm']) && (string) wp_unslash($_POST['confirm']) === '1';
    $req = mos_shell_admin_request($do, $path, $confirmed);
    if (!mos_shell_admin_allowed($do, current_user_can('manage_options'))) {
        $key = 'not-allowed';
    } elseif ($do === 'settings') {
        $key = mos_shell_admin_save_settings();
    } elseif ($do === 'defaults') {
        $key = mos_shell_admin_reset_settings();
    } elseif (isset($req['notice'])) {
        $key = $req['notice'];
    } else {
        $res = mos_shell_admin_call('POST', $req['body']);
        $key = mos_shell_admin_outcome($do, $res['code']);
        delete_transient(MOS_SHELL_ADMIN_CACHE);
    }
    wp_safe_redirect(add_query_arg(['page' => MOS_SHELL_ADMIN_SLUG, 'mos_notice' => $key], admin_url('admin.php')));
    exit;
}

add_action('admin_menu', 'mos_shell_admin_register', 20);
add_action('admin_post_mos_shell_admin_do', 'mos_shell_admin_handle');
