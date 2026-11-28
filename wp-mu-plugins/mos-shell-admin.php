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
 *  The nightly rebuild's settings (on or off, time, pages at a time, pause, catch-up, photos) are saved here, in the option
 *  mos_shell_settings (never autoloaded), and sent to the storefront; the page re-sends them when the storefront has lost
 *  its copy (see mos_shell_admin_heal). "Keyra núna" takes its own pages-at-a-time, pause and photos for that one run
 *  (prefilled from the saved values, never saved). The photo card shows the converted images the storefront keeps and
 *  can clear them. A storefront that predates photos is detected by its status having no "photos" block: the photo
 *  controls are then hidden and "photos" is left out of what is sent to it.
 *
 * Author: Músík og Sport
 * Version: 1.2.0
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
const MOS_SHELL_ADMIN_SETTING_KEYS = ['enabled', 'at', 'concurrency', 'pauseMs', 'catchUp', 'photos'];
/** The settings every storefront takes. "photos" came later: a saved option without it counts as photos off. */
const MOS_SHELL_ADMIN_SETTING_REQUIRED = ['enabled', 'at', 'concurrency', 'pauseMs', 'catchUp'];
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
        case 'photos':
            return is_bool($v) ? null : 'Myndir þurfa að vera true eða false.';
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
        'photos' => (string) ($post['photos'] ?? '') === '1',
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
        // Photos are always present in the result: missing (an option from before photos) or not a bool means off.
        if ($key === 'photos') { $out[$key] = ($s['photos'] ?? false) === true; continue; }
        if (array_key_exists($key, $s) && mos_shell_settings_problem($key, $s[$key]) === null) { $out[$key] = $s[$key]; }
    }
    return $out;
}

/** The option's value when it holds all five settings, valid, or null. Pure. */
function mos_shell_settings_full($v): ?array {
    if (!is_array($v)) { return null; }
    $c = mos_shell_settings_canon($v);
    foreach (MOS_SHELL_ADMIN_SETTING_REQUIRED as $key) {
        if (!array_key_exists($key, $c)) { return null; }
    }
    return $c;
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

/** The settings as one storefront takes them: a storefront that predates photos refuses an unknown key and would reject the
 *  whole save, so "photos" is left out for it. Null stays null (the copy is cleared). Pure. */
function mos_shell_settings_for_storefront(?array $values, bool $hasPhotos): ?array {
    if ($values === null || $hasPhotos) { return $values; }
    unset($values['photos']);
    return $values;
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
        'photos' => is_bool($l['photos'] ?? null) ? $l['photos'] : null,
        'photosConverted' => mos_shell_admin_int($l['photosConverted'] ?? null),
        'photosKept' => mos_shell_admin_int($l['photosKept'] ?? null),
        'photosFailed' => mos_shell_admin_int($l['photosFailed'] ?? null),
    ];
}

/** The photo block of the status (store-side image cache), or null when the storefront does not report one (an older
 *  storefront). The folder is durable or temp, nothing else. Pure. */
function mos_shell_admin_photos_block($json): ?array {
    $p = is_array($json) ? ($json['photos'] ?? null) : null;
    if (!is_array($p)) { return null; }
    $folder = $p['folder'] ?? null;
    return [
        'files' => mos_shell_admin_int($p['files'] ?? null),
        'bytes' => mos_shell_admin_int($p['bytes'] ?? null),
        'at' => mos_shell_admin_int($p['at'] ?? null),
        'folder' => in_array($folder, MOS_SHELL_ADMIN_FOLDERS, true) ? $folder : null,
    ];
}

/** The photo counts of a run as Icelandic text, or null when the run did not prepare photos (or the record predates them). Pure. */
function mos_shell_admin_photos_text(?bool $on, ?int $converted, ?int $kept, ?int $failed): ?string {
    if ($on !== true) { return null; }
    return 'breytt: ' . ($converted ?? 0) . ', þegar í geymslu: ' . ($kept ?? 0) . ', mistókst: ' . ($failed ?? 0);
}

/** The folder the photos are kept in, as the photo card says it. Pure. */
function mos_shell_admin_photo_folder_text(?string $folder): string {
    return ['durable' => 'Varanleg mappa (MOS_IMG_CACHE_DIR)', 'temp' => 'Tímabundin mappa: tæmist við endurræsingu'][$folder ?? ''] ?? '–';
}

/** The one line the photo card shows for a storefront that does not know photos yet. Pure. */
function mos_shell_admin_photos_old_text(): string {
    return 'Vefurinn kann ekki myndir enn: uppfærðu hann.';
}

/** The warning under "Tæma myndir". Pure. */
function mos_shell_admin_photos_warn(): string {
    return 'Myndirnar verða umbreyttar aftur þegar gestir biðja um þær. Þangað til fá gestir upprunalegu, þyngri myndirnar.';
}

/** The photo card's rows: the stored photos, then the live run's counts while a run prepares photos (or that it does
 *  not). An older storefront (no photo block) has none. Pure. */
function mos_shell_admin_photo_rows(?array $p, bool $running, bool $runPhotos, ?int $converted, ?int $kept, ?int $failed): array {
    if ($p === null) { return []; }
    $rows = [
        ['Geymdar myndir', $p['files'] === null ? '–' : (string) $p['files']],
        ['Stærð á diski', $p['bytes'] === null ? '–' : mos_shell_admin_bytes($p['bytes'])],
        ['Mappa', mos_shell_admin_photo_folder_text($p['folder'])],
    ];
    if ($running && $runPhotos) { $rows[] = ['Keyrsla núna', (string) mos_shell_admin_photos_text(true, $converted, $kept, $failed)]; }
    elseif ($running) { $rows[] = ['Keyrsla núna', 'Þessi keyrsla undirbýr ekki myndir.']; }
    return $rows;
}

