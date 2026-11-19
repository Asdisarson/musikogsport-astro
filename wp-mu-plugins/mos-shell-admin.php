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
 * Author: Músík og Sport
 * Version: 1.0.0
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
    $last = null;
    if (is_array($json['lastRun'] ?? null)) {
        $l = $json['lastRun'];
        $stoppedWhy = $l['stoppedWhy'] ?? null;
        $last = [
            'startedAt' => mos_shell_admin_int($l['startedAt'] ?? null) ?? 0,
            'endedAt' => mos_shell_admin_int($l['endedAt'] ?? null),
            'durationMs' => mos_shell_admin_int($l['durationMs'] ?? null) ?? 0,
            'visited' => mos_shell_admin_int($l['visited'] ?? null) ?? 0,
            'hits' => mos_shell_admin_int($l['hits'] ?? null) ?? 0,
            'rendered' => mos_shell_admin_int($l['rendered'] ?? null) ?? 0,
            'gone' => mos_shell_admin_int($l['gone'] ?? null) ?? 0,
            'failures' => mos_shell_admin_int($l['failures'] ?? null) ?? 0,
            'stoppedEarly' => ($l['stoppedEarly'] ?? false) === true,
            'stoppedWhy' => in_array($stoppedWhy, MOS_SHELL_ADMIN_STOPPED, true) ? $stoppedWhy : null,
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
    if ($do === 'run' || $do === 'clear') { return $manage; }
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
';
}

/** The page's state: the status, or the problem to explain instead of it. */
function mos_shell_admin_fetch(): array {
    // A status read shortly before is shown again: every open tab reloads, so this keeps the storefront calls to a few a minute.
    $cached = get_transient(MOS_SHELL_ADMIN_CACHE);
    if (is_array($cached)) { return ['status' => $cached, 'problem' => null]; }
    $res = mos_shell_admin_call('GET');
    if ($res['code'] === 200) {
        $status = mos_shell_admin_parse($res['json']);
        if ($status === null) { return ['status' => null, 'problem' => 'bad']; }
        set_transient(MOS_SHELL_ADMIN_CACHE, $status, MOS_SHELL_ADMIN_TTL);
        return ['status' => $status, 'problem' => null];
    }
    return ['status' => null, 'problem' => mos_shell_admin_problem($res['code'])];
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
    echo '<div class="mos-sg__cards">';
    mos_shell_admin_card_overview($s);
    mos_shell_admin_card_nightly($s);
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
    $state = $s['armed'] ? 'Virk.' : (mos_shell_admin_why_text($s['why']) ?? 'Óvirk.');
    echo '<p>' . esc_html($state) . '</p><dl class="mos-sg__rows">';
    echo mos_shell_admin_row('Næsta keyrsla', $s['nextRunAt'] === null ? '–' : mos_shell_admin_when($s['nextRunAt']));
    if ($s['lastRun'] !== null) {
        $l = $s['lastRun'];
        $why = $l['stoppedWhy'] === 'failures' ? ' Stöðvaðist eftir röð villna.' : ($l['stoppedWhy'] === 'stopped' ? ' Stöðvuð handvirkt.' : ($l['stoppedWhy'] === 'error' ? ' Stöðvaðist vegna villu.' : ''));
        $tally = $l['visited'] . ' síður: ' . $l['rendered'] . ' endurbyggðar, ' . $l['hits'] . ' í geymslu, ' . $l['gone'] . ' horfnar, ' . $l['failures'] . ' villur.' . $why;
        echo mos_shell_admin_row('Síðasta keyrsla', mos_shell_admin_when($l['startedAt']) . ', tók ' . mos_shell_admin_duration($l['durationMs']));
        echo mos_shell_admin_row('Niðurstaða', $tally);
    } elseif ($s['lastStart'] !== null) {
        echo mos_shell_admin_row('Síðasta keyrsla', 'Hófst ' . mos_shell_admin_when($s['lastStart']) . '. Lokin eru ekki skráð í þessu ferli.');
    } else {
        echo mos_shell_admin_row('Síðasta keyrsla', 'Engin keyrsla skráð.');
    }
    echo '</dl>';
    if ($s['running']) { mos_shell_admin_progress($s); }
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

function mos_shell_admin_why_text(?string $why): ?string {
    return [
        'store-off' => 'Geymslan er slökkt, svo næturkeyrslan gerir ekkert.',
        'off' => 'Slökkt með MOS_SHELL_REBUILD_AT=off.',
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
