<?php
/**
 * Plugin Name: MOS Settings
 * Description: "Stillingar", the first item of the admin sidebar: the front page's pictures and texts on one screen.
 *  On the left a small copy of the storefront's front page, drawn from the zones (mos_settings_zones: the orange bar,
 *  the header logo, the hero, the product rows, the banner tiles, the grey notice — in the order the storefront places
 *  them, src/lib/homeLayout.ts); clicking a zone shows its fields on the right, beside the save button. It shows the
 *  existing ACF "Forsíða" fields (mos-headless-api.php) for the front page, so it stores nothing of its own; saving pokes
 *  the storefront (mos_front_page_poke). The footer and hero button 2 stay on the Forsíða edit screen.
 * Author: Músík og Sport
 * Version: 2.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_SETTINGS_SLUG = 'mos-settings';
/** Product rows the layout places (the storefront shows MOS_PRODUCT_ROWS; this caps the copy). */
const MOS_SETTINGS_ROW_STANDINS = 2;
/** Admin pages renamed to English slugs => their new slug; the old addresses redirect (mos_settings_renamed_url). */
const MOS_SETTINGS_RENAMED_PAGES = ['mos-stillingar' => MOS_SETTINGS_SLUG, 'mos-valmynd' => 'mos-menu'];
/** What the owner is told after a save, and under the save button. */
const MOS_SETTINGS_WAIT_NOTE = 'Það getur tekið allt að 30 sekúndur fyrir myndirnar og textana að birtast á forsíðunni.';

/**
 * The Forsíða field keys the page shows: the orange bar and grey notice, the header logo, the hero texts and button 1,
 * each hero slide's product and picture, each product row, each banner's picture, title and link. Not the footer, and
 * not hero button 2 (the storefront shows one button, homeLayout.ts planHome): those stay on the Forsíða screen.
 *
 * @return list<string>
 */
function mos_settings_field_keys(int $slides, int $banners, int $rows): array {
    $names = ['campaign_text', 'campaign_text_right', 'store_notice', 'site_logo',
              'hero_heading', 'hero_text', 'hero_button_1_label', 'hero_button_1_link'];
    for ($i = 1; $i <= $slides; $i++) { array_push($names, "hero_slide_{$i}_product", "hero_slide_{$i}_image"); }
    for ($i = 1; $i <= $rows; $i++) { array_push($names, "row_{$i}_title", "row_{$i}_source", "row_{$i}_category", "row_{$i}_count"); }
    for ($i = 1; $i <= $banners; $i++) { array_push($names, "banner_{$i}_image", "banner_{$i}_title", "banner_{$i}_link"); }
    return array_map(static fn(string $name) => 'field_mos_' . $name, $names);
}

/**
 * The page's fields in screen order, placed the way the storefront's front page places them (src/lib/homeLayout.ts
 * planHome + homeSections, src/pages/index.astro): header logo; the hero — the first banner with a picture, or the
 * product slides when no banner has one; then product row, banner pair, product row, banner pair, … (the other
 * shown banners paired in order, an odd one out full width); `::footer` marks the page's end. After the footer: the slides when they
 * are not the hero, then the empty banners, so they can be filled.
 *
 * Each item is [field name, columns of 6, label or null to keep the Forsíða label]; `::row<N>` is product row N
 * (at most MOS_SETTINGS_ROW_STANDINS). Every grid row is filled exactly: pairs take half, an odd one out the whole
 * row, the slides a share each.
 *
 * @param array<int, 'image'|'text'|'empty'> $banners banner number => picture / title only / nothing (= not shown)
 * @param array<int, bool> $shown slide number => the storefront would show it (published product, has a picture)
 * @return array{hero: ''|'banner'|'slides', hero_banner: int, items: list<array{0: string, 1: int, 2: ?string}>}
 */
function mos_settings_layout(array $banners, array $shown, int $rows): array {
    $hero_banner = 0;
    foreach ($banners as $i => $kind) {
        if ($kind === 'image') { $hero_banner = (int) $i; break; }
    }
    $hero = $hero_banner > 0 ? 'banner' : (in_array(true, $shown, true) ? 'slides' : '');

    $slides = static function (bool $fallback) use ($shown): array {
        $suffix = $fallback ? ' (varaforsíða)' : '';
        $span = mos_settings_share(count($shown));
        $items = [];
        foreach (array_keys($shown) as $i) { $items[] = ["hero_slide_{$i}_image", $span, "Glæra {$i} — mynd{$suffix}"]; }
        foreach (array_keys($shown) as $i) { $items[] = ["hero_slide_{$i}_product", $span, "Glæra {$i} — vara"]; }
        return $items;
    };
    $paired = static function (array $numbers, string $suffix): array {
        $items = [];
        foreach (array_chunk($numbers, 2) as $pair) {
            foreach ($pair as $i) { $items[] = ["banner_{$i}_image", count($pair) === 2 ? 3 : 6, "Borði {$i}{$suffix}"]; }
        }
        return $items;
    };

    $items = [['site_logo', 6, null]];
    if ($hero === 'slides') {
        array_push($items, ...$slides(false));
    } elseif ($hero === 'banner') {
        $items[] = ["banner_{$hero_banner}_image", 6, "Borði {$hero_banner} — forsíðumynd"];
    }

    $tiles = $empty = [];
    foreach ($banners as $i => $kind) {
        if ($kind === 'empty') { $empty[] = $i; } elseif ($i !== $hero_banner) { $tiles[] = $i; }
    }
    $stories = array_chunk($tiles, 2);
    $rows = min($rows, MOS_SETTINGS_ROW_STANDINS);
    for ($r = 0; $r < max($rows, count($stories)); $r++) {
        if ($r < $rows) { $items[] = ['::row' . ($r + 1), 6, null]; }
        array_push($items, ...$paired($stories[$r] ?? [], ''));
    }
    $items[] = ['::footer', 6, null];

    if ($hero !== 'slides') { array_push($items, ...$slides(true)); }
    array_push($items, ...$paired($empty, ' — tómur'));
    return ['hero' => $hero, 'hero_banner' => $hero_banner, 'items' => $items];
}