/** The photo card's dot is busy while a run prepares photos or a clear goes. Pure. */
function mos_shell_admin_photos_busy(bool $running, bool $runPhotos, bool $clearing): bool {
    return ($running && $runPhotos) || $clearing;
}

/** The photo card's dot is on when the storefront keeps photos. Pure. */
function mos_shell_admin_photos_ok(?array $p): bool {
    return ($p['files'] ?? 0) > 0;
}

/** Whether the storefront has photos, from its fetched status: true (the status has a photo block), false (a status
 *  without one: an older storefront), or null when there is no status to read (the call failed, or the answer was not a
 *  status). Pure. */
function mos_shell_admin_has_photos(?array $json): ?bool {
    if (mos_shell_admin_parse($json) === null) { return null; }
    return mos_shell_admin_photos_block($json) !== null;
}

/** The settings a save stores and sends, by the storefront's photo state. Null when the storefront could not be asked (the
 *  save is refused and nothing is changed). An older storefront keeps the saved photos value, since the tick is not shown
 *  to it. Pure. */
function mos_shell_admin_settings_for_save(array $form, ?array $before, ?bool $hasPhotos): ?array {
    if ($hasPhotos === null) { return null; }
    if ($hasPhotos) { return $form; }
    $form['photos'] = $before !== null ? mos_shell_settings_canon($before)['photos'] : false;
    return $form;
}

/** The choices a run sends, by the storefront's photo state: none for an older storefront (it ignores them, so they would be
 *  dropped without a word), all of them for one with photos, and null when the storefront could not be asked (the run is
 *  refused). The values are the run form's as posted. Pure. */
function mos_shell_admin_run_choices(?bool $hasPhotos, array $posted): ?array {
    if ($hasPhotos === null) { return null; }
    if (!$hasPhotos) { return []; }
    $run = [];
    foreach (['concurrency' => 'run_concurrency', 'pauseMs' => 'run_pauseMs'] as $key => $field) {
        if (is_string($posted[$field] ?? null)) { $run[$key] = $posted[$field]; }
    }
    $run['photos'] = ($posted['run_photos'] ?? null) === '1';
    return $run;
}

/** Whether the run form shows its own choices (pages at a time, pause, photos): only to a storefront that takes them. Pure. */
function mos_shell_admin_run_shows_choices(bool $hasPhotos): bool {
    return $hasPhotos;
}

/** The one line the run form shows in place of its choices, for a storefront that cannot take them. Pure. */
function mos_shell_admin_run_old_text(): string {
    return 'Vefurinn kann ekki val fyrir staka keyrslu enn: uppfærðu hann. Keyrslan notar vistuðu stillingarnar.';
}

/** The status dot's state: busy while a walk or a clear goes, else ok when on, else off. Pure. */
function mos_shell_admin_dot_class(bool $ok, bool $busy): string {
    if ($busy) { return 'busy'; }
    return $ok ? 'ok' : 'off';
}

/** The two sentences under the page's title. Pure. */
function mos_shell_admin_intro_text(): string {
    return 'Hér sést hvaða síður vefsins eru geymdar tilbúnar og hvernig næturkeyrslan endurbyggir þær. '
        . 'Hér keyrir þú hana núna, stillir hana fyrir nóttina eða tæmir geymsluna.';
}

