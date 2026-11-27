<?php
/**
 * Plugin Name: MOS Menu Editor
 * Description: The owner's menu editor: the page "Valmynd" under Stillingar. A copy of the shop's header (flipar ›
 *  dálkar › tenglar) where clicking an item edits it in a side panel. Items are added from the catalog
 *  (Vöruflokkur, Vörumerki, Félagslið, Íþrótt, optionally for Konur / Karlar / Börn), as an address, or as a heading;
 *  renamed, moved and removed. "Vista valmynd" writes the whole menu the way mos-nav.php writes a build
 *  (mos_nav_write: an ordinary WordPress menu in the primary location, the menu it replaces kept as the one backup),
 *  so "Afturkalla síðustu vistun" is a switch back to that backup, and mos-headless-api.php tells the storefront.
 *  A menu saved here is the owner's: mos-nav.php never rebuilds it unasked. Needs mos-nav.php and mos-headless-api.php.
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_MENU_EDITOR_SLUG = 'mos-menu';
const MOS_MENU_EDITOR_CAP = 'edit_theme_options';   // what WordPress asks for its own menu screen
const MOS_MENU_EDITOR_MAX_ITEMS = 600;
const MOS_MENU_EDITOR_MAX_TITLE = 100;
const MOS_MENU_EDITOR_MAX_DEPTH = 3;                // flipar › dálkar › tenglar
const MOS_MENU_EDITOR_MAX_HREF = 2000;

/* ------------------------------------------------------------------------
 * 1. Pure helpers (no WordPress calls; tests/mos_menu_editor_test.php)
 * --------------------------------------------------------------------- */

/**
 * The address of a menu item as it may be saved: a place in the shop ("/…"; a bare "skilmalar/" gets its slash),
 * "#" for a heading (also for an empty address), or a full http(s), mailto or tel address. Null for anything else:
 * another scheme, a protocol-relative or backslash address (another host in a browser), control characters.
 */
function mos_menu_editor_clean_href(string $href): ?string {
    $href = trim($href);
    if ($href === '' || $href === '#') { return '#'; }
    if (strlen($href) > MOS_MENU_EDITOR_MAX_HREF || preg_match('/[\x00-\x1F\x7F\\\\]/', $href)) { return null; }
    if (preg_match('/^([a-z][a-z0-9+.\-]*):/i', (string) preg_replace('/\s+/', '', $href), $m)) {
        $scheme = strtolower($m[1]);
        if ($scheme === 'mailto' || $scheme === 'tel') { return $href; }
        return ($scheme === 'http' || $scheme === 'https') && preg_match('#^https?://[^/\s]+#i', $href) ? $href : null;
    }
    if (str_starts_with($href, '//')) { return null; }
    return $href[0] === '/' ? $href : '/' . $href;
}

/**
 * The editor's tree ([{t, h, c}]) as the tree mos_nav_write takes ([{title, href, children}]), or the reasons it is
 * not saved (in Icelandic, for the owner). Nothing is returned to write when anything is wrong: a menu is saved whole.
 *
 * @param mixed $input the decoded JSON
 * @return array{tree:list<array>,errors:list<string>,items:int}
 */
function mos_menu_editor_clean_tree($input): array {
    $errors = [];
    $items = 0;
    $walk = static function ($nodes, int $depth) use (&$walk, &$errors, &$items): array {
        $out = [];
        foreach (is_array($nodes) ? $nodes : [] as $node) {
            if (!is_array($node) || !is_string($node['t'] ?? null)) { $errors['shape'] = 'Valmyndin barst ekki rétt. Endurhladdu síðuna og reyndu aftur.'; continue; }
            $title = trim((string) preg_replace('/\s+/u', ' ', strip_tags($node['t'])));
            $items++;
            if ($title === '') { $errors['title'] = 'Atriði vantar heiti.'; continue; }
            if (mb_strlen($title) > MOS_MENU_EDITOR_MAX_TITLE) { $errors[] = "Heitið „" . mb_substr($title, 0, 30) . "…“ er of langt (mest " . MOS_MENU_EDITOR_MAX_TITLE . " stafir)."; continue; }
            $href = mos_menu_editor_clean_href(is_string($node['h'] ?? null) ? $node['h'] : '');
            if ($href === null) { $errors[] = "Slóðin á „{$title}“ er ekki gild."; continue; }
            if ($depth > MOS_MENU_EDITOR_MAX_DEPTH) { $errors['depth'] = 'Valmyndin má mest vera þrjú lög: flipar, dálkar og tenglar.'; continue; }
            $out[] = ['title' => $title, 'href' => $href, 'children' => $walk($node['c'] ?? [], $depth + 1)];
        }
        return $out;
    };
    if (!is_array($input) || ($input !== [] && !array_is_list($input))) {
        return ['tree' => [], 'errors' => ['Valmyndin barst ekki rétt. Endurhladdu síðuna og reyndu aftur.'], 'items' => 0];
    }
    $tree = $walk($input, 1);
    if ($input === []) { $errors[] = 'Valmyndin er tóm og var ekki vistuð: verslunin þarf að minnsta kosti einn flipa.'; }
    if ($items > MOS_MENU_EDITOR_MAX_ITEMS) { $errors[] = 'Valmyndin er of stór (mest ' . MOS_MENU_EDITOR_MAX_ITEMS . ' atriði).'; }
    $errors = array_values($errors);
    return ['tree' => $errors ? [] : $tree, 'errors' => $errors, 'items' => $items];
}

/**
 * The notice after a save, from the warnings mos_nav_write returned. Any warning means the earlier menu may not have
 * been kept as the backup, so the notice must not promise one.
 *
 * @param list<string> $warnings
 */
function mos_menu_editor_saved_notice(array $warnings): string {
    return $warnings ? 'saved_nobackup' : 'saved';
}

/* ------------------------------------------------------------------------
 * 2. WordPress: the menu as the editor reads it, the save and the switch back
 * --------------------------------------------------------------------- */

/** The page's address, optionally with a notice (MOS_MENU_EDITOR_NOTICES) and a count for it. */
function mos_menu_editor_url(string $notice = '', int $items = 0): string {
    $args = ['page' => MOS_MENU_EDITOR_SLUG];
    if ($notice !== '') { $args['mos_menu_editor'] = $notice; }
    if ($items > 0) { $args['mos_menu_editor_items'] = $items; }
    return add_query_arg($args, admin_url('admin.php'));
}

