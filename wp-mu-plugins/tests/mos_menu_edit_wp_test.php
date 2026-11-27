<?php
/**
 * WordPress-level test for the owner's menu edits in ../mos-headless-api.php: the menu route answers with the menu as
 * it is saved now after an item is added, renamed, moved and removed (its ten-minute cache is dropped by each), and
 * each of those asks for the storefront poke.
 *
 * It writes one menu of its own ("mos_menu_edit_wp_test"), in no location, and deletes it at the end.
 * Run (local site, after copying the plugin in): wp eval-file wp-mu-plugins/tests/mos_menu_edit_wp_test.php
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($ok || $detail === '' ? '' : " — $detail") . "\n";
    if (!$ok) { $fail++; }
};
$titles = static function (int $menu_id): array {
    $res = rest_do_request(new WP_REST_Request('GET', "/mos/v1/menu/$menu_id"));
    $walk = static function (array $items) use (&$walk): array {
        $out = [];
        foreach ($items as $i) { $out[] = $i['children'] ? [$i['title'] => $walk($i['children'])] : $i['title']; }
        return $out;
    };
    return $walk((array) ($res->get_data()['items'] ?? []));
};
$item = static fn (string $title, int $parent = 0, int $position = 0): array => [
    'menu-item-title' => $title, 'menu-item-url' => home_url('/verslun/'), 'menu-item-type' => 'custom', 'menu-item-status' => 'publish',
    'menu-item-parent-id' => $parent, 'menu-item-position' => $position,
];
$poked = static fn (): bool => has_action('shutdown', 'mos_menu_poke') !== false;
$unpoke = static function (): void { remove_action('shutdown', 'mos_menu_poke', 0); };

$old = wp_get_nav_menu_object('mos_menu_edit_wp_test');
if ($old) { wp_delete_nav_menu((int) $old->term_id); }
$menu = wp_create_nav_menu('mos_menu_edit_wp_test');
if (is_wp_error($menu)) { echo 'FAIL could not create the test menu: ' . $menu->get_error_message() . "\n"; return; }
$menu = (int) $menu;

try {
    $a = (int) wp_update_nav_menu_item($menu, 0, $item('Konur', 0, 1));
    $check('an added item shows', $titles($menu) === ['Konur'], json_encode($titles($menu)));
    $b = (int) wp_update_nav_menu_item($menu, 0, $item('Skór', 0, 2));
    $check('a second added item shows (the cached answer is dropped)', $titles($menu) === ['Konur', 'Skór'], json_encode($titles($menu)));
    wp_update_nav_menu_item($menu, $b, $item('Skór og sokkar', 0, 2));
    $check('a renamed item shows', $titles($menu) === ['Konur', 'Skór og sokkar'], json_encode($titles($menu)));
    wp_update_nav_menu_item($menu, $b, $item('Skór og sokkar', $a, 2));
    $check('an item moved under another shows', $titles($menu) === [['Konur' => ['Skór og sokkar']]], json_encode($titles($menu)));
    wp_update_nav_menu_item($menu, $b, $item('Skór og sokkar', 0, 1));
    wp_update_nav_menu_item($menu, $a, $item('Konur', 0, 2));
    $check('reordered items show', $titles($menu) === ['Skór og sokkar', 'Konur'], json_encode($titles($menu)));
    $unpoke();
    $c = (int) wp_update_nav_menu_item($menu, 0, $item('Útsala', 0, 3));
    $check('adding an item asks for the storefront poke', $poked());
    $titles($menu);   // cached with Útsala
    wp_delete_post($c, true);
    $check('a removed item is gone', $titles($menu) === ['Skór og sokkar', 'Konur'], json_encode($titles($menu)));
} catch (Throwable $e) {
    $check('no unexpected error', false, get_class($e) . ': ' . $e->getMessage());
} finally {
    wp_delete_nav_menu($menu);
}
$check('the test menu is gone', wp_get_nav_menu_object('mos_menu_edit_wp_test') === false);

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
