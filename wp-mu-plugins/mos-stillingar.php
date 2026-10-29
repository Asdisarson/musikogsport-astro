<?php
/**
 * Plugin Name: MOS Stillingar
 * Description: "Stillingar", the first item of the admin sidebar: the front page's pictures on one screen — header
 *  and footer logo, the banners, each hero slide's product and picture — laid out as a small copy of the storefront's
 *  front page. It shows the existing ACF "Forsíða" fields (mos-headless-api.php) for the front page, so it stores
 *  nothing of its own and the storefront reads the pictures exactly as before. Texts, product rows and footer stay on
 *  the Forsíða edit screen.
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_STILLINGAR_SLUG = 'mos-stillingar';
/** Product rows drawn as grey stand-ins: the grid's ::before and ::after. */
const MOS_STILLINGAR_ROW_STANDINS = 2;

/**
 * The Forsíða field keys the page shows: the two logos, each hero slide's product and picture, the banner pictures.
 *
 * @return list<string>
 */
function mos_stillingar_field_keys(int $slides, int $banners): array {
    $keys = ['field_mos_site_logo', 'field_mos_footer_logo'];
    for ($i = 1; $i <= $slides; $i++) {
        $keys[] = "field_mos_hero_slide_{$i}_product";
        $keys[] = "field_mos_hero_slide_{$i}_image";
    }
    for ($i = 1; $i <= $banners; $i++) {
        $keys[] = "field_mos_banner_{$i}_image";
    }
    return $keys;
}

/**
 * The page's fields in screen order, placed the way the storefront's front page places them (src/lib/homeLayout.ts
 * planHome + homeSections, src/pages/index.astro): header logo; the hero — the first banner with a picture, or the
 * product slides when no banner has one; then product row, banner pair, product row, banner pair, … (the other
 * shown banners paired in order, an odd one out full width); footer logo. After the footer: the slides when they
 * are not the hero, then the empty banners, so they can be filled.
 *
 * Each item is [field name, columns of 6, label or null to keep the Forsíða label]; `::row<N>` is product row N
 * (at most MOS_STILLINGAR_ROW_STANDINS). Every grid row is filled exactly: pairs take half, an odd one out the whole
 * row, the slides a share each.
 *
 * @param array<int, 'image'|'text'|'empty'> $banners banner number => picture / title only / nothing (= not shown)
 * @param array<int, bool> $shown slide number => the storefront would show it (published product, has a picture)
 * @return array{hero: ''|'banner'|'slides', hero_banner: int, items: list<array{0: string, 1: int, 2: ?string}>}
 */