/** Columns (of 6) for each of $count side-by-side cards: 1 → 6, 2 → 3, 3 → 2; more wrap three to a row. */
function mos_settings_share(int $count): int {
    return intdiv(6, max(1, min(3, $count)));
}

/**
 * The parts of the front-page copy the owner clicks, in the order the storefront shows them (from the layout):
 * `bar` (orange line), `header` (logo), `hero`, `row<N>`, `banner_<N>` tiles (`span` 3 = half a row, 6 = full),
 * `notice` (grey notice); then what the storefront does not show now, marked `off`: `fallback_slides` (the slides
 * while a banner is the hero) and each empty banner. Every field of mos_settings_field_keys() is in exactly one zone.
 *
 * The hero holds the hero texts plus whatever is on top: the hero banner's fields (`mode` banner, `banner` = its
 * number), the slides (`mode` slides), or nothing (`mode` '').
 *
 * @param array{hero: ''|'banner'|'slides', hero_banner: int, items: list<array{0: string, 1: int, 2: ?string}>} $layout
 * @return list<array{id: string, kind: string, title: string, hint: string, fields: list<string>, off: bool, span?: int, mode?: string, banner?: int}>
 */
function mos_settings_zones(array $layout): array {
    $zone = static fn(string $id, string $kind, string $title, string $hint, array $fields, array $extra = []): array =>
        array_merge(['id' => $id, 'kind' => $kind, 'title' => $title, 'hint' => $hint, 'fields' => $fields, 'off' => false], $extra);
    $banner = static fn(int $i): array => ["banner_{$i}_image", "banner_{$i}_title", "banner_{$i}_link"];
    $slide = static fn(int $i): array => ["hero_slide_{$i}_product", "hero_slide_{$i}_image"];
    $texts = ['hero_heading', 'hero_text', 'hero_button_1_label', 'hero_button_1_link'];
    $hero_banner = (int) $layout['hero_banner'];

    $page = $slides = $off_banners = [];
    $after_footer = false;
    foreach ($layout['items'] as [$name, $span]) {
        if ($name === '::footer') { $after_footer = true; continue; }
        if (preg_match('/^::row(\d+)$/', $name, $m)) {
            $n = (int) $m[1];
            $page[] = $zone("row{$n}", 'row', "Vörulína {$n}", 'Röð af vörum á forsíðunni: fyrirsögn, hvaða vörur og hve margar.',
                ["row_{$n}_title", "row_{$n}_source", "row_{$n}_category", "row_{$n}_count"]);
        } elseif (preg_match('/^hero_slide_(\d+)_/', $name, $m)) {
            $slides[(int) $m[1]] = true;
        } elseif (preg_match('/^banner_(\d+)_image$/', $name, $m) && (int) $m[1] !== $hero_banner) {
            $i = (int) $m[1];
            if ($after_footer) { $off_banners[] = $i; continue; }
            $page[] = $zone("banner_{$i}", 'banner', "Borði {$i}", 'Mynd með titli sem vísar á síðu í versluninni. Borðarnir raðast tveir og tveir.',
                $banner($i), ['span' => (int) $span]);
        }
    }
    $slide_fields = $slides ? array_merge(...array_map($slide, array_keys($slides))) : [];

    if ($layout['hero'] === 'banner') {
        $hero = $zone('hero', 'hero', 'Forsíðumynd',
            "Stóra myndin efst. Hún er borði {$hero_banner}, fyrsti borðinn sem hefur mynd. Ef fyrirsögnin er tóm er titill borðans notaður.",
            array_merge($banner($hero_banner), $texts), ['mode' => 'banner', 'banner' => $hero_banner]);
    } elseif ($layout['hero'] === 'slides') {
        $hero = $zone('hero', 'hero', 'Forsíðumynd: vöruglærur',
            'Enginn borði hefur mynd, svo þessar vörur skiptast á efst. Glæra án myndar notar vörumyndina.',
            array_merge($slide_fields, $texts), ['mode' => 'slides', 'banner' => 0]);
    } else {
        $hero = $zone('hero', 'hero', 'Forsíðumynd',
            'Ekkert er efst á forsíðunni núna, svo þessir textar sjást ekki. Settu mynd á borða, eða veldu vöru í vöruglæru (undir „Ekki á forsíðunni núna“).',
            $texts, ['mode' => '', 'banner' => 0]);
    }

    $zones = array_merge([
        $zone('bar', 'bar', 'Appelsínugula línan', 'Efst á öllum síðum. Vinstra megin t.d. fréttir eða tilboð, hægra megin t.d. opnunartími.',
            ['campaign_text', 'campaign_text_right']),
        $zone('header', 'header', 'Merki', 'Merkið efst á öllum síðum. Valmyndinni sjálfri breytir þú á Valmynd-síðunni.', ['site_logo']),
        $hero,
    ], $page, [
        $zone('notice', 'notice', 'Grá tilkynning', 'Neðst á skjánum þar til viðskiptavinur lokar henni. Tómt = engin tilkynning.', ['store_notice']),
    ]);
    if ($layout['hero'] !== 'slides' && $slide_fields) {
        $zones[] = $zone('fallback_slides', 'slides', 'Vöruglærur (varaforsíða)', 'Sjást aðeins efst ef enginn borði hefur mynd.',
            $slide_fields, ['off' => true]);
    }
    foreach ($off_banners as $i) {
        $zones[] = $zone("banner_{$i}", 'banner', "Borði {$i}", 'Tómur: birtist á forsíðunni þegar hann fær mynd eða titil.',
            $banner($i), ['off' => true, 'span' => 3]);
    }
    return $zones;
}

/**
 * The field labels the owner sees in the side panel (the zone's title says which banner, row or slide), keyed by
 * field name; fields not listed keep their Forsíða label.
 *
 * @return array<string, string>
 */
