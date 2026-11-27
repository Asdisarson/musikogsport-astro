<?php
/**
 * WordPress-level test for ../mos-settings.php:
 *  - the page lists the front page's picture and text fields (not the footer, not hero button 2), every one an
 *    existing field of the ACF "Forsíða" group, so it writes nothing new;
 *  - the fields are grouped into zones (the parts of the page copy the owner clicks), each field in exactly one;
 *  - the fields are laid out the way the storefront's front page places them (src/lib/homeLayout.ts): the first banner
 *    with a picture on top (or the product slides when no banner has one), the other banners paired in order between
 *    the product rows, empty banners and unused slides after the footer;
 *  - "Stillingar" is registered as the first item of the admin sidebar, for those who can edit pages;
 *  - only someone who may edit the front page itself gets the form.
 *
 * Read-only apart from a one-minute transient the poke test sets and deletes: the admin-menu globals add_menu_page() writes are saved and put back, the users are in-memory WP_User
 * objects, nothing is saved.
 * Run (local site): wpms eval-file wp-mu-plugins/tests/mos_settings_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};

$check('plugin loaded', function_exists('mos_settings_field_keys') && function_exists('mos_settings_layout'));
if (!function_exists('mos_settings_layout')) { echo "1 FAILED\n"; return; }

// Field list: the front page's pictures and texts; the footer stays on the Forsíða screen, and the storefront shows
// only the first hero button (homeLayout.ts planHome), so button 2 stays there too.
$keys = mos_settings_field_keys(3, 8, 2);
$check('field count = logo + bar 2 + notice + hero texts 4 + 3 slides x 2 + 2 rows x 4 + 8 banners x 3', count($keys) === 46, (string) count($keys));
$check('no duplicates', count(array_unique($keys)) === count($keys));
$check('site counts used', mos_settings_field_keys(MOS_HERO_SLIDES, MOS_BANNER_SLOTS, MOS_PRODUCT_ROWS) === $keys);
$check('texts included', array_diff(['field_mos_campaign_text', 'field_mos_campaign_text_right', 'field_mos_store_notice',
    'field_mos_hero_heading', 'field_mos_hero_text', 'field_mos_hero_button_1_label', 'field_mos_hero_button_1_link',
    'field_mos_row_1_title', 'field_mos_row_2_source', 'field_mos_row_2_category', 'field_mos_row_1_count',
    'field_mos_banner_1_title', 'field_mos_banner_8_link'], $keys) === []);
$check('no footer, no second hero button', preg_grep('/footer|hero_button_2/', $keys) === []);

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

$a = mos_settings_layout($all, $slides_all, 2);
$check('all banners: banner 1 is the hero', $a['hero'] === 'banner' && $a['hero_banner'] === 1);
$check('all banners: front-page order', $names($a) === array_merge(
    ['site_logo', 'banner_1_image', '::row1', 'banner_2_image', 'banner_3_image', '::row2', 'banner_4_image',
     'banner_5_image', 'banner_6_image', 'banner_7_image', 'banner_8_image', '::footer'], $slide_fields), json_encode($names($a)));
$check('all banners: pairs are half width, the odd one out full width',
    $item($a, 'banner_2_image')[1] === 3 && $item($a, 'banner_8_image')[1] === 6 && $item($a, 'banner_1_image')[1] === 6);
$check('all banners: hero label', $item($a, 'banner_1_image')[2] === 'Borði 1 — forsíðumynd');
$check('all banners: slides marked as the fallback', $item($a, 'hero_slide_1_image')[2] === 'Glæra 1 — mynd (varaforsíða)');

$b = mos_settings_layout([1 => 'empty'] + $all, $slides_all, 2);
$check('banner 1 empty: banner 2 is the hero', $b['hero'] === 'banner' && $b['hero_banner'] === 2);
$check('banner 1 empty: the rest pair up in order', array_slice($names($b), 2, 4) === ['::row1', 'banner_3_image', 'banner_4_image', '::row2']);
$check('banner 1 empty: it waits after the footer', end($b['items'])[0] === 'banner_1_image' && end($b['items'])[2] === 'Borði 1 — tómur');

$c = mos_settings_layout(array_fill(1, 8, 'empty'), [1 => true, 2 => false, 3 => true], 2);
$check('no banner picture: the slides are the hero', $c['hero'] === 'slides');
$check('no banner picture: slides right under the header', array_slice($names($c), 1, 6) === $slide_fields);
$check('no banner picture: slide labels plain', $item($c, 'hero_slide_1_image')[2] === 'Glæra 1 — mynd');

$d = mos_settings_layout(array_fill(1, 8, 'text'), $slides_all, 2);
$check('title-only banners: slides are the hero, banners still tiles', $d['hero'] === 'slides'
    && array_slice($names($d), 7, 3) === ['::row1', 'banner_1_image', 'banner_2_image']);

$e = mos_settings_layout(array_fill(1, 8, 'empty'), [1 => false, 2 => false, 3 => false], 2);
$check('nothing set: no hero, slides after the footer', $e['hero'] === '' && $e['hero_banner'] === 0
    && array_slice($names($e), 0, 4) === ['site_logo', '::row1', '::row2', '::footer']);

$f = mos_settings_layout([1 => 'text', 2 => 'image'] + $all, $slides_all, 2);
$check('title-only banner before the first picture: still a tile, the picture is the hero',
    $f['hero_banner'] === 2 && array_slice($names($f), 2, 3) === ['::row1', 'banner_1_image', 'banner_3_image']);

$g = mos_settings_layout($all, [1 => true, 2 => true], 1);
$check('one product row: only ::row1', !in_array('::row2', $names($g), true));

// Zones: the parts of the page copy the owner clicks, in front-page order; each holds its fields.
$zone_ids = static fn(array $layout) => array_column(mos_settings_zones($layout), 'id');
$zone = static function (array $layout, string $id): ?array {
    foreach (mos_settings_zones($layout) as $z) { if ($z['id'] === $id) { return $z; } }
    return null;
};
$text_fields = ['hero_heading', 'hero_text', 'hero_button_1_label', 'hero_button_1_link'];
$check('zones, banner hero: front-page order, slides off the page', $zone_ids($a) === ['bar', 'header', 'hero', 'row1',
    'banner_2', 'banner_3', 'row2', 'banner_4', 'banner_5', 'banner_6', 'banner_7', 'banner_8', 'notice', 'fallback_slides'],
    json_encode($zone_ids($a)));
$check('zones: bar and notice hold the top texts', $zone($a, 'bar')['fields'] === ['campaign_text', 'campaign_text_right']
    && $zone($a, 'notice')['fields'] === ['store_notice']);
$check('zones: header holds the logo', $zone($a, 'header')['fields'] === ['site_logo']);
$check('zones, banner hero: the hero banner and the hero texts', $zone($a, 'hero')['mode'] === 'banner'
    && $zone($a, 'hero')['banner'] === 1
    && $zone($a, 'hero')['fields'] === array_merge(['banner_1_image', 'banner_1_title', 'banner_1_link'], $text_fields),
    json_encode($zone($a, 'hero')['fields']));
$check('zones: a banner tile holds picture, title and link, with its width', $zone($a, 'banner_2')['fields']
    === ['banner_2_image', 'banner_2_title', 'banner_2_link'] && $zone($a, 'banner_2')['span'] === 3
    && $zone($a, 'banner_8')['span'] === 6 && $zone($a, 'banner_2')['off'] === false);
$check('zones: a product row holds its four fields', $zone($a, 'row2')['fields']
    === ['row_2_title', 'row_2_source', 'row_2_category', 'row_2_count']);
$check('zones: unused slides are off the page', $zone($a, 'fallback_slides')['off'] === true
    && count($zone($a, 'fallback_slides')['fields']) === 6);
$check('zones, banner 1 empty: off the page', $zone($b, 'banner_1')['off'] === true && end($b['items'])[0] === 'banner_1_image'
    && $zone($b, 'hero')['banner'] === 2);
$check('zones, slides hero: slides and texts in the hero, no fallback zone', $zone($c, 'hero')['mode'] === 'slides'
    && array_slice($zone($c, 'hero')['fields'], -4) === $text_fields && count($zone($c, 'hero')['fields']) === 10
    && $zone($c, 'fallback_slides') === null);
$check('zones, nothing set: hero keeps its texts, slides off the page', $zone($e, 'hero')['mode'] === ''
    && $zone($e, 'hero')['fields'] === $text_fields && $zone($e, 'fallback_slides')['off'] === true);
$check('zones: every zone has a title and a hint', array_filter(mos_settings_zones($a),
    static fn($z) => $z['title'] === '' || $z['hint'] === '') === []);
$all_fields = array_map(static fn($k) => substr($k, strlen('field_mos_')), mos_settings_field_keys(MOS_HERO_SLIDES, MOS_BANNER_SLOTS, 2));
sort($all_fields);
foreach (['a' => $a, 'b' => $b, 'c' => $c, 'd' => $d, 'e' => $e, 'f' => $f] as $case => $layout) {
    $flat = array_merge(...array_column(mos_settings_zones($layout), 'fields'));
    $sorted = $flat; sort($sorted);
    $check("case {$case}: every field in exactly one zone", $sorted === $all_fields,
        json_encode(array_values(array_diff($all_fields, $flat))) . json_encode(array_diff_assoc($flat, array_unique($flat))));
}

// Plain labels for the fields as the owner sees them in the side panel.
$labels = mos_settings_field_labels();
$check('labels: plain names for the texts', ($labels['banner_3_title'] ?? '') === 'Titill á borða'
    && ($labels['banner_3_link'] ?? '') === 'Hvert borðinn vísar' && ($labels['hero_heading'] ?? '') === 'Fyrirsögn'
    && ($labels['campaign_text'] ?? '') === 'Vinstra megin' && ($labels['row_1_source'] ?? '') === 'Hvaða vörur');

// Without the script, each field says which banner, row or slide it belongs to.
$check('context: banner, row, slide, hero, bar, single fields', mos_settings_field_context('banner_7_link') === 'Borði 7'
    && mos_settings_field_context('row_2_count') === 'Vörulína 2' && mos_settings_field_context('hero_slide_3_image') === 'Glæra 3'
    && mos_settings_field_context('hero_heading') === 'Forsíðumynd' && mos_settings_field_context('campaign_text_right') === 'Appelsínugula línan'
    && mos_settings_field_context('site_logo') === '' && mos_settings_field_context('store_notice') === '');

// Saved message: honest about the wait, whatever the poke said.
foreach (['ok', 'late', ''] as $poke) {
    $check("saved message ({$poke}) says it can take up to 30 seconds",
        str_contains(mos_settings_saved_message($poke), 'allt að 30 sekúndur'), mos_settings_saved_message($poke));
}

// Old addresses (bookmarks, an older storefront editor bar) land on the renamed pages, other query args kept.
$check('old Stillingar address → mos-settings', mos_settings_renamed_url(['page' => 'mos-stillingar', 'updated' => 'true'])
    === admin_url('admin.php?page=mos-settings&updated=true'), mos_settings_renamed_url(['page' => 'mos-stillingar', 'updated' => 'true']));
$check('old Valmynd address → mos-menu', mos_settings_renamed_url(['page' => 'mos-valmynd'])
    === admin_url('admin.php?page=mos-menu'));
$check('other pages are left alone', mos_settings_renamed_url(['page' => 'woocommerce']) === ''
    && mos_settings_renamed_url([]) === '');

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
$check('hidden slides named', mos_settings_hidden_slides([1 => 10, 2 => 11, 3 => 0], [1 => true, 2 => false, 3 => false]) === [2]);

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
mos_settings_register_menu();
$entry = $GLOBALS['menu'][1] ?? null;
$check('menu at position 1 (above Mælaborð)', is_array($entry) && $entry[2] === MOS_SETTINGS_SLUG, json_encode($entry));
$check('menu title Stillingar', is_array($entry) && $entry[0] === 'Stillingar');
$check('menu capability edit_pages', is_array($entry) && $entry[1] === 'edit_pages');
foreach ($menu_globals as $g) { $GLOBALS[$g] = $saved[$g]; }

// Access.
$check('no front page → no form', mos_settings_can_edit(0) === false);
$front = mos_settings_front_page_id();
$check('front page id read', $front === (int) get_option('page_on_front'), (string) $front);
$customer = new WP_User(0);
$customer->allcaps = ['read' => true];
$GLOBALS['current_user'] = $customer;
$check('customer may not edit the front page', mos_settings_can_edit($front) === false);
$editor = new WP_User(0);
$editor->allcaps = ['read' => true, 'edit_pages' => true, 'edit_others_pages' => true, 'edit_published_pages' => true];
$GLOBALS['current_user'] = $editor;
$check('page editor may', $front > 0 && mos_settings_can_edit($front) === true);

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
    do_action('load-toplevel_page_' . MOS_SETTINGS_SLUG);
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
$check('missing front page → 0', mos_settings_front_page_id() === 0);
remove_filter('pre_option_page_on_front', $filter);

// The saved state is read like mos_rest_front_page() reads it.
$state = $front > 0 ? mos_settings_state($front) : null;
$check('state: 8 banners, 3 slides', $state !== null
    && count($state['banners']) === MOS_BANNER_SLOTS && count($state['shown']) === MOS_HERO_SLIDES);
$check('state: per slide the product, its name and its own photo for the copy', $state !== null
    && count($state['slides']) === MOS_HERO_SLIDES && array_diff_key($state['slides'][1], ['product' => 1, 'name' => 1, 'image' => 1]) === []
    && $state['slides'][1]['product'] === $state['products'][1]);
$check('state: banner kinds', $state !== null && array_diff($state['banners'], ['image', 'text', 'empty']) === []);
// Same banner list as the storefront gets: shown (image or title) exactly where the REST answer has a banner.
$rest = rest_get_server()->dispatch(new WP_REST_Request('GET', '/mos/v1/front-page'))->get_data();
$rest_kinds = [];
foreach (array_values($rest['banners'] ?? []) as $n => $banner) {
    $rest_kinds[$n + 1] = $banner === null ? 'empty' : (!empty($banner['image']) ? 'image' : 'text');
}
$check('state: banners match the REST answer', $state !== null && $rest_kinds === $state['banners'], json_encode($rest_kinds));

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