/** True when the plugins this page writes and reads through are installed. */
function mos_menu_editor_ready(): bool {
    return function_exists('mos_nav_write') && function_exists('mos_build_menu_tree');
}

/** The menu shown in the shop as the editor's tree ([{t, h, c}], addresses as the storefront has them). */
function mos_menu_editor_tree(): array {
    $shown = mos_nav_shown_menu_id();
    $items = $shown > 0 ? wp_get_nav_menu_items($shown) : [];
    $slim = static function (array $nodes) use (&$slim): array {
        return array_map(static fn (array $n): array => ['t' => (string) $n['title'], 'h' => (string) $n['href'], 'c' => $slim($n['children'])], $nodes);
    };
    return $slim(mos_build_menu_tree(is_array($items) ? $items : []));
}

/** What an item can be picked from: each catalog term with products, its storefront address and its product count. */
function mos_menu_editor_sources(): array {
    $path = static fn ($term): string => (string) wp_parse_url((string) get_term_link($term), PHP_URL_PATH);
    $from = static function (string $taxonomy, callable $href): array {
        $terms = get_terms(['taxonomy' => $taxonomy, 'hide_empty' => true, 'orderby' => 'name']);
        $out = [];
        foreach (is_array($terms) ? $terms : [] as $term) {
            $out[] = ['n' => html_entity_decode((string) $term->name, ENT_QUOTES | ENT_HTML5, 'UTF-8'), 'h' => $href($term), 'k' => (int) $term->count];
        }
        return $out;
    };
    return [
        'cat' => $from('product_cat', $path),
        'brand' => $from('product_brand', static fn ($term): string => '/brand/' . $term->slug . '/'),
        'team' => $from('pa_felag-lid', static fn ($term): string => '/verslun/?team=' . rawurlencode((string) $term->slug)),
        'sport' => $from('pa_ithrott', static fn ($term): string => '/verslun/?ithrott=' . rawurlencode((string) $term->slug)),
    ];
}

/** The backup menu (the one the last save or build replaced), or 0. */
function mos_menu_editor_backup_id(): int {
    $backup = wp_get_nav_menu_object(MOS_NAV_BACKUP_NAME);
    return $backup ? (int) $backup->term_id : 0;
}

/**
 * Rename a menu. Null when it is renamed, else the message WordPress gave. The filter mos_menu_editor_rename_error
 * (a WP_Error to refuse the rename) is the test seam for a refused rename.
 */
function mos_menu_editor_rename(int $menu_id, string $name): ?string {
    $refused = apply_filters('mos_menu_editor_rename_error', null, $menu_id, $name);
    if (is_wp_error($refused)) { return $refused->get_error_message(); }
    $renamed = wp_update_nav_menu_object($menu_id, ['menu-name' => $name]);
    return is_wp_error($renamed) ? $renamed->get_error_message() : null;
}

/**
 * Show the backup again and keep the menu it replaces as the backup, so a second switch undoes the first.
 * 'ok' when it is shown; 'nobackup' when there is no backup to show; 'failed' when a menu could not be renamed. A
 * failed switch puts back the names it had already moved, and the shown menu is never changed, so the storefront
 * keeps the menu it showed.
 */
function mos_menu_editor_restore(): string {
    $backup = mos_menu_editor_backup_id();
    $shown = mos_nav_shown_menu_id();
    if ($backup <= 0 || $backup === $shown) { return 'nobackup'; }
    // The names swap through a parked one: two menus cannot hold a name at once. Each step is [menu, new name, old name].
    $parked = MOS_NAV_BACKUP_NAME . ' ' . gmdate('Y-m-d H:i:s');
    $main = wp_get_nav_menu_object(MOS_NAV_MENU_NAME);
    $steps = [[$backup, $parked, MOS_NAV_BACKUP_NAME]];
    if ($main) { $steps[] = [(int) $main->term_id, MOS_NAV_BACKUP_NAME, MOS_NAV_MENU_NAME]; }
    $steps[] = [$backup, MOS_NAV_MENU_NAME, $parked];
    $done = [];
    foreach ($steps as [$id, $name, $was]) {
        $refused = mos_menu_editor_rename($id, $name);
        if ($refused !== null) {
            error_log(sprintf('[mos-menu] switch back: menu %d could not be renamed "%s": %s', $id, $name, $refused));
            foreach (array_reverse($done) as [$undo_id, $undo_name]) {
                $back = mos_menu_editor_rename($undo_id, $undo_name);
                if ($back !== null) { error_log(sprintf('[mos-menu] switch back: menu %d could not get its name "%s" back: %s', $undo_id, $undo_name, $back)); }
            }
            return 'failed';
        }
        $done[] = [$id, $was];
    }
    $locations = get_nav_menu_locations();
    $locations[MOS_NAV_LOCATION] = $backup;
    set_theme_mod('nav_menu_locations', $locations);
    foreach ([$backup, $shown] as $id) { if ($id > 0) { delete_transient("mos_menu_$id"); } }
    return 'ok';
}

const MOS_MENU_EDITOR_NOTICES = [
    'saved'    => ['success', 'Valmyndin var vistuð (%d atriði) og birtist í versluninni á nokkrum sekúndum. Fyrri útgáfa er geymd: „Afturkalla síðustu vistun“ sækir hana aftur.'],
    'restored' => ['success', 'Fyrri útgáfa valmyndarinnar er komin aftur í verslunina.'],
    'nobackup' => ['error', 'Engin fyrri útgáfa er til að sækja.'],
    'stale'    => ['error', 'Valmyndinni var breytt annars staðar á meðan þú varst að vinna. Ekkert var vistað; síðan sýnir nú nýjustu útgáfuna.'],
    'invalid'  => ['error', 'Valmyndin var ekki vistuð.'],
    'failed'   => ['error', 'Vistunin mistókst og valmyndin er óbreytt. Ástæðan er í villuskrá vefþjónsins.'],
    'saved_nobackup' => ['warning', 'Valmyndin var vistuð (%d atriði) og birtist í versluninni á nokkrum sekúndum. Fyrri útgáfan var ekki örugglega geymd, svo „Afturkalla síðustu vistun“ gæti ekki sótt hana. Ástæðan er í villuskrá vefþjónsins.'],
    'restore_failed' => ['error', 'Ekki tókst að sækja fyrri útgáfuna. Valmyndin í versluninni er óbreytt; reyndu aftur. Ef „Afturkalla síðustu vistun“ hverfur, er ástæðan í villuskrá vefþjónsins.'],
];