function mos_settings_field_labels(): array {
    $labels = [
        'campaign_text' => 'Vinstra megin', 'campaign_text_right' => 'Hægra megin', 'store_notice' => 'Tilkynning',
        'site_logo' => 'Merki', 'hero_heading' => 'Fyrirsögn', 'hero_text' => 'Texti undir fyrirsögn',
        'hero_button_1_label' => 'Texti á hnapp', 'hero_button_1_link' => 'Hvert hnappurinn vísar',
    ];
    foreach (range(1, max(MOS_SETTINGS_ROW_STANDINS, defined('MOS_PRODUCT_ROWS') ? MOS_PRODUCT_ROWS : 2)) as $i) {
        $labels += ["row_{$i}_title" => 'Fyrirsögn', "row_{$i}_source" => 'Hvaða vörur', "row_{$i}_category" => 'Vöruflokkur', "row_{$i}_count" => 'Fjöldi vara'];
    }
    foreach (range(1, defined('MOS_BANNER_SLOTS') ? MOS_BANNER_SLOTS : 8) as $i) {
        $labels += ["banner_{$i}_image" => 'Mynd', "banner_{$i}_title" => 'Titill á borða', "banner_{$i}_link" => 'Hvert borðinn vísar'];
    }
    foreach (range(1, defined('MOS_HERO_SLIDES') ? MOS_HERO_SLIDES : 3) as $i) {
        $labels += ["hero_slide_{$i}_product" => "Glæra {$i}: vara", "hero_slide_{$i}_image" => "Glæra {$i}: mynd (valfrjálst, annars vörumynd)"];
    }
    return $labels;
}

/**
 * Which banner, row or slide a field belongs to ('' for the single fields). The script shows that in the zone title;
 * without it, the page puts it above the field (data-context), since the labels alone repeat ("Titill á borða").
 */
function mos_settings_field_context(string $name): string {
    if (preg_match('/^banner_(\d+)_/', $name, $m)) { return "Borði {$m[1]}"; }
    if (preg_match('/^row_(\d+)_/', $name, $m)) { return "Vörulína {$m[1]}"; }
    if (preg_match('/^hero_slide_(\d+)_/', $name, $m)) { return "Glæra {$m[1]}"; }
    if (strpos($name, 'hero_') === 0) { return 'Forsíðumynd'; }
    if (strpos($name, 'campaign_') === 0) { return 'Appelsínugula línan'; }
    return '';
}

/** One line under a field, keyed by field name pattern (the links say what to type). */
function mos_settings_field_hint(string $name): string {
    if (preg_match('/^(banner_\d+|hero_button_1)_link$/', $name)) { return 'Síða í versluninni, t.d. /voruflokkur/skor/ eða /verslun/?brand=nike'; }
    if ($name === 'hero_button_1_label') { return 'Tómt: þá er hnappur 2 af Forsíða-skjánum sýndur, eða „Skoða nýjungar“.'; }
    return '';
}

/** The notice after a save. 'late' = the storefront wasn't reached, so the old page can stay a little longer. */
function mos_settings_saved_message(string $poked): string {
    return 'Vistað. ' . MOS_SETTINGS_WAIT_NOTE . ($poked === 'ok' ? '' : ' Ef breytingin sést ekki eftir mínútu, endurhlaðaðu forsíðuna.');
}

/**
 * Where an old (renamed) admin page address goes: the same query on the new slug, '' when the page wasn't renamed.
 *
 * @param array<string, mixed> $query the request's query args (unslashed)
 */
