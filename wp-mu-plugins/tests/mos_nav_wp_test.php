<?php
/**
 * WordPress-level test for the rebuild in ../mos-nav.php (the same cases as mos_nav_write_test.php, against real menus):
 *  - a rebuild puts "Aðalvalmynd 2026" in the primary location and keeps the build it replaces as the one backup;
 *  - a second rebuild leaves exactly one backup;
 *  - the site's own menu (no build recorded, or edited by hand) is not replaced unless that is asked for; an untouched
 *    build is; an edit made with WordPress's own menu functions is seen;
 *  - the button: refused without manage_options and without a valid nonce (no menu changes), a good submit redirects
 *    to the Stillingar page with the rebuilt notice, a hand-edited menu needs the tick; the box is hidden without
 *    manage_options.
 *
 * It writes real menus and then puts the site back: the site's own "Aðalvalmynd 2026" and its backup are parked
 * under other names for the run (a rebuild would otherwise rotate them away), then get their names back; the menu
 * that was in the primary location is shown again, and the menus this run created are deleted.
 * Run (local site, after copying the plugin in): wp eval-file wp-mu-plugins/tests/mos_nav_wp_test.php
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($ok || $detail === '' ? '' : " — $detail") . "\n";
    if (!$ok) { $fail++; }
};

if (!function_exists('mos_nav_rebuild')) {
    echo "FAIL mos-nav.php (with mos_nav_rebuild) is not installed in mu-plugins\n";
    return;
}

final class MosNavDie extends Exception {}
final class MosNavRedirect extends Exception {}

$menu_ids = static fn(): array => array_map('intval', wp_list_pluck(wp_get_nav_menus(), 'term_id'));
$shown = static fn(): int => (int) (get_nav_menu_locations()[MOS_NAV_LOCATION] ?? 0);
$named = static function (string $name): int { $m = wp_get_nav_menu_object($name); return $m ? (int) $m->term_id : 0; };

$before_ids = $menu_ids();
$before_locations = get_theme_mod('nav_menu_locations');
$before_built = get_option(MOS_NAV_BUILT_OPTION, null);
// Park the site's own build and backup out of the rebuild's sight.
$parked = [];
foreach ([MOS_NAV_MENU_NAME, MOS_NAV_BACKUP_NAME] as $name) {
    $id = $named($name);
    if ($id > 0 && !is_wp_error(wp_update_nav_menu_object($id, ['menu-name' => "$name (mos_nav_wp_test)"]))) { $parked[$id] = $name; }
}
if ($named(MOS_NAV_MENU_NAME) > 0 || $named(MOS_NAV_BACKUP_NAME) > 0) {
    foreach ($parked as $id => $name) { wp_update_nav_menu_object($id, ['menu-name' => $name]); }
    echo "FAIL could not park the site's own menus; nothing was rebuilt\n";
    return;
}
$backup_user = get_current_user_id();
$die_handler = static fn() => static function ($message, $title = '', $args = []) {
    throw new MosNavDie(is_array($args) ? (string) ($args['response'] ?? '') : '');
};
$redirect = static function ($location) { throw new MosNavRedirect((string) $location); };
add_filter('wp_die_handler', $die_handler, PHP_INT_MAX);
add_filter('wp_redirect', $redirect, PHP_INT_MAX);

try {
    // --- the menu the site shows is not this run's build: it is left alone unless replacing it is asked for ---
    $state = static fn(): array => [$menu_ids(), $shown()];
    if ($shown() > 0) {
        $was = $state();
        try { mos_nav_rebuild(); $check('guard: the site\'s own menu is not replaced unasked', false, 'no exception'); }
        catch (MOS_Nav_Edited $e) { $check('guard: the site\'s own menu is not replaced unasked', $state() === $was); }
    }
    // --- rebuild twice ---
    $r1 = mos_nav_rebuild(null, true);
    $check('guard: a build as written is not hand-edited', mos_nav_hand_edited() === false);
    $check('rebuild: main menu shown', $shown() === $r1['menu_id'] && $named(MOS_NAV_MENU_NAME) === $r1['menu_id']);
    $check('rebuild: items written', $r1['items'] > 0 && count((array) wp_get_nav_menu_items($r1['menu_id'])) === $r1['items']);
    $check('rebuild: no warnings', $r1['warnings'] === [], implode('; ', $r1['warnings']));
    $check('rebuild: a first build has no backup', $r1['backup'] === '' && $named(MOS_NAV_BACKUP_NAME) === 0);
    $r2 = mos_nav_rebuild();
    $check('second rebuild: the first is the backup', $named(MOS_NAV_BACKUP_NAME) === $r1['menu_id'] && $r2['backup'] === MOS_NAV_BACKUP_NAME);
    $backups = array_filter(wp_get_nav_menus(), static fn ($m) => $m->name === MOS_NAV_BACKUP_NAME);
    $check('second rebuild: exactly one backup', count($backups) === 1);
    $check('second rebuild: main menu shown', $shown() === $r2['menu_id']);

    // --- a real edit: one item renamed the way the menu editor saves it ---
    $first = wp_get_nav_menu_items($r2['menu_id'])[0];
    wp_update_nav_menu_item($r2['menu_id'], (int) $first->ID, [
        'menu-item-title' => 'Dömur (próf)', 'menu-item-url' => $first->url, 'menu-item-type' => 'custom', 'menu-item-status' => 'publish',
        'menu-item-parent-id' => (int) $first->menu_item_parent, 'menu-item-position' => (int) $first->menu_order,
    ]);
    $check('guard: a renamed item is seen as a hand edit', mos_nav_hand_edited() === true);
    $was = $state();
    try { mos_nav_rebuild(); $check('guard: the edited menu is not replaced unasked', false, 'no exception'); }
    catch (MOS_Nav_Edited $e) { $check('guard: the edited menu is not replaced unasked', $state() === $was); }

    // --- the button ---
    $admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
    $admin = (int) ($admins[0] ?? 0);
    $check('an administrator exists', $admin > 0);
    $was = $state();
    wp_set_current_user(0);
    $_POST = $_REQUEST = [];
    try { mos_nav_handle_rebuild(); $check('button: anonymous refused', false, 'no die'); }
    catch (MosNavDie $e) { $check('button: anonymous refused (403), nothing changed', $e->getMessage() === '403' && $state() === $was, $e->getMessage()); }
    wp_set_current_user($admin);
    try { mos_nav_handle_rebuild(); $check('button: no nonce refused', false, 'no die'); }
    catch (MosNavDie $e) { $check('button: no nonce refused, nothing changed', $state() === $was); }
    catch (MosNavRedirect $e) { $check('button: no nonce refused', false, 'redirected'); }
    $_POST = $_REQUEST = ['_wpnonce' => wp_create_nonce('mos_nav_rebuild')];
    try { mos_nav_handle_rebuild(); $check('button: no tick on an edited menu redirects', false, 'no redirect'); }
    catch (MosNavRedirect $e) { $check('button: no tick on an edited menu -> refused, nothing changed', str_contains($e->getMessage(), 'mos_nav=refused') && $state() === $was, $e->getMessage()); }
    ob_start();
    mos_nav_admin_box();
    $edited_box = (string) ob_get_clean();
    $check('box: an edited menu says so, asks for the tick and links to its editor', str_contains($edited_box, 'Handbreytt') && str_contains($edited_box, 'name="mos_nav_discard"')
        && str_contains($edited_box, function_exists('mos_menu_editor_url') ? 'page=mos-menu' : 'menu=' . $shown()) && str_contains($edited_box, 'Breyta valmynd'));
    $_POST = $_REQUEST = ['_wpnonce' => wp_create_nonce('mos_nav_rebuild'), 'mos_nav_discard' => '1'];
    try { mos_nav_handle_rebuild(); $check('button: good submit redirects', false, 'no redirect'); }
    catch (MosNavRedirect $e) {
        $check('button: good submit -> rebuilt notice', str_contains($e->getMessage(), 'mos_nav=backup') && str_ends_with($e->getMessage(), '#menu'), $e->getMessage());
        $check('button: a new menu is shown', $shown() !== $was[1] && $named(MOS_NAV_MENU_NAME) === $shown());
    }

    // --- the box ---
    $_GET = ['mos_nav' => 'backup', 'mos_nav_items' => '12'];
    ob_start();
    mos_nav_admin_box();
    $box = (string) ob_get_clean();
    $check('box: button and notice for an administrator', str_contains($box, 'Smíða upp á nýtt') && str_contains($box, 'notice-success') && str_contains($box, '12'));
    $check('box: an untouched build asks for no tick', str_contains($box, 'Óbreytt') && !str_contains($box, 'mos_nav_discard'));
    $deny = static function ($caps) { $caps['manage_options'] = false; return $caps; };
    add_filter('user_has_cap', $deny);
    ob_start();
    mos_nav_admin_box();
    $check('box: hidden without manage_options', (string) ob_get_clean() === '');
    remove_filter('user_has_cap', $deny);
} catch (Throwable $e) {
    $check('no unexpected error', false, get_class($e) . ': ' . $e->getMessage());
} finally {
    remove_filter('wp_die_handler', $die_handler, PHP_INT_MAX);
    remove_filter('wp_redirect', $redirect, PHP_INT_MAX);
    $_POST = $_REQUEST = $_GET = [];
    wp_set_current_user($backup_user);
    // Put the site back: the menus this run made go, the parked ones get their names and the old one its place.
    foreach (array_diff($menu_ids(), $before_ids) as $id) { wp_delete_nav_menu($id); }
    foreach ($parked as $id => $name) {
        if (is_wp_error(wp_update_nav_menu_object($id, ['menu-name' => $name]))) { $check("menu $id got its name \"$name\" back", false); }
    }
    $before_locations === false ? remove_theme_mod('nav_menu_locations') : set_theme_mod('nav_menu_locations', $before_locations);
    $before_built === null ? delete_option(MOS_NAV_BUILT_OPTION) : update_option(MOS_NAV_BUILT_OPTION, $before_built, false);
}

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