/** The run form's starting values: the saved nightly values when there are some, else the storefront's effective ones. Pure. */
function mos_shell_admin_run_defaults(?array $option, array $effective): array {
    $v = $option !== null ? array_replace($effective, mos_shell_settings_canon($option)) : $effective;
    return ['concurrency' => (int) $v['concurrency'], 'pauseMs' => (int) $v['pauseMs'], 'photos' => ($v['photos'] ?? false) === true];
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
    foreach (is_array($json['recentRuns'] ?? null) ? array_slice($json['recentRuns'], 0, MOS_SHELL_ADMIN_RUNS) : [] as $one) {
        // Not $run: that holds the live run's own fields, read below.
        $finished = mos_shell_admin_run($one);
        if ($finished !== null) { $runs[] = $finished; }
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
        // The saved copy as the storefront holds it; null when it holds none (only photos, which defaults, would be left).
        $savedCanon = is_array($set['saved'] ?? null) ? mos_shell_settings_canon($set['saved']) : [];
        $settings = [
            'effective' => [
                'enabled' => ($eff['enabled'] ?? false) === true,
                'at' => mos_shell_admin_str($eff['at'] ?? null, 5) ?? '05:00',
                'concurrency' => mos_shell_admin_int($eff['concurrency'] ?? null) ?? 2,
                'pauseMs' => mos_shell_admin_int($eff['pauseMs'] ?? null) ?? 100,
                'catchUp' => ($eff['catchUp'] ?? true) === true,
                'photos' => ($eff['photos'] ?? false) === true,
            ],
            'source' => $source,
            'saved' => array_diff_key($savedCanon, ['photos' => true]) === [] ? null : $savedCanon,
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
        'unfinishedStart' => mos_shell_admin_int($sch['unfinishedStart'] ?? null),
        // The photo block (null from an older storefront) and what the live run does with photos.
        'photos' => mos_shell_admin_photos_block($json),
        'runPhotos' => ($run['photos'] ?? false) === true,
        'runPhotosConverted' => mos_shell_admin_int($run['photosConverted'] ?? null),
        'runPhotosKept' => mos_shell_admin_int($run['photosKept'] ?? null),
        'runPhotosFailed' => mos_shell_admin_int($run['photosFailed'] ?? null),
        'running' => ($run['running'] ?? false) === true,
        'clearing' => ($run['clearing'] ?? false) === true,
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

/** The notice key for an action's answer, from the action, the HTTP code and (for a refused clear) the storefront's
 *  reason. Pure. */
function mos_shell_admin_outcome(string $do, int $code, ?array $json = null): string {
    if ($code === 403) { return 'forbidden'; }
    if ($code === 0 || $code === -1 || $code === -2) { return mos_shell_admin_problem($code); }
    $error = is_array($json) ? (string) ($json['error'] ?? '') : '';
    if ($do === 'run') {
        if ($code === 202) { return 'run-started'; }
        if ($code !== 409) { return 'failed'; }
        return [
            'clearing' => 'run-refused-clearing',
            'store-off' => 'run-refused-off',
            'no-base' => 'run-refused-nobase',
        ][$error] ?? 'run-refused';
    }
    if ($do === 'stop') { return $code === 202 ? 'stop-sent' : ($code === 409 ? 'stop-refused' : 'failed'); }
    if ($do === 'refresh') { return $code === 200 ? 'refresh-done' : ($code === 409 ? 'refresh-refused' : 'failed'); }
    if ($do === 'clearphotos') {
        if ($code === 200) { return mos_shell_admin_int($json['failed'] ?? null) > 0 ? 'clearphotos-partial' : 'clearphotos-done'; }
        if ($code !== 409) { return 'clearphotos-failed'; }
        return $error === 'clearing' ? 'clearphotos-clearing' : 'clearphotos-running';
    }
    if ($do === 'clear') {
        // A clear that left page files behind is a warning, not a success (the storefront answers the count).
        if ($code === 200) { return mos_shell_admin_int($json['failed'] ?? null) > 0 ? 'clear-partial' : 'clear-done'; }
        if ($code !== 409) { return 'failed'; }
        return [
            'clearing' => 'clear-clearing',
            'store-off' => 'clear-off',
        ][$error] ?? 'clear-running';
    }
    return 'unknown';
}

/** Whether the run button may be pressed: the store is on, a base is set, an administrator is asking, and no walk and no
 *  clear holds the slot. Pure. */
function mos_shell_admin_may_run(bool $on, bool $hasBase, bool $running, bool $clearing, bool $manage): bool {
    return $on && $hasBase && !$running && !$clearing && $manage;
}

/** Whether the clear button may be pressed: an administrator, and no clear is going already. Pure. */
function mos_shell_admin_may_clear(bool $manage, bool $clearing): bool {
    return $manage && !$clearing;
}

/** Whether the stop button is offered: for a walk only, never for a clear (a clear cannot be stopped). Pure. */
function mos_shell_admin_may_stop(bool $running, bool $clearing): bool {
    return $running && !$clearing;
}

/** The line that shows a clear in progress, or null when none goes. Pure. */
function mos_shell_admin_clearing_notice(bool $clearing): ?string {
    return $clearing ? 'Tæming í gangi. Keyrsla og önnur tæming bíða þar til henni lýkur.' : null;
}

/** Whether the page refreshes itself: while a walk or a clear goes (the status changes meanwhile). Pure. */
function mos_shell_admin_reloads(bool $running, bool $clearing): bool {
    return $running || $clearing;
}

/** The script that refreshes the page every $ms while a walk or a clear goes, to the clean address. It holds off while a
 *  control on the page has focus or differs from the value it was loaded with, so a half-typed setting or path is not
 *  thrown away; it looks again each second and refreshes once nothing is being edited. Pure. */
function mos_shell_admin_reload_script(string $url, int $ms): string {
    $to = json_encode($url, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES);
    return '<script>(function(){'
        . 'var root=document.querySelector(".mos-sg");'
        . 'var TAGS=/^(INPUT|SELECT|TEXTAREA)$/;'
        . 'function control(el){return !!el&&!!root&&root.contains(el)&&TAGS.test(el.tagName)&&el.type!=="hidden"&&el.type!=="submit"&&el.type!=="button"&&el.type!=="reset";}'
        . 'function changed(el){'
        . 'if(el.tagName==="SELECT"){for(var i=0;i<el.options.length;i++){if(el.options[i].selected!==el.options[i].defaultSelected){return true;}}return false;}'
        . 'if(el.type==="checkbox"||el.type==="radio"){return el.checked!==el.defaultChecked;}'
        . 'return el.value!==el.defaultValue;}'
        . 'function editing(){'
        . 'if(control(document.activeElement)){return true;}'
        . 'var all=root?root.querySelectorAll("input,select,textarea"):[];'
        . 'for(var j=0;j<all.length;j++){if(control(all[j])&&changed(all[j])){return true;}}'
        . 'return false;}'
        . 'function tick(){if(editing()){setTimeout(tick,1000);}else{window.location.replace(' . $to . ');}}'
        . 'setTimeout(tick,' . (int) $ms . ');'
        . '})();</script>';
}

/** The pause as the progress line shows it: milliseconds under a second ("800 ms", "100 ms"), then the durations' words. Pure. */
function mos_shell_admin_pause(int $ms): string {
    return max(0, $ms) < 1000 ? max(0, $ms) . ' ms' : mos_shell_admin_duration($ms);
}

/** The rows of 'Síðasta keyrsla' as [label, value] pairs. An interrupted run (its start stamp is newer than the last
 *  finished run, or there is none) is shown as interrupted, and the finished one behind it is not shown there (it stays in
 *  the list of runs). Pure. */
function mos_shell_admin_last_run_rows(?array $lastRun, ?int $unfinishedStart, ?int $lastStart): array {
    if ($unfinishedStart !== null && ($lastRun === null || $unfinishedStart > $lastRun['startedAt'])) {
        return [['Síðasta keyrsla', 'Hófst ' . mos_shell_admin_when($unfinishedStart) . '. Lauk ekki: keyrslan stöðvaðist áður en hún kláraðist.']];
    }
    if ($lastRun !== null) {
        $why = $lastRun['stoppedWhy'] === 'failures' ? ' Stöðvaðist eftir röð villna.' : ($lastRun['stoppedWhy'] === 'stopped' ? ' Stöðvuð handvirkt.' : ($lastRun['stoppedWhy'] === 'error' ? ' Stöðvaðist vegna villu.' : ''));
        $tally = $lastRun['visited'] . ' síður: ' . $lastRun['rendered'] . ' endurbyggðar, ' . $lastRun['hits'] . ' í geymslu, ' . $lastRun['gone'] . ' horfnar, ' . $lastRun['failures'] . ' villur.' . $why;
        $rows = [
            ['Síðasta keyrsla', mos_shell_admin_when($lastRun['startedAt']) . ', tók ' . mos_shell_admin_duration($lastRun['durationMs'])],
            ['Niðurstaða', $tally],
        ];
        $photos = mos_shell_admin_photos_text($lastRun['photos'], $lastRun['photosConverted'], $lastRun['photosKept'], $lastRun['photosFailed']);
        if ($photos !== null) { $rows[] = ['Myndir', $photos]; }
        $per = mos_shell_admin_per_page($lastRun['msPerPage'], $lastRun['pagesPerMinute']);
        if ($per !== null) { $rows[] = ['Mælt', $per]; }
        return $rows;
    }
    if ($lastStart !== null) { return [['Síðasta keyrsla', 'Hófst ' . mos_shell_admin_when($lastStart) . '. Lokin eru ekki skráð í þessu ferli.']]; }
    return [['Síðasta keyrsla', 'Engin keyrsla skráð.']];
}

/** Whether the user may send an action. Run and clear are for administrators (they walk every page, or empty the
 *  store); stop and a single page refresh stay with editors. Pure. */
function mos_shell_admin_allowed(string $do, bool $manage): bool {
    if ($do === 'run' || $do === 'clear' || $do === 'clearphotos' || $do === 'settings' || $do === 'defaults') { return $manage; }
    return in_array($do, ['stop', 'refresh'], true);
}

/** The HTTP timeout (seconds) for a storefront call: a clear removes every page file, so it gets longer. Pure. */
function mos_shell_admin_timeout(string $action): int {
    return in_array($action, ['clear', 'clear-photos'], true) ? 30 : 5;
}

/** The storefront request for a form's action: ['body' => …] to send, or ['notice' => key] when nothing is sent. Pure. */
function mos_shell_admin_request(string $do, string $path, bool $confirmed, array $run = []): array {
    if ($do === 'run') { return mos_shell_admin_run_request($run); }
    if ($do === 'stop') { return ['body' => ['action' => 'stop']]; }
    if ($do === 'refresh') {
        $p = mos_shell_admin_path($path);
        return $p === null ? ['notice' => 'refresh-bad-path'] : ['body' => ['action' => 'refresh', 'path' => $p]];
    }
    if ($do === 'clear') {
        return $confirmed ? ['body' => ['action' => 'clear']] : ['notice' => 'clear-unconfirmed'];
    }
    if ($do === 'clearphotos') {
        return $confirmed ? ['body' => ['action' => 'clear-photos']] : ['notice' => 'clearphotos-unconfirmed'];
    }
    return ['notice' => 'unknown'];
}

/** The run request with this run's choices. A key is sent only when given (absent = the saved setting); a value that is not
 *  in the storefront's bounds is refused as a notice, never clamped. Pure. */
function mos_shell_admin_run_request(array $run): array {
    $body = ['action' => 'run'];
    if (($run['concurrency'] ?? null) !== null) {
        $n = mos_shell_admin_number($run['concurrency']);
        if (mos_shell_settings_problem('concurrency', $n) !== null) { return ['notice' => 'run-invalid']; }
        $body['concurrency'] = $n;
    }
    if (($run['pauseMs'] ?? null) !== null) {
        $n = mos_shell_admin_number($run['pauseMs']);
        if (mos_shell_settings_problem('pauseMs', $n) !== null) { return ['notice' => 'run-invalid']; }
        $body['pauseMs'] = $n;
    }
    if (($run['photos'] ?? null) !== null) { $body['photos'] = $run['photos'] === true; }
    return ['body' => $body];
}

/** An int from a request value: an int, or a string of digits; anything else is null. Pure. */
function mos_shell_admin_number($v): ?int {
    if (is_int($v)) { return $v; }
    if (is_string($v) && preg_match('/^\d{1,6}$/', $v) === 1) { return (int) $v; }
    return null;
}

/** The text and the notice type ('success', 'warning' or 'error') for a notice key, or null. Pure. */
function mos_shell_admin_text(string $key): ?array {
    $texts = [
        'run-started' => ['success', 'Keyrsla hófst. Síðan uppfærist á meðan hún er í gangi.'],
        'run-refused' => ['warning', 'Ekki var hægt að keyra: keyrsla er þegar í gangi.'],
        'run-refused-clearing' => ['warning', 'Ekki var hægt að keyra: geymslan er að tæmast. Bíddu þar til tæmingunni lýkur og reyndu aftur.'],
        'run-refused-off' => ['warning', 'Ekki var hægt að keyra: geymslan er slökkt.'],
        'run-refused-nobase' => ['warning', 'Ekki var hægt að keyra: engin grunnslóð er stillt. Stilltu MOS_SHELL_REBUILD_BASE í umhverfi vefsins.'],
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
        'storefront-unknown' => ['error', 'Vefurinn svaraði ekki, svo ekkert var sent. Prófaðu aftur.'],
        'run-invalid' => ['error', 'Ekki var hægt að keyra: athugaðu gildin fyrir síður í einu og hlé (hlé 0 til 30000 ms). Ekkert var sent.'],
        'clearphotos-done' => ['success', 'Myndirnar voru tæmdar. Þær verða umbreyttar aftur þegar gestir biðja um þær.'],
        'clearphotos-partial' => ['warning', 'Myndirnar voru tæmdar, en ekki tókst að fjarlægja allar. Athugaðu villuskrá vefsins og reyndu aftur.'],
        'clearphotos-running' => ['warning', 'Ekki var hægt að tæma myndir: keyrsla er í gangi. Bíddu þar til henni lýkur.'],
        'clearphotos-clearing' => ['warning', 'Ekki var hægt að tæma myndir: tæming er þegar í gangi. Bíddu eftir henni.'],
        'clearphotos-unconfirmed' => ['warning', 'Staðfestu að tæma myndirnar með gátreitnum.'],
        'clearphotos-failed' => ['error', 'Ekki tókst að tæma myndirnar. Sjá villuskrá vefsins.'],
        'refresh-bad-path' => ['warning', 'Slóðin er ekki vörusíða eða flokkssíða vefsins, til dæmis /vara/nafn/ eða /verslun/flokkur/nafn/.'],
        'clear-done' => ['success', 'Geymslan var tæmd. Síðurnar endurbyggjast við heimsóknir.'],
        'clear-partial' => ['warning', 'Geymslan var tæmd, en ekki tókst að fjarlægja allar síður. Síður sem eftir eru gætu birst áfram þar til þær endurbyggjast. Athugaðu villuskrá vefsins og reyndu aftur.'],
        'clear-clearing' => ['warning', 'Ekki var hægt að tæma: tæming er þegar í gangi. Bíddu eftir henni.'],
        'clear-running' => ['warning', 'Ekki var hægt að tæma: keyrsla var í gangi. Stöðvaðu hana, bíddu þar til hún er hætt og reyndu aftur.'],
        'clear-off' => ['warning', 'Ekki var hægt að tæma: geymslan er slökkt.'],
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
    $parent = defined('MOS_SETTINGS_SLUG') ? MOS_SETTINGS_SLUG : 'mos-settings';
    add_submenu_page($parent, 'Síðugeymsla', 'Síðugeymsla', 'edit_pages', MOS_SHELL_ADMIN_SLUG, 'mos_shell_admin_render');
}

function mos_shell_admin_css(): string {
    return <<<'CSS'
.mos-sg { --mos-sg-line: #dcdcde; --mos-sg-ink: #1d2327; --mos-sg-meta: #646970; --mos-sg-warn: #8a2424; --mos-sg-accent: #2271b1; --mos-sg-ok: #00a32a; --mos-sg-busy: #dba617; --mos-sg-off: #a7aaad; max-width: 1164px; color: var(--mos-sg-ink); }
.mos-sg__intro { max-width: 1164px; margin: 12px 0 16px; padding: 12px 16px; border-left: 4px solid var(--mos-sg-accent); background: #fff; font-size: 14px; }
.mos-sg__cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
@media (min-width: 1100px) { .mos-sg__cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.mos-sg__card { min-width: 0; padding: 16px 20px; border: 1px solid var(--mos-sg-line); border-radius: 8px; background: #fff; }
.mos-sg__card h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--mos-sg-meta); }
.mos-sg__card h3 { margin: 16px 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--mos-sg-meta); }
.mos-sg__dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--mos-sg-off); }
.mos-sg__dot--ok { background: var(--mos-sg-ok); }
.mos-sg__dot--busy { background: var(--mos-sg-busy); }
.mos-sg__dot--off { background: var(--mos-sg-off); }
.mos-sg__rows { margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 16px; }
.mos-sg__rows dt { color: var(--mos-sg-meta); }
.mos-sg__rows dd { margin: 0; overflow-wrap: anywhere; }
.mos-sg__meta { margin: 6px 0 0; color: var(--mos-sg-meta); font-size: 12px; max-width: 72ch; }
.mos-sg__warn { margin: 6px 0; color: var(--mos-sg-warn); }
.mos-sg__group { margin: 0 0 16px; padding-top: 12px; border-top: 1px solid #f0f0f1; }
.mos-sg__group:first-of-type { padding-top: 0; border-top: 0; }
.mos-sg__group .button { margin: 0 6px 6px 0; }
.mos-sg progress { width: 100%; height: 14px; margin: 8px 0 4px; }
.mos-sg__scroll { max-width: 100%; overflow-x: auto; }
.mos-sg table { width: 100%; border-collapse: collapse; }
.mos-sg td, .mos-sg th { padding: 4px 6px; text-align: left; font-size: 13px; vertical-align: top; border-bottom: 1px solid #f0f0f1; }
.mos-sg form { margin: 0 0 14px; }
.mos-sg__field { margin: 0 0 14px; }
.mos-sg__field .mos-sg__meta { margin-top: 4px; }
.mos-sg input.regular-text { width: 100%; max-width: 100%; box-sizing: border-box; }
.mos-sg__group input.regular-text { margin: 4px 0 8px; }
.mos-sg input[type=number].small-text { width: 7em; max-width: 100%; }
.mos-sg select, .mos-sg input[type=time] { max-width: 100%; }
@media (max-width: 480px) {
    .mos-sg__card { padding: 14px 14px; }
    .mos-sg__rows { grid-template-columns: minmax(0, 1fr); gap: 2px; }
    .mos-sg__rows dd { margin-bottom: 6px; }
}
CSS;
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
    $hasPhotos = $status['photos'] !== null;
    $option = mos_shell_settings_for_storefront(mos_shell_settings_full(get_option(MOS_SHELL_ADMIN_SETTINGS, null)), $hasPhotos);
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

/** Whether the storefront has photos (its status has the "photos" block): true, false, or null when it could not be asked.
 *  Read from the cached status when there is one (a cached status is always a real read), else asked now. */
function mos_shell_admin_storefront_has_photos(): ?bool {
    $cached = get_transient(MOS_SHELL_ADMIN_CACHE);
    if (is_array($cached)) { return ($cached['photos'] ?? null) !== null; }
    $res = mos_shell_admin_call('GET');
    return mos_shell_admin_has_photos($res['code'] === 200 ? $res['json'] : null);
}

function mos_shell_admin_notice_html(string $type, string $text): string {
    return '<div class="notice notice-' . esc_attr($type) . ' inline"><p>' . esc_html($text) . '</p></div>';
}

function mos_shell_admin_render(): void {
    if (!current_user_can('edit_pages')) { wp_die('Þú hefur ekki heimild til þessa.', 'Síðugeymsla', ['response' => 403]); }
    $key = isset($_GET['mos_notice']) ? sanitize_key((string) wp_unslash($_GET['mos_notice'])) : '';
    echo '<div class="wrap mos-sg"><h1>Síðugeymsla</h1><p class="mos-sg__intro">' . esc_html(mos_shell_admin_intro_text()) . '</p><style>' . mos_shell_admin_css() . '</style>';
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
    if ($state['pushed']) {
        $resent = mos_shell_admin_text('settings-resent');
        echo mos_shell_admin_notice_html($resent[0], $resent[1]);
    }
    echo '<div class="mos-sg__cards">';
    mos_shell_admin_card_overview($s);
    mos_shell_admin_card_nightly($s);
    mos_shell_admin_card_settings($s, current_user_can('manage_options'));
    mos_shell_admin_card_actions($s);
    mos_shell_admin_card_photos($s);
    echo '</div>';
    if (mos_shell_admin_reloads($s['running'], $s['clearing'])) {
        // Auto-refresh while a walk or a clear goes, on the clean page address (no notice to show twice); the guard
        // holds it while a setting or the path is being edited.
        echo mos_shell_admin_reload_script(admin_url('admin.php?page=' . MOS_SHELL_ADMIN_SLUG), MOS_SHELL_ADMIN_RELOAD_MS);
    }
    echo '</div>';
}

/** The status dot before a card's heading: green when on, yellow while something goes, grey when off. Its meaning is in the
 *  rows beside it, so it is hidden from screen readers. */
function mos_shell_admin_dot(bool $ok, bool $busy): string {
    return '<span class="mos-sg__dot mos-sg__dot--' . esc_attr(mos_shell_admin_dot_class($ok, $busy)) . '" aria-hidden="true"></span>';
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
    $busy = $s['running'] || $s['clearing'];
    echo '<section class="mos-sg__card"><h2>' . mos_shell_admin_dot($s['on'], $busy) . 'Yfirlit</h2><dl class="mos-sg__rows">';
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
    echo '<section class="mos-sg__card"><h2>' . mos_shell_admin_dot($s['armed'], $s['running'] || $s['clearing'])
        . 'Næturkeyrsla' . ($s['at'] !== null ? ' (' . esc_html($s['at']) . ')' : '') . '</h2>';
    $source = $s['settings']['source']['enabled'] ?? 'env/default';
    $state = $s['armed'] ? 'Virk.' : (mos_shell_admin_why_text($s['why'], $source) ?? 'Óvirk.');
    echo '<p>' . esc_html($state) . '</p><dl class="mos-sg__rows">';
    echo mos_shell_admin_row('Næsta keyrsla', $s['nextRunAt'] === null ? '–' : mos_shell_admin_when($s['nextRunAt']));
    foreach (mos_shell_admin_last_run_rows($s['lastRun'], $s['unfinishedStart'], $s['lastStart']) as [$label, $value]) {
        echo mos_shell_admin_row($label, $value);
    }
    echo '</dl>';
    if ($s['running']) { mos_shell_admin_progress($s); }
    if ($s['runs'] !== []) {
        echo '<h3>Síðustu keyrslur</h3><div class="mos-sg__scroll"><table><thead><tr><th>Byrjun</th><th>Tími</th><th>Síður</th><th>Endurbyggðar</th><th>Villur</th><th>Stöðvun</th><th>Myndir</th></tr></thead><tbody>';
        foreach ($s['runs'] as $r) {
            $stop = mos_shell_admin_stop_text($r['stoppedEarly'], $r['stoppedWhy']);
            echo '<tr><td>' . esc_html(mos_shell_admin_when($r['startedAt'])) . '</td><td>' . esc_html(mos_shell_admin_duration($r['durationMs'])) . '</td>'
                . '<td>' . esc_html((string) $r['visited']) . '</td><td>' . esc_html((string) $r['rendered']) . '</td>'
                . '<td>' . esc_html((string) $r['failures']) . '</td><td>' . esc_html($stop) . '</td>'
                . '<td>' . esc_html(mos_shell_admin_photos_text($r['photos'], $r['photosConverted'], $r['photosKept'], $r['photosFailed']) ?? '–') . '</td></tr>';
        }
        echo '</tbody></table></div>';
    }
    if ($s['failureList'] !== []) {
        echo '<h3>Nýlegar villur</h3><div class="mos-sg__scroll"><table><thead><tr><th>Slóð</th><th>Svar</th><th>Tími</th></tr></thead><tbody>';
        foreach ($s['failureList'] as $f) {
            $answer = $f['status'] === 0 ? 'ekkert svar' : (string) $f['status'];
            $when = $f['at'] === null ? '–' : mos_shell_admin_when($f['at']);
            echo '<tr><td>' . esc_html($f['path']) . '</td><td>' . esc_html($answer) . '</td><td>' . esc_html($when) . '</td></tr>';
        }
        echo '</tbody></table></div>';
    }
    echo '</section>';
}

function mos_shell_admin_why_text(?string $why, string $source = 'env/default'): ?string {
    $off = $source === 'saved' ? 'Slökkt í stillingunum hér á síðunni.' : 'Slökkt (sjálfgefið). Kveiktu á henni í stillingunum hér á síðunni.';
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
    if ($s['pauseMs'] !== null) { echo 'Hlé: ' . esc_html(mos_shell_admin_pause($s['pauseMs'])) . '. '; }
    if ($s['stopRequested']) { echo '<span class="mos-sg__warn">Stöðvun beðin: stöðvast eftir núverandi síðu.</span>'; }
    echo '</p>';
    // A storefront that predates photos says nothing about them here.
    if ($s['photos'] !== null) {
        echo '<p class="mos-sg__meta">' . ($s['runPhotos']
            ? 'Myndir: já, þessi keyrsla undirbýr þær (' . esc_html((string) mos_shell_admin_photos_text(true, $s['runPhotosConverted'], $s['runPhotosKept'], $s['runPhotosFailed'])) . ').'
            : 'Myndir: nei, þessi keyrsla undirbýr ekki myndir.') . '</p>';
    }
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
    if ($s['photos'] !== null) {
        echo mos_shell_admin_field(
            '<label><input type="checkbox" name="photos" value="1"' . ($v['photos'] ? ' checked' : '') . $dis . '> Myndir líka</label>',
            'Næturkeyrslan endurbyggir líka myndirnar sem síðurnar biðja um, allar stærðir og bæði snið. Slökkt sjálfgefið: myndir eru þá umbreyttar fyrst þegar gestir biðja um þær.'
        );
    }
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
    $can_run = mos_shell_admin_may_run($s['on'], $s['hasBase'], $s['running'], $s['clearing'], $manage);
    $may_clear = mos_shell_admin_may_clear($manage, $s['clearing']);
    $dis = $can_run ? '' : ' disabled';
    // The run form starts from the saved nightly values, or the storefront's when none are saved. It sends them for this run only.
    $effective = $s['settings']['effective'] ?? ['enabled' => false, 'at' => '05:00', 'concurrency' => 2, 'pauseMs' => 100, 'catchUp' => true, 'photos' => false];
    $run = mos_shell_admin_run_defaults(mos_shell_settings_full(get_option(MOS_SHELL_ADMIN_SETTINGS, null)), $effective);
    echo '<section class="mos-sg__card"><h2>Aðgerðir</h2>';
    if (!$manage) { echo '<p class="mos-sg__meta">Keyrsla og tæming eru fyrir stjórnendur.</p>'; }
    $clearing = mos_shell_admin_clearing_notice($s['clearing']);
    if ($clearing !== null) { echo '<p class="mos-sg__warn">' . esc_html($clearing) . '</p>'; }

    // Keyra núna: this run's pages at a time, pause and photos (the saved settings are not changed).
    $options = '';
    for ($n = 1; $n <= MOS_SHELL_ADMIN_CONCURRENCY_MAX; $n++) {
        $options .= '<option value="' . $n . '"' . ($run['concurrency'] === $n ? ' selected' : '') . '>' . $n . '</option>';
    }
    echo '<div class="mos-sg__group"><h3>Keyra núna</h3>';
    echo '<form method="post" action="' . $url . '">' . $nonce
        . '<input type="hidden" name="action" value="mos_shell_admin_do"><input type="hidden" name="do" value="run">';
    // A storefront that predates photos ignores the run's own choices, so they are not offered to it.
    if (mos_shell_admin_run_shows_choices($s['photos'] !== null)) {
        echo mos_shell_admin_field(
            '<label for="mos-sg-run-concurrency">Síður í einu</label> <select id="mos-sg-run-concurrency" name="run_concurrency"' . $dis . '>' . $options . '</select>',
            'Gildir aðeins fyrir þessa keyrslu. Vistuðu næturstillingunum er ekki breytt.'
        );
        echo mos_shell_admin_field(
            '<label for="mos-sg-run-pause">Hlé milli síðna (ms)</label> <input type="number" id="mos-sg-run-pause" name="run_pauseMs" min="0" max="' . MOS_SHELL_ADMIN_PAUSE_MAX
            . '" step="1" value="' . (int) $run['pauseMs'] . '" class="small-text" required' . $dis . '>',
            'Í millisekúndum, 0 til ' . MOS_SHELL_ADMIN_PAUSE_MAX . '.'
        );
        echo mos_shell_admin_field(
            '<label><input type="checkbox" name="run_photos" value="1"' . ($run['photos'] ? ' checked' : '') . $dis . '> Myndir líka</label>',
            'Undirbýr líka myndirnar sem síðurnar biðja um. Tekur lengri tíma og notar meiri örgjörva.'
        );
    } else {
        echo '<p class="mos-sg__meta">' . esc_html(mos_shell_admin_run_old_text()) . '</p>';
    }
    echo '<button type="submit" class="button button-primary"' . $dis . '>Keyra núna</button></form>';
    if (mos_shell_admin_may_stop($s['running'], $s['clearing'])) {
        echo '<form method="post" action="' . $url . '">' . $nonce
            . '<input type="hidden" name="action" value="mos_shell_admin_do"><input type="hidden" name="do" value="stop">'
            . '<button type="submit" class="button">Stöðva keyrslu</button></form>';
    }
    echo '</div>';

    // One page.
    echo '<div class="mos-sg__group"><h3>Ein síða</h3>';
    echo '<form method="post" action="' . $url . '">' . $nonce
        . '<input type="hidden" name="action" value="mos_shell_admin_do"><input type="hidden" name="do" value="refresh">'
        . '<label for="mos-sg-path">Slóð síðu</label> <input type="text" id="mos-sg-path" name="path" class="regular-text" '
        . 'placeholder="/vara/nafn-vorunnar/" maxlength="' . MOS_SHELL_ADMIN_PATH_MAX . '"> '
        . '<button type="submit" class="button">Endurbyggja síðu</button>'
        . '<p class="mos-sg__meta">Síðan er endurbyggð við næstu heimsókn. Slóð úr vefslóð (https://…) gengur líka.</p></form>';
    echo '</div>';

    // Clear the store (pages). Photos have their own card.
    echo '<div class="mos-sg__group"><h3>Tæma geymslu</h3>';
    echo '<form method="post" action="' . $url . '">' . $nonce
        . '<input type="hidden" name="action" value="mos_shell_admin_do"><input type="hidden" name="do" value="clear">'
        . '<p class="mos-sg__warn">Tæmir allar geymdar síður. Hver síða verður þá endurbyggð við sína heimsókn, og vefurinn '
        . 'verður hægari meðan það gerist. Þetta verður ekki afturkallað.</p>'
        . '<label><input type="checkbox" name="confirm" value="1"' . ($may_clear ? ' required' : ' disabled') . '> Ég vil tæma geymsluna</label>'
        . '<p><button type="submit" class="button button-secondary"' . ($may_clear ? '' : ' disabled') . '>Tæma geymslu</button></p></form>';
    echo '</div>';
    echo '</section>';
}

/** The photo card: the converted images the storefront keeps, their disk use and folder, and the clear for them. A
 *  storefront that predates photos gets one line instead. */
function mos_shell_admin_card_photos(array $s): void {
    $p = $s['photos'];
    $busy = mos_shell_admin_photos_busy($s['running'], $s['runPhotos'], $s['clearing']);
    echo '<section class="mos-sg__card"><h2>' . mos_shell_admin_dot(mos_shell_admin_photos_ok($p), $busy) . 'Myndir</h2>';
    if ($p === null) {
        echo '<p class="mos-sg__meta">' . esc_html(mos_shell_admin_photos_old_text()) . '</p></section>';
        return;
    }
    $manage = current_user_can('manage_options');
    $url = esc_url(admin_url('admin-post.php'));
    $nonce = wp_nonce_field('mos_shell_admin_do', '_wpnonce', true, false);
    $may_clear = mos_shell_admin_may_clear($manage, $s['clearing']);
    echo '<dl class="mos-sg__rows">';
    foreach (mos_shell_admin_photo_rows($p, $s['running'], $s['runPhotos'], $s['runPhotosConverted'], $s['runPhotosKept'], $s['runPhotosFailed']) as [$label, $value]) {
        echo mos_shell_admin_row($label, $value);
    }
    echo '</dl>';
    if ($p['at'] !== null) { echo '<p class="mos-sg__meta">Talning frá ' . esc_html(mos_shell_admin_when($p['at'])) . ', uppfærð einu sinni á mínútu.</p>'; }
    echo '<div class="mos-sg__group"><form method="post" action="' . $url . '">' . $nonce
        . '<input type="hidden" name="action" value="mos_shell_admin_do"><input type="hidden" name="do" value="clearphotos">'
        . '<p class="mos-sg__warn">' . esc_html(mos_shell_admin_photos_warn()) . '</p>'
        . '<label><input type="checkbox" name="confirm" value="1"' . ($may_clear ? ' required' : ' disabled') . '> Ég vil tæma myndirnar</label>'
        . '<p><button type="submit" class="button button-secondary"' . ($may_clear ? '' : ' disabled') . '>Tæma myndir</button></p></form></div>';
    echo '</section>';
}

/** Saves the posted settings (checked first; a refused set changes nothing), then sends them to the storefront. The option
 *  is written before the push, so a push that fails is sent again by the self-heal. Returns the notice key. */
function mos_shell_admin_save_settings(): string {
    $form = mos_shell_settings_from_form(wp_unslash($_POST));
    if ($form['problems'] !== []) { return 'settings-invalid'; }
    $hasPhotos = mos_shell_admin_storefront_has_photos();
    $before = get_option(MOS_SHELL_ADMIN_SETTINGS, null);
    $values = mos_shell_admin_settings_for_save($form['values'], is_array($before) ? $before : null, $hasPhotos);
    // The storefront could not be asked, so it is not known whether it takes photos: nothing is changed or sent.
    if ($values === null) { return 'storefront-unknown'; }
    update_option(MOS_SHELL_ADMIN_SETTINGS, $values, false);
    $res = mos_shell_admin_call('POST', mos_shell_settings_body(mos_shell_settings_for_storefront($values, $hasPhotos === true)));
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
    // This run's choices, by what the storefront takes (the run form's own field names, so they never meet the settings
    // form's). Null when the storefront could not be asked: the run is refused.
    $run = $do === 'run' ? mos_shell_admin_run_choices(mos_shell_admin_storefront_has_photos(), wp_unslash($_POST)) : [];
    $req = mos_shell_admin_request($do, $path, $confirmed, $run ?? []);
    if (!mos_shell_admin_allowed($do, current_user_can('manage_options'))) {
        $key = 'not-allowed';
    } elseif ($do === 'settings') {
        $key = mos_shell_admin_save_settings();
    } elseif ($do === 'defaults') {
        $key = mos_shell_admin_reset_settings();
    } elseif ($run === null) {
        $key = 'storefront-unknown';
    } elseif (isset($req['notice'])) {
        $key = $req['notice'];
    } else {
        $res = mos_shell_admin_call('POST', $req['body']);
        $key = mos_shell_admin_outcome($do, $res['code'], $res['json']);
        delete_transient(MOS_SHELL_ADMIN_CACHE);
    }
    wp_safe_redirect(add_query_arg(['page' => MOS_SHELL_ADMIN_SLUG, 'mos_notice' => $key], admin_url('admin.php')));
    exit;
}

add_action('admin_menu', 'mos_shell_admin_register', 20);
add_action('admin_post_mos_shell_admin_do', 'mos_shell_admin_handle');
// The notice key leaves the address once the page has shown it (WordPress rewrites the address for these arguments),
// so a reload or a bookmark does not show an old notice again.
add_filter('removable_query_args', static function ($args) {
    $args[] = 'mos_notice';
    return $args;
});