function mos_settings_renamed_url(array $query): string {
    $page = is_string($query['page'] ?? null) ? $query['page'] : '';
    if (!isset(MOS_SETTINGS_RENAMED_PAGES[$page])) { return ''; }
    $query = array_filter($query, 'is_scalar');
    $query['page'] = MOS_SETTINGS_RENAMED_PAGES[$page];
    return admin_url('admin.php?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986));
}

// WordPress refuses an unknown admin page before admin_init; send the old addresses on instead.
add_action('admin_page_access_denied', static function (): void {
    $url = mos_settings_renamed_url(wp_unslash($_GET));
    if ($url !== '') { wp_safe_redirect($url); exit; }
});

/**
 * Numbers of the hero slides that have a product but would not be shown (unpublished product, or no picture at all).
 *
 * @param array<int, int> $products slide number => product id (0 = none)
 * @param array<int, bool> $shown slide number => shown on the storefront
 * @return list<int>
 */
function mos_settings_hidden_slides(array $products, array $shown): array {
    $hidden = [];
    foreach ($products as $slide => $product_id) {
        if ($product_id > 0 && !($shown[$slide] ?? false)) { $hidden[] = $slide; }
    }
    return $hidden;
}

/**
 * The saved front-page state the layout depends on, read the way mos_rest_front_page() reads it: a banner is shown
 * when it has a picture or a title; a slide is shown when mos_hero_slide() gives it a picture.
 *
 * `slides` is what the copy needs per slide: the product's name and its own photo (the storefront shows that photo when
 * the slide has no picture of its own, mos_hero_slide()).
 *
 * @return array{banners: array<int, string>, shown: array<int, bool>, products: array<int, int>, slides: array<int, array{product: int, name: string, image: string}>}
 */
function mos_settings_state(int $page_id): array {
    $f = static fn(string $name) => get_field($name, $page_id, false);
    $banners = [];
    for ($i = 1; $i <= MOS_BANNER_SLOTS; $i++) {
        $title = (string) $f("banner_{$i}_title");
        $banners[$i] = mos_image($f("banner_{$i}_image")) ? 'image' : ($title !== '' ? 'text' : 'empty');
    }
    $shown = $products = $slides = [];
    for ($i = 1; $i <= MOS_HERO_SLIDES; $i++) {
        $products[$i] = (int) $f("hero_slide_{$i}_product");
        $slide = mos_hero_slide($products[$i], mos_image($f("hero_slide_{$i}_image")));
        $shown[$i] = $slide !== null && !empty($slide['image']);
        $product = $slide !== null ? wc_get_product($products[$i]) : null;
        $photo = $product ? mos_image($product->get_image_id()) : null;
        $slides[$i] = ['product' => $products[$i], 'name' => (string) ($slide['name'] ?? ''), 'image' => (string) ($photo['url'] ?? '')];
    }
    return ['banners' => $banners, 'shown' => $shown, 'products' => $products, 'slides' => $slides];
}

/**
 * The front page whose fields the storefront reads (`page_on_front`, as mos_rest_front_page() does), 0 when it is
 * unset or the page is gone.
 */
function mos_settings_front_page_id(): int {
    $page_id = (int) get_option('page_on_front');
    $status = $page_id > 0 ? get_post_status($page_id) : false;
    return $status && $status !== 'trash' ? $page_id : 0;
}

/** Whether the current user may change the front page's pictures (= may edit that page). */
function mos_settings_can_edit(int $page_id): bool {
    return $page_id > 0 && current_user_can('edit_post', $page_id);
}

/** Position 1 puts the entry above Mælaborð (2). */
function mos_settings_register_menu(): void {
    add_menu_page('Stillingar', 'Stillingar', 'edit_pages', MOS_SETTINGS_SLUG, 'mos_settings_render',
        'dashicons-format-image', 1);
}

/** ACF and the Forsíða fields (mos-headless-api.php) are both loaded. */
function mos_settings_ready(): bool {
    return function_exists('acf_form') && function_exists('acf_form_head') && function_exists('mos_hero_slide')
        && defined('MOS_HERO_SLIDES') && defined('MOS_BANNER_SLOTS') && defined('MOS_PRODUCT_ROWS');
}

/**
 * The front page's saved state and its layout, read once per request (after acf_form_head(): a save redirects and
 * exits there, so this is always the saved values).
 *
 * @return array{banners: array<int, string>, shown: array<int, bool>, products: array<int, int>, layout: array}
 */
function mos_settings_current(int $page_id): array {
    static $current = [];
    if (!isset($current[$page_id])) {
        $state = mos_settings_state($page_id);
        $current[$page_id] = $state + ['layout' => mos_settings_layout($state['banners'], $state['shown'], MOS_PRODUCT_ROWS)];
    }
    return $current[$page_id];
}

add_action('admin_menu', 'mos_settings_register_menu');

// Before any output: ACF saves a submitted form here and redirects back with ?updated=true.
add_action('load-toplevel_page_' . MOS_SETTINGS_SLUG, static function (): void {
    $page_id = mos_settings_front_page_id();
    if (!mos_settings_ready() || $page_id === 0) { return; }
    if (!mos_settings_can_edit($page_id)) {
        wp_die('Þú hefur ekki heimild til að breyta forsíðunni.', 'Stillingar', ['response' => 403]);
    }
    // ACF already takes the target from its signed form data; this pins it to the page checked above regardless.
    add_filter('acf/pre_submit_form', static function ($form) use ($page_id) {
        if (is_array($form)) { $form['post_id'] = $page_id; }
        return $form;
    });
    acf_form_head();
    acf_enqueue_uploader();

    $labels = mos_settings_field_labels();
    add_filter('acf/prepare_field', static function ($field) use ($labels) {
        // `name` is already the form's `acf[<key>]` here; `_name` is the field's own name.
        $name = is_array($field) ? (string) ($field['_name'] ?? '') : '';
        if (isset($labels[$name])) { $field['label'] = $labels[$name]; }
        $hint = mos_settings_field_hint($name);
        if ($hint !== '') { $field['instructions'] = $hint; }
        if (is_array($field)) {
            $field['wrapper']['width'] = ''; // full width in the narrow side panel
            $context = mos_settings_field_context($name);
            if ($context !== '') { $field['wrapper']['data-context'] = $context; }
        }
        return $field;
    });
    add_action('admin_head', static function (): void { echo '<style>' . mos_settings_base_css() . '</style>'; });
});

/**
 * The page's own styles. Without the script the fields are plain cards in ACF's order and the side panel is a plain
 * box under them; the script (mos_settings_script) draws the front-page copy and turns on `.mos-set--js`: copy on the
 * left, the chosen zone's fields and the save button on the right. Shapes follow global.css: the hero ≈ 16:7 here,
 * a banner tile 4:5, a full-width tile ≈ 14:5.
 */
function mos_settings_base_css(): string {
    return <<<'CSS'

.mos-set { --st-line: #dcdcde; --st-ink: #1d2327; --st-meta: #646970; --st-warn: #dba617; --set-accent: #2271b1; --st-orange: #f36f21; }
.mos-set__intro { max-width: 1164px; margin: 12px 0 16px; padding: 12px 16px; border-left: 4px solid var(--set-accent); background: #fff; font-size: 14px; }
.mos-set__grid { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 24px; align-items: start; max-width: 1164px; }
.mos-set:not(.mos-set--js) .mos-set__grid { display: block; }
.mos-set:not(.mos-set--js) .mos-set__main, .mos-set:not(.mos-set--js) .mos-set__intro { display: none; }
.mos-set__side { position: sticky; top: 48px; padding: 20px; border: 1px solid var(--st-line); border-radius: 8px; background: #fff; }
.mos-set__zone h2 { margin: 0 0 4px; font-size: 16px; }
.mos-set__zone p { margin: 0 0 12px; color: var(--st-meta); }
.mos-set:not(.mos-set--js) .mos-set__zone { display: none; }
.mos-set__save { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--st-line); }
.mos-set__status { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; color: var(--st-meta); }
.mos-set__status::before { content: ""; flex: none; width: 8px; height: 8px; border-radius: 50%; background: #00a32a; }
.mos-set__status.is-dirty { color: var(--st-ink); font-weight: 600; }
.mos-set__status.is-dirty::before { background: var(--st-warn); }
.mos-set:not(.mos-set--js) .mos-set__status { display: none; }
.mos-set__save .button-primary { display: block; width: 100%; min-height: 40px; margin-bottom: 8px; text-align: center; }
.mos-set__view { display: inline-block; margin-bottom: 8px; text-decoration: none; }
.mos-set__note { margin: 0; color: var(--st-meta); }
.mos-set__more { margin: 12px 0 0; color: var(--st-meta); }
#mos-settings .acf-form-submit { display: none; }

#mos-settings .acf-fields { border: 0; background: none; }
#mos-settings .acf-field { float: none; width: auto !important; min-height: 0; margin: 0 0 12px; padding: 0; border: 0 !important; background: none; }
#mos-settings .acf-field::before { display: none; }
.mos-set:not(.mos-set--js) #mos-settings .acf-field[data-context]::before { content: attr(data-context); display: block; position: static; margin: 0 0 4px; border: 0; color: var(--st-meta); font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.mos-set:not(.mos-set--js) #mos-settings .acf-field { padding: 12px; border: 1px solid var(--st-line) !important; border-radius: 6px; background: #fff; }
#mos-settings .acf-field.is-changed > .acf-label label::after { content: " • breytt"; color: #996800; font-weight: 400; }
#mos-settings .acf-field .acf-label { margin-bottom: 4px; }
#mos-settings .acf-field .acf-label label { font-weight: 600; }
#mos-settings .acf-field p.description { margin-top: 4px; }
#mos-settings .acf-image-uploader .image-wrap { float: none; width: 100%; max-width: none !important; }
#mos-settings .acf-image-uploader.has-value .image-wrap { display: block; }
#mos-settings .acf-image-uploader img { display: block; width: 100%; height: auto; max-height: 240px !important; object-fit: contain; border-radius: 4px; background: #f6f7f7; }
.mos-set-zone[hidden] { display: none !important; }

.mos-set-page { overflow: hidden; border: 1px solid var(--st-line); border-radius: 8px; background: #fff; font-size: 13px; }
.mos-set-pv { position: relative; display: block; cursor: pointer; outline: 2px solid transparent; outline-offset: -2px; }
.mos-set-pv:hover { outline-color: rgba(34, 113, 177, .45); }
.mos-set-pv:focus-visible { outline-color: var(--set-accent); }
.mos-set-pv.is-on { outline: 3px solid var(--set-accent); outline-offset: -3px; z-index: 1; }
.mos-set-pv.is-on::after { content: "Verið að breyta"; position: absolute; top: 6px; right: 6px; padding: 2px 8px; border-radius: 3px; background: var(--set-accent); color: #fff; font-size: 11px; }
.mos-set-pv.is-changed::before { content: "Óvistað"; position: absolute; top: 6px; left: 6px; z-index: 2; padding: 2px 8px; border-radius: 3px; background: var(--st-warn); color: #1d2327; font-size: 11px; }
/* The thin strips have no room for the labels: the outline says "chosen", a yellow edge says "unsaved". */
.mos-set-pv--bar::after, .mos-set-pv--header::after, .mos-set-pv--notice::after,
.mos-set-pv--bar::before, .mos-set-pv--header::before, .mos-set-pv--notice::before { display: none; }
.mos-set-pv--bar.is-changed, .mos-set-pv--header.is-changed, .mos-set-pv--notice.is-changed { box-shadow: inset 6px 0 0 var(--st-warn); }
.mos-set-pv--bar { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; background: var(--st-orange); color: #fff; font-weight: 600; }
.mos-set-pv--header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--st-line); }
.mos-set-pv--header img { display: block; width: auto; height: 32px; }
.mos-set-pv__menu { color: var(--st-meta); }
.mos-set-pv--hero { aspect-ratio: 16 / 7; background: #2c3338; color: #fff; }
.mos-set-pv--hero img { display: block; width: 100%; height: 100%; object-fit: cover; opacity: .9; }
.mos-set-pv__slides { display: flex; height: 100%; gap: 8px; padding: 12px; background: #f5f5f5; }
.mos-set-pv__slides img { flex: 1 1 0; min-width: 0; object-fit: contain; opacity: 1; }
.mos-set-pv__copy { position: absolute; right: 18px; bottom: 16px; left: 18px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-shadow: 0 1px 6px rgba(0, 0, 0, .6); }
.mos-set-pv--hero.is-slides .mos-set-pv__copy { color: #1d2327; text-shadow: none; }
.mos-set-pv__copy strong { font-size: 22px; line-height: 1.15; text-transform: uppercase; }
.mos-set-pv__cta { padding: 5px 14px; border-radius: 999px; background: #fff; color: #1d2327; font-weight: 600; text-shadow: none; }
.mos-set-pv--hero.is-none { aspect-ratio: auto; padding: 14px; background: #f6f7f7; color: var(--st-meta); }
.mos-set-pv__slide { flex: 1 1 0; display: flex; align-items: center; justify-content: center; padding: 8px; border-radius: 4px; background: #fff; color: #1d2327; text-align: center; }
.mos-set-pv__empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #c3c4c7; }
.mos-set-pv--row { padding: 12px; }
.mos-set-pv--row strong { display: block; margin-bottom: 2px; font-size: 14px; }
.mos-set-pv__src { display: block; margin-bottom: 8px; color: var(--st-meta); font-size: 12px; }
.mos-set-pv__items { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.mos-set-pv__items i { aspect-ratio: 1; border-radius: 4px; background: #f0f0f1; }
.mos-set-pv__pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 0 12px 12px; }
.mos-set-pv--banner { overflow: hidden; aspect-ratio: 4 / 5; border-radius: 4px; background: #50575e; color: #fff; }
.mos-set-pv--banner.is-wide { grid-column: span 2; aspect-ratio: 14 / 5; }
.mos-set-pv--banner img { display: block; width: 100%; height: 100%; object-fit: cover; }
.mos-set-pv--banner strong { position: absolute; right: 10px; bottom: 10px; left: 10px; font-size: 15px; text-transform: uppercase; text-shadow: 0 1px 6px rgba(0, 0, 0, .7); }
.mos-set-pv--notice { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; background: #e5e5e5; }
.mos-set-pv__off { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0 0; color: var(--st-meta); }
.mos-set-pv__off .button.is-on { border-color: var(--set-accent); box-shadow: 0 0 0 1px var(--set-accent); }
.mos-set__foot { max-width: 1164px; margin: 12px 0 0; color: var(--st-meta); }

.mos-set__boxes { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; max-width: 1164px; margin-top: 24px; }
.mos-set-box { padding: 16px 20px 20px; border: 1px solid var(--st-line); border-radius: 8px; background: #fff; }
.mos-set-box > h2 { margin: 0 0 12px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.mos-set-box > p { margin-top: 0; }

@media (max-width: 1100px) {
  .mos-set__grid { grid-template-columns: minmax(0, 1fr); }
  .mos-set__side { position: static; }
}

CSS;
}

/**
 * Draws the front-page copy from the zones and moves each zone's ACF fields (the field nodes; ACF's own handlers are
 * delegated, so they keep working) into a box in the side panel, showing only the chosen zone. The copy reads the
 * fields' current values, so it changes while the owner types, with the storefront's fallbacks (homeLayout.ts): an
 * empty heading shows the hero banner's title, a button without text or link gives way to button 2, then to
 * "Skoða nýjungar". Counts the fields whose value differs from the saved one. Every text is set with textContent.
 *
 * `$data`: {zones, slides: {N: {product, name, image}}, button2: {label, link}, fallbackCta, fallbackHeadline, menuHint}.
 */
function mos_settings_script(array $data): string {
    return '(function(){' . "\n" . 'var data=' . wp_json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE) . ';' . "\n" . <<<'JS'
var form=document.getElementById("mos-settings"); if(!form){return;}
var wrap=form.closest(".mos-set"), fields=form.querySelector(".acf-fields"), page=document.getElementById("mos-set-page"),
  off=document.getElementById("mos-set-off"), head=document.getElementById("mos-set-zone"), side=wrap&&wrap.querySelector(".mos-set__side");
if(!wrap||!fields||!page||!off||!head){return;}
function el(tag,cls,text){var e=document.createElement(tag); if(cls){e.className=cls;} if(text!=null&&text!==""){e.textContent=text;} return e;}
function field(name){return fields.querySelector('.acf-field[data-name="'+name+'"]');}
function val(name){
  var f=field(name); if(!f){return "";}
  var s=f.querySelector("select"); if(s){var o=s.options[s.selectedIndex]; return o&&o.value!==""?o.text.trim():"";}
  var i=f.querySelector("input[type=text],input[type=number],input[type=url],textarea"); return i?decode(i.value.trim()):"";
}
function img(name){
  var f=field(name), u=f&&f.querySelector(".acf-image-uploader"); if(!u||!u.classList.contains("has-value")){return "";}
  var i=u.querySelector("img"); return i&&i.getAttribute("src")?i.getAttribute("src"):"";
}
// Saved texts can hold entities (&amp;); the storefront shows them decoded. A detached textarea decodes without running anything.
var decoder=document.createElement("textarea");
function decode(v){if(v.indexOf("&")<0){return v;} decoder.innerHTML=v; return decoder.value;}
function real(h){h=h.trim(); return h!==""&&h!=="#";}
var zones={}, holders={}, current="";
data.zones.forEach(function(z){
  zones[z.id]=z;
  var box=el("div","mos-set-zone"); box.dataset.zone=z.id; box.hidden=true;
  z.fields.forEach(function(name){var f=field(name); if(f){box.appendChild(f);}});
  fields.appendChild(box); holders[z.id]=box;
});
function choose(id,scroll){
  if(!zones[id]){return;}
  current=id;
  Object.keys(holders).forEach(function(k){holders[k].hidden=k!==id;});
  head.textContent=""; head.appendChild(el("h2","",zones[id].title)); head.appendChild(el("p","",zones[id].hint));
  try{sessionStorage.setItem("mos-settings-zone",id);}catch(e){}
  draw();
  if(scroll&&side&&window.matchMedia("(max-width: 1100px)").matches){side.scrollIntoView({behavior:"smooth",block:"start"});}
}
function zoneEl(z,kind,extra){
  var d=el("div","mos-set-pv mos-set-pv--"+kind+(extra?" "+extra:"")+(z.id===current?" is-on":"")+(changedZones[z.id]?" is-changed":""));
  d.setAttribute("role","button"); d.tabIndex=0; d.setAttribute("aria-label","Breyta: "+z.title); d.dataset.zone=z.id;
  return d;
}
// The slides as the storefront shows them: the own picture of a slide, else the photo of its product (known for the saved product
// only; a newly picked product shows its name until saved). A slide without a product is left out.
function slideList(){
  var out=[];
  Object.keys(data.slides||{}).forEach(function(n){
    var f=field("hero_slide_"+n+"_product"), s=f&&f.querySelector("select"), id=s?s.value:"", saved=data.slides[n];
    if(!id){return;}
    var same=String(saved.product)===id, own=img("hero_slide_"+n+"_image");
    var image=own||(same?saved.image:""), name=same?saved.name:val("hero_slide_"+n+"_product");
    if(image||!same){out.push({image:image,name:name});}
  });
  return out;
}
function picture(src){var i=el("img"); i.src=src; i.alt=""; i.loading="lazy"; return i;}
var changedZones={};
function draw(){
  page.textContent=""; off.textContent="";
  var pair=null, used=0, offList=[];
  data.zones.forEach(function(z){
    if(z.off){offList.push(z); return;}
    if(z.kind!=="banner"){pair=null; used=0;}
    var d;
    if(z.kind==="bar"){d=zoneEl(z,"bar"); d.appendChild(el("span","",val("campaign_text")||"(tómt)")); d.appendChild(el("span","",val("campaign_text_right")));}
    else if(z.kind==="header"){d=zoneEl(z,"header"); var lg=img("site_logo"); d.appendChild(lg?picture(lg):el("strong","","MERKI")); d.appendChild(el("span","mos-set-pv__menu",data.menuHint));}
    else if(z.kind==="hero"){
      if(z.mode===""){d=zoneEl(z,"hero","is-none"); d.appendChild(el("div","mos-set-pv__empty","Ekkert efst á forsíðunni núna")); page.appendChild(d); return;}
      d=zoneEl(z,"hero",z.mode==="slides"?"is-slides":"");
      if(z.mode==="banner"){var hi=img("banner_"+z.banner+"_image"); if(hi){d.appendChild(picture(hi));}}
      else{var sl=el("div","mos-set-pv__slides"); slideList().forEach(function(s){sl.appendChild(s.image?picture(s.image):el("span","mos-set-pv__slide",s.name));}); d.appendChild(sl);}
      var copy=el("div","mos-set-pv__copy"), heading=val("hero_heading"), first=slideList().filter(function(s){return s.name;})[0];
      // homeLayout.ts planHome: heading, then the banner title, then the name of the first slide; product slides show their own names.
      if(!heading&&z.mode==="banner"){heading=val("banner_"+z.banner+"_title")||(first&&first.name)||data.fallbackHeadline;}
      if(!heading&&z.mode==="slides"&&first){heading=first.name;}
      if(heading){copy.appendChild(el("strong","",heading));}
      if(val("hero_text")){copy.appendChild(el("span","",val("hero_text")));}
      var cta=val("hero_button_1_label")&&real(val("hero_button_1_link"))?val("hero_button_1_label"):(data.button2.label.trim()&&real(data.button2.link)?data.button2.label.trim():data.fallbackCta);
      copy.appendChild(el("span","mos-set-pv__cta",cta)); d.appendChild(copy);
    }
    else if(z.kind==="row"){
      d=zoneEl(z,"row"); var n=z.id.slice(3), src=val("row_"+n+"_source"), cat=val("row_"+n+"_category");
      d.appendChild(el("strong","",val("row_"+n+"_title")||"(engin fyrirsögn)"));
      d.appendChild(el("span","mos-set-pv__src",(src||"")+(cat?": "+cat:"")+" · "+(val("row_"+n+"_count")||"10")+" vörur"));
      var it=el("div","mos-set-pv__items"); for(var k=0;k<5;k++){it.appendChild(el("i"));} d.appendChild(it);
    }
    else if(z.kind==="banner"){
      var num=z.id.slice(7); d=zoneEl(z,"banner",z.span===6?"is-wide":"");
      var bi=img("banner_"+num+"_image"); if(bi){d.appendChild(picture(bi));}
      d.appendChild(el("strong","",val("banner_"+num+"_title")));
      if(!pair||used+z.span>6){pair=el("div","mos-set-pv__pair"); page.appendChild(pair); used=0;}
      pair.appendChild(d); used+=z.span; return;
    }
    else if(z.kind==="notice"){d=zoneEl(z,"notice"); d.appendChild(el("span","",val("store_notice")||"(engin tilkynning)")); d.appendChild(el("span","","×"));}
    if(d){page.appendChild(d);}
  });
  if(offList.length){
    off.appendChild(el("span","","Ekki á forsíðunni núna:"));
    offList.forEach(function(z){var b=el("button","button"+(z.id===current?" is-on":""),z.title+(changedZones[z.id]?" • óvistað":"")); b.type="button"; b.dataset.zone=z.id; off.appendChild(b);});
  }
}
function pick(ev){var t=ev.target.closest("[data-zone]"); if(t&&(page.contains(t)||off.contains(t))){choose(t.dataset.zone,true);}}
page.addEventListener("click",pick); off.addEventListener("click",pick);
page.addEventListener("keydown",function(ev){if((ev.key==="Enter"||ev.key===" ")&&ev.target.dataset&&ev.target.dataset.zone){ev.preventDefault(); choose(ev.target.dataset.zone,true);}});
wrap.classList.add("mos-set--js");
var status=wrap.querySelector(".mos-set__status"), saved=new Map();
function inputs(){return fields.querySelectorAll('.acf-field[data-name] input[name^="acf["]:not([type=checkbox]):not([type=radio]), .acf-field[data-name] select[name^="acf["], .acf-field[data-name] textarea[name^="acf["]');}
inputs().forEach(function(i){saved.set(i,i.value);});
function count(){
  var changed=new Set(); changedZones={};
  inputs().forEach(function(i){var f=i.closest(".acf-field[data-name]"); if(f&&(saved.has(i)?saved.get(i):"")!==i.value){changed.add(f); var h=f.closest(".mos-set-zone"); if(h){changedZones[h.dataset.zone]=true;}}});
  // Touch a class only when it flips: the picture watcher below would otherwise see its own writes.
  fields.querySelectorAll(".acf-field[data-name]").forEach(function(f){if(f.classList.contains("is-changed")!==changed.has(f)){f.classList.toggle("is-changed");}});
  var n=changed.size;
  if(status){status.classList.toggle("is-dirty",n>0); status.textContent=n===0?"Engar óvistaðar breytingar":(n===1?"1 óvistuð breyting":n+" óvistaðar breytingar");}
}
var queued=false;
function update(){if(queued){return;} queued=true; requestAnimationFrame(function(){queued=false; count(); draw();});}
if(window.jQuery){window.jQuery(form).on("change",update);} form.addEventListener("change",update); form.addEventListener("input",update);
// ACF swaps the picture after the media frame closes; watch the uploaders so the copy follows.
new MutationObserver(function(list){
  if(list.some(function(m){return m.target.tagName==="IMG"||m.target.classList.contains("acf-image-uploader");})){update();}
}).observe(fields,{subtree:true,attributes:true,attributeFilter:["src","class"]});
// A field the browser rejects (a row count of 30, say) may sit in a hidden zone, and the browser then refuses the save
// without a word: open that zone first, then let the browser point at the field.
form.addEventListener("invalid",function(ev){
  var box=ev.target.closest&&ev.target.closest(".mos-set-zone"); if(!box||!box.hidden){return;}
  choose(box.dataset.zone,true); setTimeout(function(){ev.target.reportValidity();},0);
},true);
var leaving=false; form.addEventListener("submit",function(){leaving=true;});
window.addEventListener("beforeunload",function(ev){if(!leaving&&status&&status.classList.contains("is-dirty")){ev.preventDefault(); ev.returnValue="";}});
var start=""; try{start=sessionStorage.getItem("mos-settings-zone")||"";}catch(e){}
count(); choose(zones[start]?start:"hero",false);
})();
JS;
}

function mos_settings_render(): void {
    echo '<div class="wrap mos-set"><h1>Stillingar</h1>';
    mos_settings_render_front_page();
    // Other storefront settings boxes (mos-instagram.php, mos-nav.php) hang here as cards; each checks its own rights.
    echo '<div class="mos-set__boxes">';
    do_action('mos_settings_after');
    echo '</div></div>';
}

/** The storefront's home page, for "Skoða forsíðu" (the headless target when set, else this site). */
function mos_settings_storefront_url(): string {
    $base = function_exists('mos_headless_target_base') ? mos_headless_target_base() : '';
    return $base !== '' ? $base . '/' : home_url('/');
}

/** The front-page copy, the form in its side panel (or why it isn't shown), inside the page's wrap. */
function mos_settings_render_front_page(): void {
    $page_id = mos_settings_front_page_id();
    if (!mos_settings_ready()) {
        echo '<div class="notice notice-error"><p>Advanced Custom Fields og mos-headless-api.php þurfa að vera virk.'
            . '</p></div>';
        return;
    }
    if ($page_id === 0) {
        echo '<div class="notice notice-warning"><p>Engin forsíða er valin. Veldu hana í Stillingar → Lestur neðar í '
            . 'valmyndinni (Forsíða sýnir: Ákveðin síða).</p></div>';
        return;
    }
    if (!mos_settings_can_edit($page_id)) {
        echo '<div class="notice notice-error"><p>Þú hefur ekki heimild til að breyta forsíðunni.</p></div>';
        return;
    }
    $state = mos_settings_current($page_id);
    $layout = $state['layout'];
    if ($layout['hero'] === 'slides') {
        foreach (mos_settings_hidden_slides($state['products'], $state['shown']) as $slide) {
            echo '<div class="notice notice-warning"><p>Glæra ' . (int) $slide . ' birtist ekki á forsíðunni: varan er '
                . 'ekki birt eða hefur enga mynd. Veldu aðra vöru eða mynd.</p></div>';
        }
    }
    // Set by mos_front_page_saved() during the save that redirected here (?updated=true); read once, and only then,
    // so another visit to this page doesn't use it up.
    $poked = isset($_GET['updated']) && function_exists('mos_front_page_poke_result') ? mos_front_page_poke_result() : '';
    $menu_url = function_exists('mos_menu_editor_url') ? mos_menu_editor_url() : admin_url('admin.php?page=mos-menu');

    echo '<p class="mos-set__intro">Smelltu á það á forsíðunni sem þú vilt breyta. Reitirnir opnast í spjaldinu við '
        . 'hliðina (fyrir neðan á litlum skjá) og breytingin sést strax í myndinni hér; hún fer á vefinn þegar þú ýtir á '
        . '„Vista breytingar“.</p>';
    echo '<div class="mos-set__grid"><div class="mos-set__main"><div class="mos-set-page" id="mos-set-page"></div>'
        . '<div class="mos-set-pv__off" id="mos-set-off"></div></div>';
    echo '<aside class="mos-set__side"><div class="mos-set__zone" id="mos-set-zone"></div>';
    acf_form([
        'id'              => 'mos-settings',
        'post_id'         => $page_id,
        'fields'          => mos_settings_field_keys(MOS_HERO_SLIDES, MOS_BANNER_SLOTS, MOS_PRODUCT_ROWS),
        'submit_value'    => 'Vista breytingar',
        'updated_message' => mos_settings_saved_message($poked),
        'html_submit_button' => '<input type="submit" class="button button-primary button-large" value="%s" />',
    ]);
    echo '<div class="mos-set__save"><p class="mos-set__status" role="status"></p>'
        . '<button type="submit" form="mos-settings" class="button button-primary button-large">Vista breytingar</button>'
        . '<a class="mos-set__view" href="' . esc_url(mos_settings_storefront_url()) . '" target="_blank" rel="noopener">Skoða forsíðu ↗</a>'
        . '<p class="mos-set__note">' . esc_html(MOS_SETTINGS_WAIT_NOTE) . '</p></div>'
        . '<p class="mos-set__more">Fótur (heimilisfang, sími, netfang) og hnappur 2 eru á '
        . '<a href="' . esc_url((string) get_edit_post_link($page_id)) . '">Forsíða-skjánum</a>. '
        . 'Valmyndinni breytir þú á <a href="' . esc_url($menu_url) . '">Valmynd</a>.</p>'
        . '</aside></div>';

    $f = static fn(string $name): string => (string) get_field($name, $page_id, false);
    echo '<script>' . mos_settings_script([
        'zones' => mos_settings_zones($layout),
        'slides' => $state['slides'],
        'button2' => ['label' => $f('hero_button_2_label'), 'link' => $f('hero_button_2_link')],
        'fallbackCta' => 'Skoða nýjungar',
        'fallbackHeadline' => 'Nýjungar',
        'menuHint' => 'Valmynd · Vörur · Félög · Vörumerki',
    ]) . '</script>';
}
