<?php
/**
 * Build the "Aðalvalmynd" nav menu from live's mega-menu tree and assign menu locations.
 *
 *   wp eval-file wp-mu-plugins/seed/seed-live-menu.php /path/to/live-menu.json [topbar_menu_id] [footer_menu_id]
 *
 * On the May-3 data both ids are 158 ("Top bar", the five links live's footer shows). Menu 839
 * ("Footer (2)") is a stale four-item copy and must not be used for the footer.
 *
 * live-menu.json is a nested [{title, href, children}] tree parsed from live's header menu.
 * Items are created as custom links (headless: only the URL matters). An existing menu with the
 * same name is emptied and rebuilt, so the script is safe to re-run. Other menus are untouched.
 */

declare(strict_types=1);

if (!defined('ABSPATH') || !defined('WP_CLI')) { exit; }

// Destructive on re-run; production content is edited by hand. MOS_SEED_FORCE=1 overrides on purpose (MU-18).
if (wp_get_environment_type() === 'production' && getenv('MOS_SEED_FORCE') !== '1') {
    WP_CLI::error('Refusing to seed a production site. Set MOS_SEED_FORCE=1 to run it anyway.');
}

const MOS_SEED_MENU_NAME = 'Aðalvalmynd';

$tree = json_decode((string) file_get_contents($args[0] ?? ''), true);
if (!is_array($tree)) { WP_CLI::error('Pass the path to live-menu.json as the first argument.'); }
$topbar = (int) ($args[1] ?? 0);
$footer = (int) ($args[2] ?? 0);

$menu = wp_get_nav_menu_object(MOS_SEED_MENU_NAME);
if ($menu) {
    foreach ((array) wp_get_nav_menu_items($menu->term_id, ['post_status' => 'any']) as $item) {
        wp_delete_post($item->ID, true);
    }
    $menu_id = (int) $menu->term_id;
} else {
    $menu_id = (int) wp_create_nav_menu(MOS_SEED_MENU_NAME);
}

$created = 0;
$add = static function (array $items, int $parent) use (&$add, $menu_id, &$created): void {
    foreach ($items as $node) {
        $href = (string) ($node['href'] ?? '#');
        $url = ($href !== '' && $href[0] === '/') ? home_url($href) : $href;
        $id = wp_update_nav_menu_item($menu_id, 0, [
            'menu-item-title'     => trim(preg_replace('/\s+/u', ' ', (string) ($node['title'] ?? ''))),
            'menu-item-url'       => $url,
            'menu-item-type'      => 'custom',
            'menu-item-status'    => 'publish',
            'menu-item-parent-id' => $parent,
        ]);
        if (is_wp_error($id)) { WP_CLI::warning($id->get_error_message()); continue; }
        $created++;
        $add((array) ($node['children'] ?? []), (int) $id);
    }
};
$add($tree, 0);

$locations = get_nav_menu_locations();
$locations['primary'] = $menu_id;
if ($topbar > 0) { $locations['topbar'] = $topbar; }
if ($footer > 0) { $locations['footer'] = $footer; }
set_theme_mod('nav_menu_locations', $locations);
delete_transient('mos_menu_' . $menu_id);

WP_CLI::success("Menu '" . MOS_SEED_MENU_NAME . "' (id {$menu_id}) rebuilt with {$created} items; locations: " . wp_json_encode($locations));