function mos_stillingar_layout(array $banners, array $shown, int $rows): array {
    $hero_banner = 0;
    foreach ($banners as $i => $kind) {
        if ($kind === 'image') { $hero_banner = (int) $i; break; }
    }
    $hero = $hero_banner > 0 ? 'banner' : (in_array(true, $shown, true) ? 'slides' : '');

    $slides = static function (bool $fallback) use ($shown): array {
        $suffix = $fallback ? ' (varaforsíða)' : '';
        $span = mos_stillingar_share(count($shown));
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
    $rows = min($rows, MOS_STILLINGAR_ROW_STANDINS);
    for ($r = 0; $r < max($rows, count($stories)); $r++) {
        if ($r < $rows) { $items[] = ['::row' . ($r + 1), 6, null]; }
        array_push($items, ...$paired($stories[$r] ?? [], ''));
    }
    $items[] = ['footer_logo', 6, null];

    if ($hero !== 'slides') { array_push($items, ...$slides(true)); }
    array_push($items, ...$paired($empty, ' — tómur'));
    return ['hero' => $hero, 'hero_banner' => $hero_banner, 'items' => $items];
}

/** Columns (of 6) for each of $count side-by-side cards: 1 → 6, 2 → 3, 3 → 2; more wrap three to a row. */
function mos_stillingar_share(int $count): int {
    return intdiv(6, max(1, min(3, $count)));
}

/**
 * Numbers of the hero slides that have a product but would not be shown (unpublished product, or no picture at all).
 *
 * @param array<int, int> $products slide number => product id (0 = none)
 * @param array<int, bool> $shown slide number => shown on the storefront
 * @return list<int>
 */
function mos_stillingar_hidden_slides(array $products, array $shown): array {
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
 * @return array{banners: array<int, string>, shown: array<int, bool>, products: array<int, int>}
 */
function mos_stillingar_state(int $page_id): array {
    $f = static fn(string $name) => get_field($name, $page_id, false);
    $banners = [];
    for ($i = 1; $i <= MOS_BANNER_SLOTS; $i++) {
        $banners[$i] = mos_image($f("banner_{$i}_image")) ? 'image' : ((string) $f("banner_{$i}_title") !== '' ? 'text' : 'empty');
    }
    $shown = $products = [];
    for ($i = 1; $i <= MOS_HERO_SLIDES; $i++) {
        $products[$i] = (int) $f("hero_slide_{$i}_product");
        $slide = mos_hero_slide($products[$i], mos_image($f("hero_slide_{$i}_image")));
        $shown[$i] = $slide !== null && !empty($slide['image']);
    }
    return ['banners' => $banners, 'shown' => $shown, 'products' => $products];
}

/**
 * The front page whose fields the storefront reads (`page_on_front`, as mos_rest_front_page() does), 0 when it is
 * unset or the page is gone.
 */
function mos_stillingar_front_page_id(): int {
    $page_id = (int) get_option('page_on_front');
    $status = $page_id > 0 ? get_post_status($page_id) : false;
    return $status && $status !== 'trash' ? $page_id : 0;
}

/** Whether the current user may change the front page's pictures (= may edit that page). */
function mos_stillingar_can_edit(int $page_id): bool {
    return $page_id > 0 && current_user_can('edit_post', $page_id);
}

/** Position 1 puts the entry above Mælaborð (2). */
function mos_stillingar_register_menu(): void {
    add_menu_page('Stillingar', 'Stillingar', 'edit_pages', MOS_STILLINGAR_SLUG, 'mos_stillingar_render',
        'dashicons-format-image', 1);
}

/** ACF and the Forsíða fields (mos-headless-api.php) are both loaded. */
function mos_stillingar_ready(): bool {
    return function_exists('acf_form') && function_exists('acf_form_head') && function_exists('mos_hero_slide')
        && defined('MOS_HERO_SLIDES') && defined('MOS_BANNER_SLOTS') && defined('MOS_PRODUCT_ROWS');
}

/**
 * The front page's saved state and its layout, read once per request (after acf_form_head(): a save redirects and
 * exits there, so this is always the saved values).
 *
 * @return array{banners: array<int, string>, shown: array<int, bool>, products: array<int, int>, layout: array}
 */
function mos_stillingar_current(int $page_id): array {
    static $current = [];
    if (!isset($current[$page_id])) {
        $state = mos_stillingar_state($page_id);
        $current[$page_id] = $state + ['layout' => mos_stillingar_layout($state['banners'], $state['shown'], MOS_PRODUCT_ROWS)];
    }
    return $current[$page_id];
}

add_action('admin_menu', 'mos_stillingar_register_menu');

// Before any output: ACF saves a submitted form here and redirects back with ?updated=true.
add_action('load-toplevel_page_' . MOS_STILLINGAR_SLUG, static function (): void {
    $page_id = mos_stillingar_front_page_id();
    if (!mos_stillingar_ready() || $page_id === 0) { return; }
    if (!mos_stillingar_can_edit($page_id)) {
        wp_die('Þú hefur ekki heimild til að breyta forsíðunni.', 'Stillingar', ['response' => 403]);
    }
    // ACF already takes the target from its signed form data; this pins it to the page checked above regardless.
    add_filter('acf/pre_submit_form', static function ($form) use ($page_id) {
        if (is_array($form)) { $form['post_id'] = $page_id; }
        return $form;
    });
    acf_form_head();
    acf_enqueue_uploader();
    $layout = mos_stillingar_current($page_id)['layout'];

    $labels = [];
    foreach ($layout['items'] as [$name, , $label]) { if ($label !== null) { $labels[$name] = $label; } }
    add_filter('acf/prepare_field', static function ($field) use ($labels) {
        // `name` is already the form's `acf[<key>]` here; `_name` is the field's own name.
        $name = is_array($field) ? (string) ($field['_name'] ?? '') : '';
        if (isset($labels[$name])) { $field['label'] = $labels[$name]; }
        return $field;
    });
    add_action('admin_head', static fn() => mos_stillingar_styles($layout));
});

/**
 * The fields as a 6-column grid in the layout's order (CSS `order` + column span); the product rows, edited on the
 * Forsíða screen, are grey stand-ins drawn by the grid's ::before / ::after (MOS_STILLINGAR_ROW_STANDINS; one not in
 * the layout is hidden). Cards under the footer (unused slides, empty banners) get a dashed border. Picture shapes
 * follow global.css: the hero ≈ 16:9, a banner tile 4:5, a full-width tile ≈ 14:5.
 *
 * @param array{hero: string, hero_banner: int, items: list<array{0: string, 1: int, 2: ?string}>} $layout
 */
function mos_stillingar_styles(array $layout): void {
    echo '<style>' . mos_stillingar_base_css() . implode("\n", mos_stillingar_layout_css($layout)) . "\n</style>";
}

/**
 * @param array{hero: string, hero_banner: int, items: list<array{0: string, 1: int, 2: ?string}>} $layout
 * @return list<string>
 */
function mos_stillingar_layout_css(array $layout): array {
    $pseudo = ['::row1' => '#mos-stillingar .acf-fields::before', '::row2' => '#mos-stillingar .acf-fields::after'];
    $hero = $layout['hero'] === 'banner' ? "banner_{$layout['hero_banner']}_image" : '';
    $rules = [];
    $after_footer = false;
    foreach ($layout['items'] as $order => [$name, $span]) {
        $field = '#mos-stillingar .acf-fields > [data-name="' . esc_attr($name) . '"]';
        $rules[] = ($pseudo[$name] ?? $field) . " { order: {$order}; grid-column: span {$span}; }";
        unset($pseudo[$name]);
        if ($after_footer) { $rules[] = "{$field} { border-style: dashed !important; }"; }
        if ($name === 'footer_logo') { $after_footer = true; }
        if ($name === $hero) {
            $rules[] = "{$field} img { aspect-ratio: 16 / 9; }";
        } elseif ($span === 6 && strpos($name, 'banner_') === 0) {
            $rules[] = "{$field} img { aspect-ratio: 14 / 5; }";
        }
    }
    foreach ($pseudo as $unused) { $rules[] = "{$unused} { display: none; }"; }
    return $rules;
}

function mos_stillingar_base_css(): string {
    return '
#mos-stillingar { max-width: 640px; }
#mos-stillingar .acf-fields { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; border: 0; background: none; }
#mos-stillingar .acf-fields > .acf-field { width: auto !important; float: none; min-height: 0; margin: 0; padding: 8px 10px; border: 1px solid #c3c4c7 !important; background: #fff; }
#mos-stillingar .acf-field .acf-label { margin-bottom: 6px; }
#mos-stillingar .acf-image-uploader .image-wrap { float: none; width: 100%; max-width: none !important; }
#mos-stillingar .acf-image-uploader.has-value .image-wrap { display: block; }
#mos-stillingar .acf-image-uploader img { display: block; width: 100%; height: auto; max-height: none !important; aspect-ratio: 4 / 5; object-fit: cover; background: #f6f7f7; }
#mos-stillingar [data-name="site_logo"], #mos-stillingar .acf-fields > [data-name="footer_logo"] { display: flex; align-items: center; gap: 16px; }
#mos-stillingar .acf-fields > [data-name="footer_logo"] { background: #111; }
#mos-stillingar [data-name="footer_logo"] .acf-label label { color: #fff; }
#mos-stillingar [data-name="site_logo"] .image-wrap, #mos-stillingar [data-name="footer_logo"] .image-wrap { width: auto; }
#mos-stillingar [data-name="site_logo"] img, #mos-stillingar [data-name="footer_logo"] img { width: auto; max-width: 220px; height: 48px; aspect-ratio: auto; object-fit: contain; background: none; }
#mos-stillingar .acf-fields::before, #mos-stillingar .acf-fields::after { display: flex; align-items: center; justify-content: center; height: 64px; color: #646970;
  border: 1px dashed #c3c4c7; background: repeating-linear-gradient(90deg, #f0f0f1 0 70px, #fff 70px 78px); }
#mos-stillingar .acf-fields::before { content: "Vörulína 1 — breytt á Forsíðu"; }
#mos-stillingar .acf-fields::after { content: "Vörulína 2 — breytt á Forsíðu"; }
#mos-stillingar .acf-form-submit { margin-top: 16px; }
';
}

function mos_stillingar_render(): void {
    $page_id = mos_stillingar_front_page_id();
    echo '<div class="wrap"><h1>Stillingar</h1>';
    if (!mos_stillingar_ready()) {
        echo '<div class="notice notice-error"><p>Advanced Custom Fields og mos-headless-api.php þurfa að vera virk.'
            . '</p></div></div>';
        return;
    }
    if ($page_id === 0) {
        echo '<div class="notice notice-warning"><p>Engin forsíða er valin. Veldu hana í Stillingar → Lestur neðar í '
            . 'valmyndinni (Forsíða sýnir: Ákveðin síða).</p></div></div>';
        return;
    }
    if (!mos_stillingar_can_edit($page_id)) {
        echo '<div class="notice notice-error"><p>Þú hefur ekki heimild til að breyta forsíðunni.</p></div></div>';
        return;
    }
    $state = mos_stillingar_current($page_id);
    $layout = $state['layout'];
    if ($layout['hero'] === 'slides') {
        $top = 'Enginn borði hefur mynd, svo efst á forsíðunni eru vöruglærurnar.';
        foreach (mos_stillingar_hidden_slides($state['products'], $state['shown']) as $slide) {
            echo '<div class="notice notice-warning"><p>Glæra ' . (int) $slide . ' birtist ekki á forsíðunni: varan er '
                . 'ekki birt eða hefur enga mynd. Veldu aðra vöru eða mynd.</p></div>';
        }
    } elseif ($layout['hero'] === 'banner') {
        $top = "Efst á forsíðunni er fyrsti borðinn sem hefur mynd (borði {$layout['hero_banner']}).";
    } else {
        $top = 'Engin mynd er efst á forsíðunni núna.';
    }
    $edit_link = get_edit_post_link($page_id);
    echo '<p>Myndirnar raðast eins og á forsíðunni. ' . esc_html($top) . ' Fyrir neðan fótinn eru glærur sem eru ekki '
        . 'notaðar og tómir borðar; uppröðunin uppfærist þegar þú vistar. Annað efni forsíðu (textar, vörulínur, fótur) '
        . 'er á <a href="' . esc_url((string) $edit_link) . '">Forsíða</a>.</p>';
    acf_form([
        'id'              => 'mos-stillingar',
        'post_id'         => $page_id,
        'fields'          => mos_stillingar_field_keys(MOS_HERO_SLIDES, MOS_BANNER_SLOTS),
        'submit_value'    => 'Vista myndir',
        'updated_message' => 'Myndir vistaðar. Þær birtast á forsíðunni innan fárra mínútna.',
        'html_submit_button' => '<input type="submit" class="button button-primary button-large" value="%s" />',
    ]);
    echo '</div>';
}
