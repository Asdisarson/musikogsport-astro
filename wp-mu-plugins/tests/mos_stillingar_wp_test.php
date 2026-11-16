<?php
/**
 * WordPress-level test for ../mos-stillingar.php:
 *  - the page lists exactly the front-page picture fields (header logo, each hero slide's product + picture, the banner
 *    pictures), every one an existing field of the ACF "Forsíða" group, so it writes nothing new;
 *  - the fields are laid out the way the storefront's front page places them (src/lib/homeLayout.ts): the first banner
 *    with a picture on top (or the product slides when no banner has one), the other banners paired in order between
 *    the product rows, empty banners and unused slides after the footer;
 *  - "Stillingar" is registered as the first item of the admin sidebar, for those who can edit pages;
 *  - only someone who may edit the front page itself gets the form.
 *
 * Read-only apart from a one-minute transient the poke test sets and deletes: the admin-menu globals add_menu_page() writes are saved and put back, the users are in-memory WP_User
 * objects, nothing is saved.
 * Run (local site): wpms eval-file wp-mu-plugins/tests/mos_stillingar_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};

$check('plugin loaded', function_exists('mos_stillingar_field_keys') && function_exists('mos_stillingar_layout'));
if (!function_exists('mos_stillingar_layout')) { echo "1 FAILED\n"; return; }

// Field list.
$keys = mos_stillingar_field_keys(3, 8);
$check('field count = header logo + 3 slides x (product, picture) + 8 banners', count($keys) === 15, (string) count($keys));
$check('no duplicates', count(array_unique($keys)) === count($keys));
$check('site counts used', mos_stillingar_field_keys(MOS_HERO_SLIDES, MOS_BANNER_SLOTS) === $keys);

if (function_exists('acf_get_field')) {
    $foreign = [];
    foreach ($keys as $key) {
        $field = acf_get_field($key);
        if (!$field || ($field['parent'] ?? '') !== 'group_mos_forsida') { $foreign[] = $key; }
    }
    $check('every key is a Forsíða field', $foreign === [], implode(',', $foreign));
    // The storefront drops a slide whose product isn't published, so the picker offers published products only.
    $statuses = acf_get_field('field_mos_hero_slide_1_product')['post_status'] ?? null;
    $check('slide product picker lists published products only', $statuses === ['publish'], json_encode($statuses));
} else {
    $check('ACF active', false);
}

// Layout.
$names = static fn(array $layout) => array_map(static fn($item) => $item[0], $layout['items']);
$item = static function (array $layout, string $name): ?array {
    foreach ($layout['items'] as $it) { if ($it[0] === $name) { return $it; } }
    return null;
};
$all = array_fill(1, 8, 'image');
$slides_all = [1 => true, 2 => true, 3 => true];
$slide_fields = ['hero_slide_1_image', 'hero_slide_2_image', 'hero_slide_3_image',
                 'hero_slide_1_product', 'hero_slide_2_product', 'hero_slide_3_product'];

// Each grid row is filled exactly (6 columns), so nothing leaves a hole.
$fills_rows = static function (array $layout): bool {
    $col = 0;
    foreach ($layout['items'] as $it) {
        $col += $it[1];
        if ($col > 6) { return false; }
        if ($col === 6) { $col = 0; }
    }
    return $col === 0;
};

$a = mos_stillingar_layout($all, $slides_all, 2);
$check('all banners: banner 1 is the hero', $a['hero'] === 'banner' && $a['hero_banner'] === 1);
$check('all banners: front-page order', $names($a) === array_merge(
    ['site_logo', 'banner_1_image', '::row1', 'banner_2_image', 'banner_3_image', '::row2', 'banner_4_image',
     'banner_5_image', 'banner_6_image', 'banner_7_image', 'banner_8_image', '::footer'], $slide_fields), json_encode($names($a)));
$check('all banners: pairs are half width, the odd one out full width',
    $item($a, 'banner_2_image')[1] === 3 && $item($a, 'banner_8_image')[1] === 6 && $item($a, 'banner_1_image')[1] === 6);
$check('all banners: hero label', $item($a, 'banner_1_image')[2] === 'Borði 1 — forsíðumynd');
$check('all banners: slides marked as the fallback', $item($a, 'hero_slide_1_image')[2] === 'Glæra 1 — mynd (varaforsíða)');

$b = mos_stillingar_layout([1 => 'empty'] + $all, $slides_all, 2);
$check('banner 1 empty: banner 2 is the hero', $b['hero'] === 'banner' && $b['hero_banner'] === 2);
$check('banner 1 empty: the rest pair up in order', array_slice($names($b), 2, 4) === ['::row1', 'banner_3_image', 'banner_4_image', '::row2']);
$check('banner 1 empty: it waits after the footer', end($b['items'])[0] === 'banner_1_image' && end($b['items'])[2] === 'Borði 1 — tómur');

$c = mos_stillingar_layout(array_fill(1, 8, 'empty'), [1 => true, 2 => false, 3 => true], 2);
$check('no banner picture: the slides are the hero', $c['hero'] === 'slides');
$check('no banner picture: slides right under the header', array_slice($names($c), 1, 6) === $slide_fields);
$check('no banner picture: slide labels plain', $item($c, 'hero_slide_1_image')[2] === 'Glæra 1 — mynd');

$d = mos_stillingar_layout(array_fill(1, 8, 'text'), $slides_all, 2);
$check('title-only banners: slides are the hero, banners still tiles', $d['hero'] === 'slides'
    && array_slice($names($d), 7, 3) === ['::row1', 'banner_1_image', 'banner_2_image']);

$e = mos_stillingar_layout(array_fill(1, 8, 'empty'), [1 => false, 2 => false, 3 => false], 2);
$check('nothing set: no hero, slides after the footer', $e['hero'] === '' && $e['hero_banner'] === 0
    && array_slice($names($e), 0, 4) === ['site_logo', '::row1', '::row2', '::footer']);

$f = mos_stillingar_layout([1 => 'text', 2 => 'image'] + $all, $slides_all, 2);
$check('title-only banner before the first picture: still a tile, the picture is the hero',
    $f['hero_banner'] === 2 && array_slice($names($f), 2, 3) === ['::row1', 'banner_1_image', 'banner_3_image']);

$g = mos_stillingar_layout($all, [1 => true, 2 => true], 1);
$check('one product row: only ::row1', !in_array('::row2', $names($g), true));

// Sections: the layout grouped the way the page shows it.
$ids = static fn(array $layout) => array_column(mos_stillingar_sections($layout), 'id');
$section = static function (array $layout, string $id): ?array {
    foreach (mos_stillingar_sections($layout) as $sec) { if ($sec['id'] === $id) { return $sec; } }
    return null;
};
$sec_names = static fn(?array $sec) => $sec === null ? [] : array_column($sec['items'], 0);
$check('sections, banner hero: haus, forsíðumynd, borðar, varaforsíða',
    $ids($a) === ['haus', 'forsidumynd', 'bordar', 'varaforsida'], json_encode($ids($a)));
$check('sections: the hero banner alone is the forsíðumynd', $sec_names($section($a, 'forsidumynd')) === ['banner_1_image']);
$check('sections: borðar keeps the product rows in place', array_slice($sec_names($section($a, 'bordar')), 0, 4)
    === ['::row1', 'banner_2_image', 'banner_3_image', '::row2']);
$check('sections: unused slides folded away', $section($a, 'varaforsida')['folded'] === true
    && $sec_names($section($a, 'varaforsida')) === $slide_fields);
$check('sections: the heading replaces the label suffixes', $section($a, 'forsidumynd')['items'][0][2] === 'Borði 1'
    && $section($a, 'varaforsida')['items'][0][2] === 'Glæra 1 — mynd');
$check('sections, banner 1 empty: it is listed under tómir borðar', $sec_names($section($b, 'tomir')) === ['banner_1_image']
    && $section($b, 'tomir')['items'][0][2] === 'Borði 1');
$check('sections, slides hero: the slides are the forsíðumynd, nothing folded',
    $sec_names($section($c, 'forsidumynd')) === $slide_fields && $section($c, 'varaforsida') === null);
$check('sections, nothing set: no forsíðumynd section', !in_array('forsidumynd', $ids($e), true)
    && $sec_names($section($e, 'bordar')) === ['::row1', '::row2']);
foreach (['a' => $a, 'b' => $b, 'c' => $c, 'd' => $d, 'e' => $e, 'f' => $f, 'g' => $g] as $case => $layout) {
    $flat = [];
    foreach (mos_stillingar_sections($layout) as $sec) { foreach ($sec['items'] as $it) { $flat[] = $it[0]; } }
    $check("case {$case}: every layout item but the footer mark is in exactly one section",
        $flat === array_values(array_diff($names($layout), ['::footer'])));
}

// Saving the front page pokes the storefront; another post, or no storefront address, does not.
$poked = [];
$http = static function ($pre, $args, $url) use (&$poked) {
    $poked[] = $url;
    return ['response' => ['code' => 204, 'message' => 'No Content'], 'body' => '', 'headers' => [], 'cookies' => []];
};
add_filter('pre_http_request', $http, 10, 3);
$front_id = (int) get_option('page_on_front');
$base = function_exists('mos_headless_target_base') ? mos_headless_target_base() : '';
mos_front_page_saved($front_id + 999999);
$check('poke: not for another post', $poked === []);
mos_front_page_saved($front_id);
if ($base !== '') {
    $check('poke: the storefront is told when the front page is saved', $poked === [$base . '/api/content-refresh'], json_encode($poked));
    $check('poke: the outcome is kept for the next screen, once', mos_front_page_poke_result() === 'ok' && mos_front_page_poke_result() === '');
} else {
    $check('poke: no storefront address, no call', $poked === [] && mos_front_page_poke_result() === 'late');
}
remove_filter('pre_http_request', $http, 10);
$down = static fn() => new WP_Error('http_request_failed', 'down');
add_filter('pre_http_request', $down);
mos_front_page_saved($front_id);
$check('poke: an unreachable storefront reads as late', mos_front_page_poke_result() === 'late');
remove_filter('pre_http_request', $down);

foreach (['a' => $a, 'b' => $b, 'c' => $c, 'd' => $d, 'e' => $e, 'f' => $f, 'g' => $g] as $case => $layout) {
    $check("case {$case}: every grid row filled exactly", $fills_rows($layout), json_encode(array_column($layout['items'], 1)));
}

// Slides the storefront would leave out (product set, but not shown).
$check('hidden slides named', mos_stillingar_hidden_slides([1 => 10, 2 => 11, 3 => 0], [1 => true, 2 => false, 3 => false]) === [2]);

// Sidebar entry.
require_once ABSPATH . 'wp-admin/includes/plugin.php';
$menu_globals = ['menu', 'submenu', 'admin_page_hooks', '_registered_pages', '_parent_pages'];
$saved = [];
foreach ($menu_globals as $g) { $saved[$g] = $GLOBALS[$g] ?? null; }
$GLOBALS['menu'] = []; $GLOBALS['submenu'] = [];
$admin = new WP_User(0);
$admin->allcaps = ['edit_pages' => true, 'read' => true];
wp_set_current_user(0);
$GLOBALS['current_user'] = $admin;
mos_stillingar_register_menu();
$entry = $GLOBALS['menu'][1] ?? null;
$check('menu at position 1 (above Mælaborð)', is_array($entry) && $entry[2] === MOS_STILLINGAR_SLUG, json_encode($entry));
$check('menu title Stillingar', is_array($entry) && $entry[0] === 'Stillingar');
$check('menu capability edit_pages', is_array($entry) && $entry[1] === 'edit_pages');
foreach ($menu_globals as $g) { $GLOBALS[$g] = $saved[$g]; }

// Access.
$check('no front page → no form', mos_stillingar_can_edit(0) === false);
$front = mos_stillingar_front_page_id();
$check('front page id read', $front === (int) get_option('page_on_front'), (string) $front);
$customer = new WP_User(0);
$customer->allcaps = ['read' => true];
$GLOBALS['current_user'] = $customer;
$check('customer may not edit the front page', mos_stillingar_can_edit($front) === false);
$editor = new WP_User(0);
$editor->allcaps = ['read' => true, 'edit_pages' => true, 'edit_others_pages' => true, 'edit_published_pages' => true];
$GLOBALS['current_user'] = $editor;
$check('page editor may', $front > 0 && mos_stillingar_can_edit($front) === true);

// The page's load hook (where ACF saves) refuses someone who may not edit the front page, before any save.
$die = static function () { return static function ($message, $title, $args) {
    throw new RuntimeException('wp_die ' . (int) ($args['response'] ?? 0));
}; };
add_filter('wp_die_handler', $die);
$author = new WP_User(0);
$author->allcaps = ['read' => true, 'edit_pages' => true]; // sees the menu, may not edit others' published pages
$GLOBALS['current_user'] = $author;
$saved_post = $_POST;
$_POST = ['_acf_form' => 'x', '_acf_nonce' => 'x', 'acf' => ['field_mos_banner_1_image' => '1']];
try {
    do_action('load-toplevel_page_' . MOS_STILLINGAR_SLUG);
    $died = '';
} catch (RuntimeException $e) {
    $died = $e->getMessage();
}
$_POST = $saved_post;
remove_filter('wp_die_handler', $die);
$check('load hook: 403 for someone who may not edit the front page', $died === 'wp_die 403', $died);
wp_set_current_user(0);

// Front page = page_on_front (what the storefront reads), unless that page is gone.
$filter = static fn() => 999999999; // no such post
add_filter('pre_option_page_on_front', $filter);
$check('missing front page → 0', mos_stillingar_front_page_id() === 0);
remove_filter('pre_option_page_on_front', $filter);

// The saved state is read like mos_rest_front_page() reads it.
$state = $front > 0 ? mos_stillingar_state($front) : null;
$check('state: 8 banners, 3 slides', $state !== null
    && count($state['banners']) === MOS_BANNER_SLOTS && count($state['shown']) === MOS_HERO_SLIDES);
$check('state: banner kinds', $state !== null && array_diff($state['banners'], ['image', 'text', 'empty']) === []);
// Same banner list as the storefront gets: shown (image or title) exactly where the REST answer has a banner.
$rest = rest_get_server()->dispatch(new WP_REST_Request('GET', '/mos/v1/front-page'))->get_data();
$rest_kinds = [];
foreach (array_values($rest['banners'] ?? []) as $n => $banner) {
    $rest_kinds[$n + 1] = $banner === null ? 'empty' : (!empty($banner['image']) ? 'image' : 'text');
}
$check('state: banners match the REST answer', $state !== null && $rest_kinds === $state['banners'], json_encode($rest_kinds));

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
