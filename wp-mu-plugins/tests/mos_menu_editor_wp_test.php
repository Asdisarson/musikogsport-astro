<?php
/**
 * WordPress-level test for the owner's menu editor in ../mos-menu.php, against real menus:
 *  - a save is refused without the right, without a nonce, when the menu changed since the editor was opened, and
 *    when the tree is not valid (nothing changes in any of them, and the reasons are kept for the page);
 *  - a good save puts the menu in the primary location as sent (order, nesting, shop paths on this site, a full
 *    address as it is), keeps the menu it replaces as the one backup, and leaves a menu mos-nav will not rebuild unasked;
 *  - the editor reads back what was saved; "Afturkalla síðustu vistun" shows the backup again, and once more undoes that;
 *  - the page prints the form and the menu, and nothing without the right.
 *
 * It writes real menus and then puts the site back, the way mos_nav_wp_test.php does: the site's own "Aðalvalmynd
 * 2026" and its backup are parked under other names for the run, the menu that was shown is shown again, the menus
 * this run created are deleted.
 * Run (local site, after copying the plugins in): wp eval-file wp-mu-plugins/tests/mos_menu_editor_wp_test.php
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($ok || $detail === '' ? '' : " — $detail") . "\n";
    if (!$ok) { $fail++; }
};
if (!function_exists('mos_menu_editor_handle_save') || !mos_menu_editor_ready()) {
    echo "FAIL mos-menu.php (with mos-nav.php and mos-headless-api.php) is not installed in mu-plugins\n";
    return;
}

final class MosMenuEditorDie extends Exception {}
final class MosMenuEditorRedirect extends Exception {}

$menu_ids = static fn(): array => array_map('intval', wp_list_pluck(wp_get_nav_menus(), 'term_id'));
$shown = static fn(): int => mos_nav_shown_menu_id();
$named = static function (string $name): int { $m = wp_get_nav_menu_object($name); return $m ? (int) $m->term_id : 0; };
$state = static fn(): array => [$menu_ids(), $shown(), $shown() > 0 ? mos_nav_menu_hash($shown()) : ''];
$base = static fn(): string => $shown() . ':' . ($shown() > 0 ? mos_nav_menu_hash($shown()) : '');
$n = static fn (string $t, string $h = '#', array $c = []): array => ['t' => $t, 'h' => $h, 'c' => $c];

$before_ids = $menu_ids();
$before_locations = get_theme_mod('nav_menu_locations');
$before_built = get_option(MOS_NAV_BUILT_OPTION, null);
$parked = [];
foreach ([MOS_NAV_MENU_NAME, MOS_NAV_BACKUP_NAME] as $name) {
    $id = $named($name);
    if ($id > 0 && !is_wp_error(wp_update_nav_menu_object($id, ['menu-name' => "$name (mos_menu_editor_wp_test)"]))) { $parked[$id] = $name; }
}
if ($named(MOS_NAV_MENU_NAME) > 0 || $named(MOS_NAV_BACKUP_NAME) > 0) {
    foreach ($parked as $id => $name) { wp_update_nav_menu_object($id, ['menu-name' => $name]); }
    echo "FAIL could not park the site's own menus; nothing was saved\n";
    return;
}
$backup_user = get_current_user_id();
$die_handler = static fn() => static function ($message, $title = '', $args = []) {
    throw new MosMenuEditorDie(is_array($args) ? (string) ($args['response'] ?? '') : '');
};
$redirect = static function ($location) { throw new MosMenuEditorRedirect((string) $location); };
add_filter('wp_die_handler', $die_handler, PHP_INT_MAX);
add_filter('wp_redirect', $redirect, PHP_INT_MAX);
$post = static function (string $handler, array $fields) {
    $_POST = $_REQUEST = array_map('wp_slash', $fields);
    try { $handler(); return 'returned'; }
    catch (MosMenuEditorDie $e) { return 'die:' . $e->getMessage(); }
    catch (MosMenuEditorRedirect $e) { return $e->getMessage(); }
};

try {
    $admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
    $admin = (int) ($admins[0] ?? 0);
    $check('an administrator exists', $admin > 0);

    // The menu the editor opens with: a small one, as a build would write it.
    $first = mos_nav_write([['title' => 'Konur', 'href' => '/verslun/?kyn=konur', 'children' => []], ['title' => 'Útsala', 'href' => '/voruflokkur/sale/', 'children' => []]]);
    $check('setup: a menu is shown', $shown() === $first['menu_id']);
    $tree = [
        $n('Karlar', '/verslun/?kyn=karlar', [$n('Félagslið', '#', [$n('Liverpool', '/verslun/?kyn=karlar&team=liverpool'), $n('Arsenal', '/verslun/?team=arsenal')])]),
        $n('Konur', '/verslun/?kyn=konur'),
        $n('Instagram', 'https://www.instagram.com/musikogsport/'),
    ];
    $good = static fn(): array => ['mos_menu_editor_tree' => wp_json_encode($tree), 'mos_menu_editor_base' => $base(), '_wpnonce' => wp_create_nonce('mos_menu_editor_save')];

    // --- refused saves change nothing ---
    $was = $state();
    wp_set_current_user(0);
    $check('save: anonymous refused (403), nothing changed', $post('mos_menu_editor_handle_save', $good()) === 'die:403' && $state() === $was);
    wp_set_current_user($admin);
    $no_nonce = $good(); unset($no_nonce['_wpnonce']);
    $check('save: no nonce refused, nothing changed', str_starts_with($post('mos_menu_editor_handle_save', $no_nonce), 'die:') && $state() === $was);
    $stale = $good(); $stale['mos_menu_editor_base'] = $shown() . ':0000';
    $to = $post('mos_menu_editor_handle_save', $stale);
    $check('save: a menu changed since the editor opened is not overwritten', str_contains($to, 'mos_menu_editor=stale') && $state() === $was, $to);
    $bad = $good(); $bad['mos_menu_editor_tree'] = wp_json_encode([$n('Gott', '/a/'), $n('Hættulegt', 'javascript:alert(1)')]);
    $to = $post('mos_menu_editor_handle_save', $bad);
    $errors = mos_menu_editor_take_errors();
    $check('save: an invalid tree is refused, nothing changed', str_contains($to, 'mos_menu_editor=invalid') && $state() === $was, $to);
    $check('save: the reason names the item, and is read once', count($errors) === 1 && str_contains($errors[0], 'Hættulegt') && mos_menu_editor_take_errors() === [], json_encode($errors));
    $junk = $good(); $junk['mos_menu_editor_tree'] = '{not json';
    $check('save: junk is refused, nothing changed', str_contains($post('mos_menu_editor_handle_save', $junk), 'mos_menu_editor=invalid') && $state() === $was);
    mos_menu_editor_take_errors();

    // --- a good save ---
    $to = $post('mos_menu_editor_handle_save', $good());
    $check('save: redirects to the page with the count', str_contains($to, 'page=mos-menu') && str_contains($to, 'mos_menu_editor=saved') && str_contains($to, 'mos_menu_editor_items=6'), $to);
    $saved_id = $shown();
    $check('save: a new menu is shown under the main name', $saved_id !== $first['menu_id'] && $named(MOS_NAV_MENU_NAME) === $saved_id);
    $check('save: the menu it replaced is the one backup', $named(MOS_NAV_BACKUP_NAME) === $first['menu_id']);
    $items = wp_get_nav_menu_items($saved_id);
    $by_title = [];
    foreach ($items as $item) { $by_title[$item->title] = $item; }
    $check('save: order as sent', array_map(static fn ($i) => $i->title, $items) === ['Karlar', 'Félagslið', 'Liverpool', 'Arsenal', 'Konur', 'Instagram'], json_encode(wp_list_pluck($items, 'title')));
    $check('save: nesting as sent', (int) $by_title['Félagslið']->menu_item_parent === (int) $by_title['Karlar']->ID && (int) $by_title['Arsenal']->menu_item_parent === (int) $by_title['Félagslið']->ID
        && (int) $by_title['Konur']->menu_item_parent === 0);
    $check('save: a shop path is saved on this site', $by_title['Liverpool']->url === home_url('/verslun/?kyn=karlar&team=liverpool'), (string) $by_title['Liverpool']->url);
    $check('save: a heading and a full address as they are', $by_title['Félagslið']->url === '#' && $by_title['Instagram']->url === 'https://www.instagram.com/musikogsport/', $by_title['Instagram']->url);
    $check('save: the editor reads back what was saved', mos_menu_editor_tree() === $tree, wp_json_encode(mos_menu_editor_tree()));
    $check('save: the saved menu is the owner\'s (no rebuild unasked)', mos_nav_hand_edited() === true);
    $check('save: the storefront poke is asked for', has_action('shutdown', 'mos_menu_poke') !== false);

    // --- the switch back, and back again ---
    // A refused rename: the switch stops, the names it had moved go back, and the shown menu is untouched.
    $refuse = static function (callable $when): void {
        add_filter('mos_menu_editor_rename_error', static fn ($err, $id, $name) => $when((int) $id, (string) $name) ? new WP_Error('mos_test', 'refused for the test') : $err, 10, 3);
    };
    $undo = static fn (): string => $post('mos_menu_editor_handle_restore', ['_wpnonce' => wp_create_nonce('mos_menu_editor_restore')]);
    $names_ok = static fn (): bool => $shown() === $saved_id && $named(MOS_NAV_MENU_NAME) === $saved_id && $named(MOS_NAV_BACKUP_NAME) === $first['menu_id'];
    $refuse(static fn (int $id, string $name): bool => $id === $first['menu_id'] && str_starts_with($name, MOS_NAV_BACKUP_NAME . ' '));
    $was = $state();
    $to = $undo();
    remove_all_filters('mos_menu_editor_rename_error');
    $check('undo refused at the first rename: restore_failed, nothing moved', str_contains($to, 'mos_menu_editor=restore_failed') && $state() === $was && $names_ok(), $to);
    $refuse(static fn (int $id, string $name): bool => $id === $saved_id && $name === MOS_NAV_BACKUP_NAME);
    $to = $undo();
    remove_all_filters('mos_menu_editor_rename_error');
    $check('undo refused at the second rename: the first rename is put back', str_contains($to, 'mos_menu_editor=restore_failed') && $state() === $was && $names_ok(), $to);
    $refuse(static fn (int $id, string $name): bool => $id === $first['menu_id'] && $name === MOS_NAV_MENU_NAME);
    $to = $undo();
    remove_all_filters('mos_menu_editor_rename_error');
    $check('undo refused at the last rename: both renames are put back', str_contains($to, 'mos_menu_editor=restore_failed') && $state() === $was && $names_ok(), $to);

    $to = $post('mos_menu_editor_handle_restore', ['_wpnonce' => wp_create_nonce('mos_menu_editor_restore')]);
    $check('undo: the earlier menu is shown again under the main name', str_contains($to, 'mos_menu_editor=restored') && $shown() === $first['menu_id'] && $named(MOS_NAV_MENU_NAME) === $first['menu_id'], $to);
    $check('undo: the saved menu is now the backup', $named(MOS_NAV_BACKUP_NAME) === $saved_id);
    $check('undo: the editor shows the earlier menu', array_column(mos_menu_editor_tree(), 't') === ['Konur', 'Útsala']);
    $check('undo again: the saved menu is back', mos_menu_editor_restore() === 'ok' && $shown() === $saved_id && $named(MOS_NAV_BACKUP_NAME) === $first['menu_id']);
    wp_set_current_user(0);
    $was = $state();
    $check('undo: anonymous refused (403), nothing changed', $post('mos_menu_editor_handle_restore', ['_wpnonce' => wp_create_nonce('mos_menu_editor_restore')]) === 'die:403' && $state() === $was);
    wp_set_current_user($admin);
    wp_delete_nav_menu($named(MOS_NAV_BACKUP_NAME));
    $check('undo: with no backup there is nothing to switch to', str_contains($post('mos_menu_editor_handle_restore', ['_wpnonce' => wp_create_nonce('mos_menu_editor_restore')]), 'mos_menu_editor=nobackup') && $shown() === $saved_id);

    // --- the page ---
    $_GET = ['mos_menu_editor' => 'saved', 'mos_menu_editor_items' => '6'];
    ob_start();
    mos_menu_editor_render();
    $page = (string) ob_get_clean();
    $check('page: the form, its nonce and the menu', str_contains($page, 'value="mos_menu_editor_save"') && str_contains($page, 'name="_wpnonce"') && str_contains($page, 'window.MOS_MENU_EDITOR=') && str_contains($page, 'Liverpool'));
    $check('page: the copy of the shop header and the side panel', str_contains($page, 'id="mos-me-tabs"') && str_contains($page, 'id="mos-me-cols"') && str_contains($page, 'id="mos-me-side"'));
    $check('page: no separate list or pop-up any more', !str_contains($page, 'id="mos-me-rows"') && !str_contains($page, 'id="mos-me-modal"'));
    $check('page: the base it was opened with', str_contains($page, 'value="' . esc_attr($base()) . '"'));
    $check('page: the saved notice with the count', str_contains($page, 'notice-success') && str_contains($page, '(6 atriði)'));
    $check('page: no undo button without a backup', !str_contains($page, 'mos_menu_editor_restore'));
    $check('page: a script tag in a menu title cannot close the data', !preg_match('#window\.MOS_MENU_EDITOR=[^\n]*</script>[^\n]*</script>#', $page));
    $deny = static function ($caps) { $caps[MOS_MENU_EDITOR_CAP] = false; return $caps; };
    add_filter('user_has_cap', $deny);
    ob_start();
    mos_menu_editor_render();
    $check('page: nothing without the right', (string) ob_get_clean() === '');
    remove_filter('user_has_cap', $deny);
} catch (Throwable $e) {
    $check('no unexpected error', false, get_class($e) . ': ' . $e->getMessage() . ' @' . $e->getLine());
} finally {
    remove_filter('wp_die_handler', $die_handler, PHP_INT_MAX);
    remove_filter('wp_redirect', $redirect, PHP_INT_MAX);
    $_POST = $_REQUEST = $_GET = [];
    wp_set_current_user($backup_user);
    foreach (array_diff($menu_ids(), $before_ids) as $id) { wp_delete_nav_menu($id); }
    foreach ($parked as $id => $name) {
        if (is_wp_error(wp_update_nav_menu_object($id, ['menu-name' => $name]))) { $check("menu $id got its name \"$name\" back", false); }
    }
    $before_locations === false ? remove_theme_mod('nav_menu_locations') : set_theme_mod('nav_menu_locations', $before_locations);
    $before_built === null ? delete_option(MOS_NAV_BUILT_OPTION) : update_option(MOS_NAV_BUILT_OPTION, $before_built, false);
}

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