/** The reasons the last save of this user was refused; read once. */
function mos_menu_editor_take_errors(): array {
    $key = 'mos_menu_editor_errors_' . get_current_user_id();
    $errors = get_transient($key);
    if ($errors === false) { return []; }
    delete_transient($key);
    return is_array($errors) ? array_map('strval', $errors) : [];
}

function mos_menu_editor_guard(string $action): void {
    if (!current_user_can(MOS_MENU_EDITOR_CAP) || !mos_menu_editor_ready()) {
        wp_die('Þú hefur ekki réttindi til að breyta valmyndinni.', 'Valmynd', ['response' => 403]);
    }
    check_admin_referer($action);
}

function mos_menu_editor_handle_save(): void {
    mos_menu_editor_guard('mos_menu_editor_save');
    $user = get_current_user_id();
    $shown = mos_nav_shown_menu_id();
    // The menu the editor was opened with must still be the one shown, unchanged: a save writes the whole menu.
    $base = isset($_POST['mos_menu_editor_base']) ? sanitize_text_field(wp_unslash($_POST['mos_menu_editor_base'])) : '';
    if (!hash_equals($shown . ':' . ($shown > 0 ? mos_nav_menu_hash($shown) : ''), $base)) {
        wp_safe_redirect(mos_menu_editor_url('stale'));
        exit;
    }
    $raw = isset($_POST['mos_menu_editor_tree']) && is_string($_POST['mos_menu_editor_tree']) ? wp_unslash($_POST['mos_menu_editor_tree']) : '';
    $clean = mos_menu_editor_clean_tree(json_decode($raw, true));
    if ($clean['errors']) {
        set_transient('mos_menu_editor_errors_' . $user, $clean['errors'], MINUTE_IN_SECONDS);
        wp_safe_redirect(mos_menu_editor_url('invalid'));
        exit;
    }
    try {
        $r = mos_nav_write($clean['tree']);
        foreach ($r['warnings'] as $warning) { error_log('[mos-menu] ' . $warning); }
        error_log(sprintf('[mos-menu] saved by user %d: %d items (menu %d)', $user, $r['items'], $r['menu_id']));
        $to = mos_menu_editor_url(mos_menu_editor_saved_notice($r['warnings']), (int) $r['items']);
    } catch (\Throwable $e) {
        error_log(sprintf('[mos-menu] save by user %d failed: %s', $user, $e->getMessage()));
        $to = mos_menu_editor_url('failed');
    }
    wp_safe_redirect($to);
    exit;
}

function mos_menu_editor_handle_restore(): void {
    mos_menu_editor_guard('mos_menu_editor_restore');
    $result = mos_menu_editor_restore();
    error_log(sprintf('[mos-menu] switch back to the backup by user %d: %s', get_current_user_id(), match ($result) {
        'ok' => 'done',
        'nobackup' => 'nothing to switch to',
        default => 'failed (see the lines above)',
    }));
    wp_safe_redirect(mos_menu_editor_url(match ($result) {
        'ok' => 'restored',
        'nobackup' => 'nobackup',
        default => 'restore_failed',
    }));
    exit;
}

add_action('admin_post_mos_menu_editor_save', 'mos_menu_editor_handle_save');
add_action('admin_post_mos_menu_editor_restore', 'mos_menu_editor_handle_restore');

/* ------------------------------------------------------------------------
 * 3. wp-admin: the page
 * --------------------------------------------------------------------- */

function mos_menu_editor_register(): void {
    $parent = defined('MOS_SETTINGS_SLUG') ? MOS_SETTINGS_SLUG : 'mos-settings';
    add_submenu_page($parent, 'Valmynd', 'Valmynd', MOS_MENU_EDITOR_CAP, MOS_MENU_EDITOR_SLUG, 'mos_menu_editor_render');
}
add_action('admin_menu', 'mos_menu_editor_register', 15);

function mos_menu_editor_render(): void {
    if (!current_user_can(MOS_MENU_EDITOR_CAP)) { return; }
    echo '<div class="wrap mos-me"><h1>Valmynd</h1>';
    if (!mos_menu_editor_ready()) {
        echo '<div class="notice notice-error inline"><p>Valmyndarritillinn þarf mos-nav.php og mos-headless-api.php.</p></div></div>';
        return;
    }
    $notice = isset($_GET['mos_menu_editor']) ? sanitize_key(wp_unslash($_GET['mos_menu_editor'])) : '';
    if (isset(MOS_MENU_EDITOR_NOTICES[$notice])) {
        [$kind, $text] = MOS_MENU_EDITOR_NOTICES[$notice];
        $text = sprintf($text, absint(wp_unslash($_GET['mos_menu_editor_items'] ?? 0)));
        echo '<div class="notice notice-' . esc_attr($kind) . ' inline"><p>' . esc_html($text) . '</p>';
        $errors = $notice === 'invalid' ? mos_menu_editor_take_errors() : [];
        if ($errors) { echo '<ul>' . implode('', array_map(static fn (string $e): string => '<li>' . esc_html($e) . '</li>', $errors)) . '</ul>'; }
        echo '</div>';
    }
    $shown = mos_nav_shown_menu_id();
    $shop = function_exists('mos_settings_storefront_url') ? mos_settings_storefront_url() : home_url('/');
    $post = esc_url(admin_url('admin-post.php'));

    echo '<p class="mos-me__intro">Smelltu á flipa, dálk eða tengil í valmyndinni hér fyrir neðan til að breyta honum. '
        . 'Reitirnir opnast í spjaldinu við hliðina (fyrir neðan á litlum skjá) og breytingin sést strax hér; hún fer í verslunina þegar þú ýtir á „Vista valmynd“.</p>';
    echo '<form id="mos-me-form" method="post" action="' . $post . '">';
    echo '<input type="hidden" name="action" value="mos_menu_editor_save">';
    echo '<input type="hidden" name="mos_menu_editor_base" value="' . esc_attr($shown . ':' . ($shown > 0 ? mos_nav_menu_hash($shown) : '')) . '">';
    echo '<input type="hidden" name="mos_menu_editor_tree" id="mos-me-tree" value="">';
    wp_nonce_field('mos_menu_editor_save');
    echo '<div class="mos-me__bar"><span class="mos-me__status" id="mos-me-status" role="status"></span>';
    echo '<button type="button" class="button" id="mos-me-reset" disabled>Henda breytingum</button>';
    echo '<a class="button" href="' . esc_url($shop) . '" target="_blank" rel="noopener">Skoða verslun ↗</a>';
    echo '<button type="submit" class="button button-primary" id="mos-me-save" disabled>Vista valmynd</button></div></form>';

    echo '<div class="mos-me__grid"><div class="mos-me__main">'
        . '<div class="mos-me__search"><input type="search" id="mos-me-q" placeholder="Finna í valmyndinni…" aria-label="Finna í valmyndinni">'
        . '<div class="mos-me-hits" id="mos-me-hits" hidden></div></div>'
        . '<div class="mos-me-page"><div class="mos-me-page__head"><strong>Músík &amp; Sport</strong><span>Leit · Óskalisti · Karfa</span></div>'
        . '<div class="mos-me__tabs" id="mos-me-tabs"></div><div class="mos-me__cols" id="mos-me-cols"></div></div></div>'
        . '<aside class="mos-me__side" id="mos-me-side" aria-live="polite"></aside></div>';
    echo '<noscript><div class="notice notice-warning inline"><p>Valmyndarritillinn þarf JavaScript.</p></div></noscript>';

    echo '<div class="mos-me__more">';
    if (mos_menu_editor_backup_id() > 0) {
        echo '<form method="post" action="' . $post . '" onsubmit="return confirm(\'' . esc_js('Sækja útgáfuna sem var í versluninni fyrir síðustu vistun? Núverandi valmynd er geymd í staðinn.') . '\')">';
        echo '<input type="hidden" name="action" value="mos_menu_editor_restore">';
        wp_nonce_field('mos_menu_editor_restore');
        echo '<button class="button">Afturkalla síðustu vistun</button></form>';
    }
    if (function_exists('mos_nav_admin_url')) {
        echo '<a href="' . esc_url(mos_nav_admin_url('')) . '">Smíða valmyndina upp á nýtt úr vörulista…</a>';
    }
    echo '</div></div>';

    echo '<style>' . mos_menu_editor_css() . '</style>';
    echo '<script>window.MOS_MENU_EDITOR=' . wp_json_encode(['tree' => mos_menu_editor_tree(), 'src' => mos_menu_editor_sources(), 'maxTitle' => MOS_MENU_EDITOR_MAX_TITLE],
        JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE) . ';</script>';
    echo '<script>' . mos_menu_editor_script() . '</script>';
}

function mos_menu_editor_css(): string {
    return <<<'CSS'
.mos-me { --line: #dcdcde; --ink: #1d2327; --meta: #646970; --blue: #2271b1; --warn: #dba617; --orange: #f26a1b; max-width: 1280px; }
.mos-me__intro { max-width: 1164px; margin: 12px 0; padding: 12px 16px; border-left: 4px solid var(--blue); background: #fff; font-size: 14px; }
.mos-me button { cursor: pointer; }
.mos-me__bar { position: sticky; top: 32px; z-index: 20; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 12px 0 16px; padding: 10px 16px; background: #fff; border: 1px solid var(--line); border-radius: 8px; }
.mos-me__status { flex: 1; display: flex; align-items: center; gap: 8px; color: var(--meta); }
.mos-me__status::before { content: ""; flex: none; width: 8px; height: 8px; border-radius: 50%; background: #00a32a; }
.mos-me__status.is-dirty { color: var(--ink); font-weight: 600; }
.mos-me__status.is-dirty::before { background: var(--warn); }
.mos-me__status small { font-weight: 400; color: var(--meta); font-size: 13px; }
.mos-me__status small.mos-me-bad { color: #b32d2e; font-weight: 600; }
.mos-me__grid { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 24px; align-items: start; }
.mos-me__search { position: relative; margin-bottom: 12px; }
.mos-me__search input { width: 100%; max-width: none; }
.mos-me-hits { position: absolute; z-index: 30; left: 0; right: 0; top: 100%; max-height: 320px; overflow-y: auto; background: #fff; border: 1px solid var(--line); border-radius: 0 0 6px 6px; box-shadow: 0 8px 20px rgba(0, 0, 0, .12); }
.mos-me-hits button { display: block; width: 100%; text-align: left; border: 0; border-bottom: 1px solid #f0f0f1; background: #fff; padding: 7px 10px; }
.mos-me-hits button:hover, .mos-me-hits button:focus { background: #f0f6fc; }
.mos-me-hits small { display: block; color: var(--meta); }
.mos-me-page { overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.mos-me-page__head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #f0f0f1; }
.mos-me-page__head strong { font-size: 15px; letter-spacing: .02em; }
.mos-me-page__head span { color: var(--meta); font-size: 12px; }
.mos-me__tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; background: #111; padding: 6px 10px; }
.mos-me-tab { position: relative; color: #fff; background: none; border: 0; border-bottom: 2px solid transparent; padding: 7px 9px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
.mos-me-tab.is-open { border-bottom-color: var(--orange); }
.mos-me-tab.is-on, .mos-me-colhead.is-on, .mos-me-link.is-on { outline: 2px solid #72aee6; outline-offset: 1px; border-radius: 3px; }
.mos-me-tab:hover { background: rgba(255, 255, 255, .12); }
.mos-me__tabs .mos-me-ghost { color: #c3c4c7; border-color: #50575e; }
.mos-me__cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 16px 14px; padding: 16px; max-height: calc(100vh - 300px); min-height: 160px; overflow-y: auto; }
.mos-me-col { min-width: 0; }
.mos-me-colhead { display: block; width: 100%; margin: 0 0 6px; padding: 2px 2px 4px; border: 0; border-bottom: 1px solid var(--ink); background: none; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.mos-me-link { display: block; width: 100%; padding: 3px 2px; border: 0; background: none; text-align: left; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mos-me-colhead:hover, .mos-me-link:hover { background: #f0f6fc; }
.mos-me-ghost { border: 1px dashed #b5bcc2; background: none; color: var(--blue); border-radius: 6px; padding: 4px 10px; font-size: 12px; }
.mos-me-ghost:hover { border-color: var(--blue); background: #f0f6fc; }
.mos-me-col .mos-me-ghost { margin-top: 6px; }
.mos-me-none { margin: 0; color: var(--meta); }
.mos-me__side { position: sticky; top: 100px; padding: 18px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.mos-me__side h2 { margin: 0 0 4px; font-size: 16px; }
.mos-me__side > p { margin: 0 0 12px; color: var(--meta); }
.mos-me-path { margin: 0 0 12px; color: var(--meta); font-size: 12px; }
.mos-me-moves { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px; }
.mos-me__side label { display: block; font-weight: 600; margin: 12px 0 4px; }
.mos-me__side input[type=text], .mos-me__side input[type=search], .mos-me__side select { width: 100%; max-width: none; }
.mos-me-types { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.mos-me-types button { border: 1px solid var(--line); background: #fff; border-radius: 16px; padding: 4px 12px; }
.mos-me-types button.is-on { background: var(--blue); border-color: var(--blue); color: #fff; }
.mos-me-opts { margin: 8px 0 0; border: 1px solid var(--line); border-radius: 6px; max-height: 220px; overflow-y: auto; }
.mos-me-opt { display: flex; justify-content: space-between; gap: 8px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid #f6f7f7; background: #fff; padding: 7px 10px; }
.mos-me-opt:hover { background: #f6f7f7; }
.mos-me-opt.is-on { background: #f0f6fc; font-weight: 600; }
.mos-me-opt small { color: var(--meta); font-weight: 400; }
.mos-me-note { color: var(--meta); margin: 6px 0 0; }
.mos-me-note.mos-me-bad { color: #b32d2e; font-weight: 600; }
.mos-me-now { margin: 0 0 4px; padding: 8px 10px; background: #f6f7f7; border-radius: 6px; color: var(--meta); word-break: break-all; }
.mos-me-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 16px; padding-top: 12px; border-top: 1px solid #f0f0f1; }
.mos-me__more { display: flex; align-items: center; gap: 16px; margin-top: 20px; }
.mos-me__more form { margin: 0; }
@media (max-width: 1100px) { .mos-me__grid { grid-template-columns: minmax(0, 1fr); } .mos-me__side { position: static; } }
CSS;
}

/**
 * The editor. The menu lives in memory as [{id, t, h, c}] until "Vista valmynd" posts it as JSON; the server checks
 * all of it again (mos_menu_editor_clean_tree). On the left a copy of the shop's header: the flipar in a row and the
 * open flipi's dálkar and tenglar under it; clicking one selects it, and the side panel edits it in place (the copy
 * follows while typing). "+ Flipi / Dálkur / Tengill" in the copy open the side panel for a new item. Every text is
 * set with textContent.
 */
function mos_menu_editor_script(): string {
    return <<<'JS'
(function () {
  'use strict';
  var D = window.MOS_MENU_EDITOR, SRC = D.src, seq = 0;
  function adopt(nodes) { return nodes.map(function (n) { return { id: ++seq, t: n.t, h: n.h, c: adopt(n.c || []) }; }); }
  function strip(nodes) { return nodes.map(function (n) { return { t: n.t, h: n.h, c: strip(n.c) }; }); }
  var saved = JSON.stringify(D.tree);
  // sel: the chosen item; tab: the flipi whose dálkar show; add: {list, level, where} while adding.
  var S = { tree: adopt(D.tree), tab: null, sel: null, add: null, bad: false };
  S.tab = S.tree[0] ? S.tree[0].id : null;

  var $ = function (id) { return document.getElementById(id); };
  var tabs = $('mos-me-tabs'), cols = $('mos-me-cols'), side = $('mos-me-side'), status = $('mos-me-status');
  var form = $('mos-me-form'), saveBtn = $('mos-me-save'), resetBtn = $('mos-me-reset'), q = $('mos-me-q'), hits = $('mos-me-hits');
  var LEVELS = ['', 'Flipi', 'Dálkur', 'Tengill'];

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(cls, text, label, fn) {
    var b = el('button', cls, text); b.type = 'button'; if (label) { b.title = label; b.setAttribute('aria-label', label); }
    b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(ev); }); return b;
  }
  function count(nodes) { return nodes.reduce(function (n, x) { return n + 1 + count(x.c); }, 0); }
  function find(id, nodes, parent, level) {
    nodes = nodes || S.tree; level = level || 1;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return { node: nodes[i], list: nodes, index: i, parent: parent || null, level: level };
      var hit = find(id, nodes[i].c, nodes[i], level + 1); if (hit) return hit;
    }
    return null;
  }
  function tabOf(id) { var at = find(id); while (at && at.parent) at = find(at.parent.id); return at ? at.node.id : null; }
  function dirty() { return JSON.stringify(strip(S.tree)) !== saved; }

  var GENDER = { konur: 'Konur', karlar: 'Karlar', born: 'Börn' };
  function kind(h) {
    if (!h || h === '#') return 'Fyrirsögn';
    var m = /[?&]kyn=([a-z]+)/.exec(h), genderLabel = m && Object.prototype.hasOwnProperty.call(GENDER, m[1]) ? ' · ' + GENDER[m[1]] : '';
    if (/^(https?:|mailto:|tel:)/i.test(h)) return 'Ytri tengill';
    if (/[?&]team=/.test(h)) return 'Félagslið' + genderLabel;
    if (/[?&]ithrott=/.test(h)) return 'Íþrótt' + genderLabel;
    if (h.indexOf('/brand/') === 0) return 'Vörumerki' + genderLabel;
    if (h.indexOf('/voruflokkur/') === 0) return 'Vöruflokkur' + genderLabel;
    if (h.indexOf('/verslun/') === 0) return 'Verslun' + genderLabel;
    return 'Síða';
  }
  function genderOf(h) { var m = /[?&]kyn=([a-z]+)/.exec(h || ''); return m && Object.prototype.hasOwnProperty.call(GENDER, m[1]) ? m[1] : ''; }
  // Sets (or clears) ?kyn= on a shop address, before any #fragment so the shop sees it.
  function withGender(h, genderSlug) {
    var at = h.indexOf('#'), hash = at >= 0 ? h.slice(at) : '', path = at >= 0 ? h.slice(0, at) : h;
    var base = path.replace(/([?&])kyn=[a-z]+&?/, '$1').replace(/[?&]$/, '');
    return (genderSlug ? base + (base.indexOf('?') < 0 ? '?' : '&') + 'kyn=' + genderSlug : base) + hash;
  }
  // Only catalog picks take a kyn filter; an address of its own or a heading never does.
  function isSource(type) { return type === 'cat' || type === 'brand' || type === 'team' || type === 'sport'; }

  // The address rules of the save (mos_menu_editor_clean_href), so a bad one is caught while it is typed and a save is
  // not refused whole for it. The server still decides.
  function badHref(u) {
    u = u.trim();
    if (u === '' || u === '#') return false;
    if (new TextEncoder().encode(u).length > 2000 || /[\x00-\x1f\x7f\\]/.test(u) || u.indexOf('//') === 0) return true;
    var m = /^([a-z][a-z0-9+.\-]*):/i.exec(u.replace(/\s+/g, ''));
    if (!m) return false;
    var scheme = m[1].toLowerCase();
    if (scheme === 'mailto' || scheme === 'tel') return false;
    return !((scheme === 'http' || scheme === 'https') && /^https?:\/\/[^\/\s]+/i.test(u));
  }

  // ---- the copy of the shop header ----
  function renderCopy() {
    tabs.textContent = ''; cols.textContent = '';
    S.tree.forEach(function (tab) {
      var b = btn('mos-me-tab' + (tab.id === S.tab ? ' is-open' : '') + (tab.id === S.sel ? ' is-on' : ''), tab.t, '', function () { select(tab.id); });
      b.setAttribute('aria-pressed', String(tab.id === S.sel)); tabs.appendChild(b);
    });
    tabs.appendChild(btn('mos-me-ghost', '+ Flipi', 'Bæta við flipa', function () { startAdd(S.tree, 1, ''); }));
    var hit = S.tab && find(S.tab);
    if (!hit) { cols.appendChild(el('p', 'mos-me-none', 'Valmyndin er tóm. Byrjaðu á „+ Flipi“.')); return; }
    if (!hit.node.c.length) {
      var lone = el('div', 'mos-me-col');
      lone.appendChild(el('p', 'mos-me-none', '„' + hit.node.t + '“ opnar enga valmynd' + (hit.node.h !== '#' ? ': hann er beinn tengill.' : '.')));
      lone.appendChild(btn('mos-me-ghost', '+ Dálkur í „' + hit.node.t + '“', '', function () { startAdd(hit.node.c, 2, hit.node.t); }));
      cols.appendChild(lone); return;
    }
    hit.node.c.forEach(function (col) {
      var d = el('div', 'mos-me-col');
      var head = btn('mos-me-colhead' + (col.id === S.sel ? ' is-on' : ''), col.t, '', function () { select(col.id); });
      head.setAttribute('aria-pressed', String(col.id === S.sel)); d.appendChild(head);
      col.c.forEach(function (ln) {
        var a = btn('mos-me-link' + (ln.id === S.sel ? ' is-on' : ''), ln.t, '', function () { select(ln.id); });
        a.setAttribute('aria-pressed', String(ln.id === S.sel)); d.appendChild(a);
      });
      d.appendChild(btn('mos-me-ghost', '+ Tengill', 'Bæta við tengli í ' + col.t, function () { startAdd(col.c, 3, col.t); }));
      cols.appendChild(d);
    });
    var more = el('div', 'mos-me-col'); more.appendChild(btn('mos-me-ghost', '+ Dálkur', 'Bæta við dálki í ' + hit.node.t, function () { startAdd(hit.node.c, 2, hit.node.t); }));
    cols.appendChild(more);
  }

  function select(id) {
    var t = tabOf(id); if (t) S.tab = t;
    S.sel = id; S.add = null; render();
    if (window.matchMedia('(max-width: 1100px)').matches) side.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function startAdd(list, level, where) {
    S.add = { list: list, level: level, where: where }; S.sel = null; render();
    var f = side.querySelector('input'); if (f) f.focus();
  }
  function move(list, i, step) { var n = list.splice(i, 1)[0]; list.splice(i + step, 0, n); render(); }

  // ---- "where it leads": the same picker for a new item and for the chosen one ----
  var TYPES = [['cat', 'Vöruflokkur'], ['brand', 'Vörumerki'], ['team', 'Félagslið'], ['sport', 'Íþrótt'], ['url', 'Eigin slóð'], ['none', 'Fyrirsögn án tengils']];
  // st: {type, q, url, bad}; apply(href, name) is called with a finished address (and the picked name, for a new title);
  // changed() after the type changes or an address turns valid or invalid.
  function picker(box, st, apply, changed) {
    changed = changed || function () {};
    var types = el('div', 'mos-me-types'); box.appendChild(types);
    var area = el('div'); box.appendChild(area);
    function draw(focus) {
      types.textContent = ''; area.textContent = '';
      TYPES.forEach(function (t) { types.appendChild(btn(st.type === t[0] ? 'is-on' : '', t[1], '', function () { st.type = t[0]; st.q = ''; st.bad = false; if (t[0] === 'none') apply('#', ''); draw(true); changed(); })); });
      if (SRC[st.type]) {
        var s = el('input'); s.type = 'search'; s.placeholder = 'Leita…'; s.value = st.q; s.setAttribute('aria-label', 'Leita'); area.appendChild(s);
        var list = el('div', 'mos-me-opts'); area.appendChild(list);
        var fill = function () {
          list.textContent = '';
          var needle = st.q.toLowerCase();
          var found = SRC[st.type].filter(function (o) { return !needle || o.n.toLowerCase().indexOf(needle) >= 0; });
          found.slice(0, 80).forEach(function (o) {
            var b = btn('mos-me-opt', '', '', function () { apply(o.h, o.n); });
            b.appendChild(el('span', '', o.n)); b.appendChild(el('small', '', o.k + ' vörur')); list.appendChild(b);
          });
          if (!found.length) list.appendChild(el('p', 'mos-me-note', '  Ekkert fannst.'));
          else if (found.length > 80) list.appendChild(el('p', 'mos-me-note', '  ' + (found.length - 80) + ' til viðbótar: þrengdu leitina.'));
        };
        s.addEventListener('input', function () { st.q = s.value; fill(); }); fill();
        if (focus) s.focus();
      } else if (st.type === 'url') {
        var u = el('input'); u.type = 'text'; u.placeholder = '/skilmalar/ eða https://…'; u.value = st.url; u.setAttribute('aria-label', 'Slóð'); area.appendChild(u);
        var bad = el('p', 'mos-me-note mos-me-bad', 'Þessi slóð er ekki gild. Notaðu slóð sem byrjar á / eða heila slóð sem byrjar á https://.'); bad.setAttribute('role', 'alert');
        bad.hidden = !st.bad;
        u.addEventListener('input', function () {
          var was = st.bad;
          st.url = u.value; st.bad = badHref(u.value); bad.hidden = !st.bad;
          if (!st.bad) apply(u.value.trim() || '#', '');
          if (was !== st.bad) changed();
        });
        area.appendChild(el('p', 'mos-me-note', 'Slóð innan verslunarinnar byrjar á /. Heil slóð (https://…) leiðir út úr versluninni.'));
        area.appendChild(bad);
        if (focus) u.focus();
      } else if (st.type === 'none') {
        area.appendChild(el('p', 'mos-me-note', 'Fyrirsögn sést í valmyndinni en er ekki smellanleg, til dæmis „Vörumerki“ yfir dálki.'));
      }
    }
    draw(false);
  }
  function typeOf(h) {
    if (!h || h === '#') return 'none';
    var k = kind(h);
    if (k.indexOf('Félagslið') === 0) return 'team';
    if (k.indexOf('Íþrótt') === 0) return 'sport';
    if (k.indexOf('Vörumerki') === 0) return 'brand';
    if (k.indexOf('Vöruflokkur') === 0) return 'cat';
    return 'url';
  }
  function genderSelect(value, onChange) {
    var w = el('div'), l = el('label', '', 'Aðeins fyrir'), s = el('select'); s.id = 'mos-me-gender'; l.htmlFor = s.id;
    [['', 'Alla'], ['konur', 'Konur'], ['karlar', 'Karla'], ['born', 'Börn']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; s.appendChild(op); });
    s.value = value; s.addEventListener('change', function () { onChange(s.value); });
    w.appendChild(l); w.appendChild(s); return w;
  }

  // ---- the side panel ----
  function renderSide() {
    side.textContent = ''; S.bad = false;
    if (S.add) return renderAdd();
    var at = S.sel && find(S.sel);
    if (!at) {
      side.appendChild(el('h2', '', 'Veldu eitthvað til að breyta'));
      side.appendChild(el('p', '', 'Smelltu á flipa (svörtu línuna), dálk (feitletruðu fyrirsagnirnar) eða tengil í valmyndinni. „+“ bætir nýju við þar sem það á að vera.'));
      return;
    }
    var node = at.node, lvl = at.level;
    side.appendChild(el('h2', '', LEVELS[lvl] + ': ' + node.t));
    var path = [];
    for (var p = at; p && p.parent; p = find(p.parent.id)) path.unshift(p.parent.t);
    if (path.length) side.appendChild(el('p', 'mos-me-path', 'Í ' + path.join(' › ')));

    var moves = el('div', 'mos-me-moves'); side.appendChild(moves);
    var back = lvl === 3 ? '↑ Ofar' : '← Vinstri', fwd = lvl === 3 ? '↓ Neðar' : '→ Hægri';
    var b1 = btn('button', back, 'Færa ' + node.t + (lvl === 3 ? ' ofar' : ' til vinstri'), function () { move(at.list, at.index, -1); }); b1.disabled = at.index === 0; moves.appendChild(b1);
    var b2 = btn('button', fwd, 'Færa ' + node.t + (lvl === 3 ? ' neðar' : ' til hægri'), function () { move(at.list, at.index, 1); }); b2.disabled = at.index === at.list.length - 1; moves.appendChild(b2);

    var tl = el('label', '', 'Heiti í valmynd'), ti = el('input'); ti.type = 'text'; ti.maxLength = D.maxTitle; ti.value = node.t; ti.id = 'mos-me-title'; tl.htmlFor = ti.id;
    side.appendChild(tl); side.appendChild(ti);
    var empty = el('p', 'mos-me-note mos-me-bad', 'Heitið má ekki vera tómt; síðasta heiti er notað.'); empty.hidden = true; side.appendChild(empty);
    ti.addEventListener('input', function () {
      var v = ti.value.trim(); empty.hidden = v !== '';
      if (v) { node.t = v; side.querySelector('h2').textContent = LEVELS[lvl] + ': ' + v; renderCopy(); renderBar(); }
    });

    side.appendChild(el('label', '', 'Hvert leiðir þetta?'));
    var now = el('p', 'mos-me-now'); side.appendChild(now);
    function showNow() { now.textContent = ''; now.appendChild(el('strong', '', kind(node.h))); if (node.h !== '#') now.appendChild(document.createTextNode('  ' + node.h)); }
    showNow();
    var genderBox = el('div');
    function drawGender() {
      genderBox.textContent = '';
      var t = typeOf(node.h);
      if (t === 'cat' || t === 'brand' || t === 'team' || t === 'sport') genderBox.appendChild(genderSelect(genderOf(node.h), function (k) { node.h = withGender(node.h, k); showNow(); renderCopy(); renderBar(); }));
    }
    var st = { type: typeOf(node.h), q: '', url: typeOf(node.h) === 'url' ? node.h : '', bad: false };
    var pick = el('div'); side.appendChild(pick);
    picker(pick, st, function (h, name) {
      node.h = h === '#' || !isSource(st.type) ? h : withGender(h, genderOf(node.h));
      showNow(); drawGender(); renderCopy(); renderBar();
    }, function () { S.bad = st.type === 'url' && st.bad; renderBar(); });
    side.appendChild(genderBox); drawGender();

    // Where it sits: a tengill can move to another dálkur, a dálkur to another flipi.
    if (lvl > 1) {
      var homes = [];
      S.tree.forEach(function (tab) {
        if (lvl === 2) homes.push([tab, tab.t]);
        else tab.c.forEach(function (col) { homes.push([col, tab.t + ' › ' + col.t]); });
      });
      var pl = el('label', '', lvl === 2 ? 'Undir flipa' : 'Í dálki'), ps = el('select'); ps.id = 'mos-me-home'; pl.htmlFor = ps.id;
      homes.forEach(function (h, i) { var op = el('option', '', h[1]); op.value = String(i); ps.appendChild(op); if (h[0] === at.parent) ps.value = String(i); });
      ps.addEventListener('change', function () {
        var to = homes[+ps.value][0]; if (to === at.parent) return;
        at.list.splice(at.index, 1); to.c.push(node); select(node.id);
      });
      side.appendChild(pl); side.appendChild(ps);
    }

    var foot = el('div', 'mos-me-foot'); side.appendChild(foot);
    foot.appendChild(btn('button-link button-link-delete', 'Fjarlægja úr valmynd', '', function () {
      var kids = count(node.c);
      if (!window.confirm(kids ? '„' + node.t + '“ og ' + kids + ' atriði undir því fara úr valmyndinni. Halda áfram?' : 'Taka „' + node.t + '“ úr valmyndinni?')) return;
      at.list.splice(at.index, 1);
      if (S.tab === node.id) S.tab = S.tree[0] ? S.tree[0].id : null;
      S.sel = at.parent ? at.parent.id : null; render();
    }));
  }

  function renderAdd() {
    var a = S.add, st = { type: a.level < 3 ? 'none' : 'cat', q: '', url: '', bad: false }, chosen = { h: a.level < 3 ? '#' : null, gender: '' }, named = false;
    side.appendChild(el('h2', '', 'Nýr ' + LEVELS[a.level].toLowerCase() + (a.where ? ' í „' + a.where + '“' : '')));
    var tl = el('label', '', 'Heiti í valmynd'), ti = el('input'); ti.type = 'text'; ti.maxLength = D.maxTitle; ti.id = 'mos-me-title'; tl.htmlFor = ti.id;
    side.appendChild(tl); side.appendChild(ti);
    ti.addEventListener('input', function () { named = ti.value.trim() !== ''; });
    ti.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); ok.click(); } });
    side.appendChild(el('label', '', 'Hvert á þetta að leiða?'));
    var picked = el('p', 'mos-me-now'); side.appendChild(picked);
    function showPicked() { picked.textContent = chosen.h === null ? 'Ekkert valið enn: veldu úr listanum.' : kind(chosen.h) + (chosen.h !== '#' ? '  ' + chosen.h : ''); }
    showPicked();
    var pick = el('div'); side.appendChild(pick);
    var genderBox = el('div'), genderPicker = genderSelect('', function (k) { chosen.gender = k; }); genderBox.appendChild(genderPicker);
    function drawGender() { genderBox.hidden = !isSource(st.type); }
    picker(pick, st, function (h, name) { chosen.h = h; if (name && !named) ti.value = name; showPicked(); },
      function () { if (!isSource(st.type)) { chosen.h = st.type === 'none' ? '#' : (st.url.trim() && !st.bad ? st.url.trim() : null); showPicked(); } drawGender(); });
    side.appendChild(genderBox); drawGender();
    var foot = el('div', 'mos-me-foot'); side.appendChild(foot);
    foot.appendChild(btn('button', 'Hætta við', '', function () { S.add = null; render(); }));
    var ok = btn('button button-primary', 'Bæta við', '', function () {
      if (chosen.h === null) { var s = pick.querySelector('input'); if (s) s.focus(); return; }
      if (st.type === 'url' && st.bad) return;
      if (!ti.value.trim()) { ti.focus(); return; }
      var h = chosen.h === '#' || !isSource(st.type) ? chosen.h : withGender(chosen.h, chosen.gender);
      var n = { id: ++seq, t: ti.value.trim().slice(0, D.maxTitle), h: h, c: [] };
      a.list.push(n); if (a.level === 1) S.tab = n.id;
      select(n.id);
    });
    foot.appendChild(ok);
  }

  // ---- find ----
  function search() {
    var needle = q.value.trim().toLowerCase(); hits.textContent = '';
    if (!needle) { hits.hidden = true; return; }
    var found = [];
    (function walk(nodes, path) { nodes.forEach(function (n) { if (n.t.toLowerCase().indexOf(needle) >= 0) found.push([n, path]); walk(n.c, path.concat(n.t)); }); })(S.tree, []);
    found.slice(0, 40).forEach(function (f) {
      var b = btn('', '', '', function () { hits.hidden = true; q.value = ''; select(f[0].id); });
      b.appendChild(document.createTextNode(f[0].t)); if (f[1].length) b.appendChild(el('small', '', f[1].join(' › ')));
      hits.appendChild(b);
    });
    if (!found.length) hits.appendChild(el('p', 'mos-me-note', '  Ekkert í valmyndinni passar.'));
    hits.hidden = false;
  }
  q.addEventListener('input', search);
  q.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { q.value = ''; search(); } });
  document.addEventListener('click', function (ev) { if (!hits.hidden && !hits.contains(ev.target) && ev.target !== q) hits.hidden = true; });

  function renderBar() {
    var is = dirty();
    status.className = 'mos-me__status' + (is ? ' is-dirty' : '');
    status.textContent = is ? 'Óvistaðar breytingar' : 'Engar óvistaðar breytingar';
    status.appendChild(el('small', '', ' ·  ' + S.tree.length + ' flipar, ' + count(S.tree) + ' atriði alls'));
    if (S.bad) status.appendChild(el('small', 'mos-me-bad', ' · Lagaðu ógildu slóðina áður en þú vistar.'));
    saveBtn.disabled = !is || S.bad; resetBtn.disabled = !is;
  }
  function render() { renderCopy(); renderSide(); renderBar(); }

  resetBtn.addEventListener('click', function () {
    if (!window.confirm('Henda öllum óvistuðum breytingum?')) return;
    S.tree = adopt(JSON.parse(saved)); S.tab = S.tree[0] ? S.tree[0].id : null; S.sel = null; S.add = null; render();
  });
  var leaving = false;
  form.addEventListener('submit', function () {
    var tree = JSON.stringify(strip(S.tree));
    $('mos-me-tree').value = tree; leaving = true; saveBtn.disabled = true; saveBtn.textContent = 'Vista…';
    // Kept for this tab only, so a save the server refuses ('invalid', 'failed', 'stale') does not throw the edits away.
    try { sessionStorage.setItem('mos-menu-editor-unsaved', tree); } catch (e) {}
  });
  (function offerUnsaved() {
    var notice = new URLSearchParams(location.search).get('mos_menu_editor'), kept = null;
    var offered = notice === 'invalid' || notice === 'failed' || notice === 'stale';
    try { kept = sessionStorage.getItem('mos-menu-editor-unsaved'); if (!offered) sessionStorage.removeItem('mos-menu-editor-unsaved'); } catch (e) {}
    if (!kept || !offered) return;
    var box = el('div', 'notice notice-info inline'), p = el('p', '', 'Breytingarnar sem þú reyndir að vista eru geymdar í þessum glugga. '
      + (notice === 'stale' ? 'Ef þú sækir þær og vistar koma þær í stað nýju útgáfunnar. ' : ''));
    p.appendChild(btn('button', 'Sækja þær aftur', '', function () {
      try { S.tree = adopt(JSON.parse(kept)); sessionStorage.removeItem('mos-menu-editor-unsaved'); } catch (e) { return; }
      S.tab = S.tree[0] ? S.tree[0].id : null; S.sel = null; S.add = null; box.remove(); render();
    }));
    box.appendChild(p); form.parentNode.insertBefore(box, form);
  })();
  window.addEventListener('beforeunload', function (ev) { if (!leaving && dirty()) { ev.preventDefault(); ev.returnValue = ''; } });
  render();
})();
JS;
}
