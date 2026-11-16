<?php
/**
 * Plugin Name: MOS Stillingar
 * Description: "Stillingar", the first item of the admin sidebar: the front page's pictures on one screen — header
 *  logo, the banners, each hero slide's product and picture — laid out as a small copy of the storefront's
 *  front page in sections (Haus, Forsíðumynd, Borðar; the unused product slides folded away), with a side panel
 *  that counts unsaved changes and holds the save button. It shows the existing ACF "Forsíða" fields
 *  (mos-headless-api.php) for the front page, so it stores nothing of its own; saving pokes the storefront
 *  (mos_front_page_poke) so the pictures show at once. Texts, product rows and footer stay on the Forsíða edit screen.
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_STILLINGAR_SLUG = 'mos-stillingar';
/** Product rows drawn as grey stand-ins (`.mos-st-row`, built by mos_stillingar_script). */
const MOS_STILLINGAR_ROW_STANDINS = 2;

/**
 * The Forsíða field keys the page shows: the header logo, each hero slide's product and picture, the banner pictures.
 *
 * @return list<string>
 */
function mos_stillingar_field_keys(int $slides, int $banners): array {
    $keys = ['field_mos_site_logo'];
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
 * shown banners paired in order, an odd one out full width); `::footer` marks the page's end. After the footer: the slides when they
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
    $items[] = ['::footer', 6, null];

    if ($hero !== 'slides') { array_push($items, ...$slides(true)); }
    array_push($items, ...$paired($empty, ' — tómur'));
    return ['hero' => $hero, 'hero_banner' => $hero_banner, 'items' => $items];
}

/** Columns (of 6) for each of $count side-by-side cards: 1 → 6, 2 → 3, 3 → 2; more wrap three to a row. */
function mos_stillingar_share(int $count): int {
    return intdiv(6, max(1, min(3, $count)));
}

/**
 * The layout's items grouped into the page's sections, in page order: Haus, Forsíðumynd (the hero: a banner or the
 * slides), Borðar (the story tiles between the product rows), then what the storefront does not show now —
 * Varaforsíða (the slides while a banner is the hero; folded) and Tómir borðar. A section without items is left out.
 * The section heading says what the layout's label suffixes said, so they are dropped here.
 *
 * @param array{hero: string, hero_banner: int, items: list<array{0: string, 1: int, 2: ?string}>} $layout
 * @return list<array{id: string, title: string, note: string, folded: bool, items: list<array{0: string, 1: int, 2: ?string}>}>
 */
function mos_stillingar_sections(array $layout): array {
    $sections = [
        'haus'        => ['Haus', '', false],
        'forsidumynd' => ['Forsíðumynd', $layout['hero'] === 'slides' ? 'Enginn borði hefur mynd, svo vöruglærurnar eru efst á forsíðunni.' : 'Stóra myndin efst á forsíðunni: fyrsti borðinn sem hefur mynd.', false],
        'bordar'      => ['Borðar', 'Raðast í pörum á milli vörulínanna, í þessari röð.', false],
        'varaforsida' => ['Varaforsíða: vöruglærur', 'Sjást aðeins ef enginn borði hefur mynd.', true],
        'tomir'       => ['Tómir borðar', 'Birtast á forsíðunni þegar þeir fá mynd.', false],
    ];
    $hero_field = $layout['hero'] === 'banner' ? "banner_{$layout['hero_banner']}_image" : '';
    $grouped = [];
    $after_footer = false;
    foreach ($layout['items'] as [$name, $span, $label]) {
        if ($name === 'site_logo') { $id = 'haus'; }
        elseif ($name === '::footer') { $after_footer = true; continue; }
        elseif (strpos($name, 'hero_slide_') === 0) { $id = $after_footer ? 'varaforsida' : 'forsidumynd'; }
        elseif ($name === $hero_field) { $id = 'forsidumynd'; }
        else { $id = $after_footer ? 'tomir' : 'bordar'; }
        if ($label !== null) { $label = (string) preg_replace('/ — (forsíðumynd|tómur)$| \(varaforsíða\)$/u', '', $label); }
        $grouped[$id][] = [$name, $span, $label];
    }
    $out = [];
    foreach ($sections as $id => [$title, $note, $folded]) {
        if (!empty($grouped[$id])) { $out[] = ['id' => $id, 'title' => $title, 'note' => $note, 'folded' => $folded, 'items' => $grouped[$id]]; }
    }
    return $out;
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
 * `captions` is each banner's title and link as saved, shown under its picture.
 *
 * @return array{banners: array<int, string>, shown: array<int, bool>, products: array<int, int>, captions: array<int, array{title: string, href: string}>}
 */
function mos_stillingar_state(int $page_id): array {
    $f = static fn(string $name) => get_field($name, $page_id, false);
    $banners = $captions = [];
    for ($i = 1; $i <= MOS_BANNER_SLOTS; $i++) {
        $title = (string) $f("banner_{$i}_title");
        $banners[$i] = mos_image($f("banner_{$i}_image")) ? 'image' : ($title !== '' ? 'text' : 'empty');
        $captions[$i] = ['title' => $title, 'href' => (string) $f("banner_{$i}_link")];
    }
    $shown = $products = [];
    for ($i = 1; $i <= MOS_HERO_SLIDES; $i++) {
        $products[$i] = (int) $f("hero_slide_{$i}_product");
        $slide = mos_hero_slide($products[$i], mos_image($f("hero_slide_{$i}_image")));
        $shown[$i] = $slide !== null && !empty($slide['image']);
    }
    return ['banners' => $banners, 'shown' => $shown, 'products' => $products, 'captions' => $captions];
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
    foreach (mos_stillingar_sections($layout) as $section) {
        foreach ($section['items'] as [$name, , $label]) { if ($label !== null) { $labels[$name] = $label; } }
    }
    add_filter('acf/prepare_field', static function ($field) use ($labels) {
        // `name` is already the form's `acf[<key>]` here; `_name` is the field's own name.
        $name = is_array($field) ? (string) ($field['_name'] ?? '') : '';
        if (isset($labels[$name])) { $field['label'] = $labels[$name]; }
        return $field;
    });
    add_action('admin_head', static function (): void { echo '<style>' . mos_stillingar_base_css() . '</style>'; });
});

/**
 * The page's own styles. Without the script the fields are plain cards in a 6-column grid in ACF's order; the script
 * (mos_stillingar_script) sorts them into the sections and switches on the side panel (`.mos-st--js`).
 * Picture shapes follow global.css: the hero ≈ 16:9, a banner tile 4:5, a full-width tile ≈ 14:5.
 */
function mos_stillingar_base_css(): string {
    return '
.mos-st { --st-line: #dcdcde; --st-ink: #1d2327; --st-meta: #646970; --st-warn: #dba617; }
.mos-st__grid { display: grid; grid-template-columns: minmax(0, 860px) 280px; gap: 24px; align-items: start; margin-top: 16px; }
.mos-st__side { position: sticky; top: 48px; padding: 20px; border: 1px solid var(--st-line); border-radius: 8px; background: #fff; }
.mos-st__side h2 { margin: 0 0 12px; font-size: 14px; }
.mos-st__status { display: flex; align-items: center; gap: 8px; margin: 0 0 16px; color: var(--st-meta); }
.mos-st__status::before { content: ""; flex: none; width: 8px; height: 8px; border-radius: 50%; background: #00a32a; }
.mos-st__status.is-dirty { color: var(--st-ink); font-weight: 600; }
.mos-st__status.is-dirty::before { background: var(--st-warn); }
.mos-st__side .button-primary { display: block; width: 100%; min-height: 40px; margin-bottom: 12px; text-align: center; }
.mos-st__side .mos-st__view { display: block; margin-bottom: 16px; text-decoration: none; }
.mos-st__side p.description { margin: 0; color: var(--st-meta); }
.mos-st:not(.mos-st--js) .mos-st__status { display: none; }
.mos-st--js #mos-stillingar .acf-form-submit { display: none; }

#mos-stillingar .acf-fields { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; border: 0; background: none; }
.mos-st--js #mos-stillingar .acf-fields { display: block; }
#mos-stillingar .acf-field { width: auto !important; float: none; min-height: 0; margin: 0; padding: 12px; border: 1px solid var(--st-line) !important; border-radius: 6px; background: #fff; grid-column: span 3; }
#mos-stillingar .acf-field::before { display: none; }
#mos-stillingar .acf-field.is-changed { border-color: var(--st-warn) !important; box-shadow: 0 0 0 1px var(--st-warn); }
#mos-stillingar .acf-field .acf-label { margin-bottom: 8px; }
#mos-stillingar .acf-field .acf-label label { font-weight: 600; }
#mos-stillingar .acf-image-uploader .image-wrap { float: none; width: 100%; max-width: none !important; }
#mos-stillingar .acf-image-uploader.has-value .image-wrap { display: block; }
#mos-stillingar .acf-image-uploader img { display: block; width: 100%; height: auto; max-height: none !important; aspect-ratio: 4 / 5; object-fit: cover; border-radius: 4px; background: #f6f7f7; }
#mos-stillingar .acf-field.mos-st-wide img { aspect-ratio: 14 / 5; }
#mos-stillingar .acf-field.mos-st-hero img { aspect-ratio: 16 / 9; }
#mos-stillingar [data-name="site_logo"] { display: flex; align-items: center; gap: 16px; }
#mos-stillingar [data-name="site_logo"] .acf-label { margin: 0; }
#mos-stillingar [data-name="site_logo"] .image-wrap { width: auto; }
#mos-stillingar [data-name="site_logo"] img { width: auto; max-width: 220px; height: 48px; aspect-ratio: auto; object-fit: contain; border-radius: 0; background: none; }

.mos-st-sec { margin: 0 0 16px; padding: 16px 20px 20px; border: 1px solid var(--st-line); border-radius: 8px; background: #fff; }
.mos-st-sec > summary, .mos-st-sec__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 0 0 12px; }
.mos-st-sec > summary { cursor: pointer; }
details.mos-st-sec:not([open]) { padding-bottom: 16px; }
details.mos-st-sec:not([open]) > summary { margin-bottom: 0; }
.mos-st-sec__title { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--st-ink); }
.mos-st-sec__note { color: var(--st-meta); }
.mos-st-sec__grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
.mos-st-sec .acf-field { background: #f6f7f7 !important; }
.mos-st-row { grid-column: span 6; display: flex; align-items: center; justify-content: center; min-height: 44px; color: var(--st-meta); border: 1px dashed #c3c4c7; border-radius: 6px;
  background: repeating-linear-gradient(90deg, #f0f0f1 0 70px, #fff 70px 78px); }
.mos-st-caption { margin: 10px 0 0; }
.mos-st-caption strong { display: block; color: var(--st-ink); }
.mos-st-caption span { display: block; overflow: hidden; color: var(--st-meta); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }

.mos-st__boxes { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; max-width: 1164px; margin-top: 8px; }
.mos-st-box { padding: 16px 20px 20px; border: 1px solid var(--st-line); border-radius: 8px; background: #fff; }
.mos-st-box > h2 { margin: 0 0 12px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.mos-st-box > p { margin-top: 0; }

@media (max-width: 1280px) {
  .mos-st__grid { grid-template-columns: minmax(0, 1fr); }
  .mos-st__side { position: sticky; top: auto; bottom: 0; z-index: 10; order: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 12px 16px; border-radius: 8px 8px 0 0; box-shadow: 0 -2px 8px rgba(0, 0, 0, .08); }
  .mos-st__side h2, .mos-st__side p.description { display: none; }
  .mos-st__status { flex: 1 1 auto; margin: 0; }
  .mos-st__side .button-primary { width: auto; margin: 0; padding-inline: 24px; }
  .mos-st__side .mos-st__view { margin: 0; }
}
';
}

/**
 * Sorts the ACF fields into the sections (moving the field nodes; ACF's own handlers are delegated, so they keep
 * working), draws the product-row stand-ins and the banner captions, and counts the fields whose value differs from
 * the saved one for the side panel. `$data` is {sections, captions}; every text is set with textContent.
 */
function mos_stillingar_script(array $data): string {
    return '(function(){
var data=' . wp_json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ';
var form=document.getElementById("mos-stillingar"); if(!form){return;}
var wrap=form.closest(".mos-st"), fields=form.querySelector(".acf-fields"); if(!wrap||!fields){return;}
function el(tag,cls,text){var e=document.createElement(tag); if(cls){e.className=cls;} if(text){e.textContent=text;} return e;}
data.sections.forEach(function(sec){
  var box=el(sec.folded?"details":"section","mos-st-sec"), head=el(sec.folded?"summary":"div",sec.folded?"":"mos-st-sec__head");
  head.appendChild(el("h2","mos-st-sec__title",sec.title)); if(sec.note){head.appendChild(el("span","mos-st-sec__note",sec.note));}
  var grid=el("div","mos-st-sec__grid"); box.appendChild(head); box.appendChild(grid);
  sec.items.forEach(function(item){
    var name=item[0], span=item[1];
    if(name.indexOf("::row")===0){grid.appendChild(el("div","mos-st-row","Vörulína "+name.slice(5)+" (breytt á Forsíðu)")); return;}
    var field=fields.querySelector(":scope > .acf-field[data-name=\""+name+"\"]"); if(!field){return;}
    field.style.gridColumn="span "+span;
    if(sec.id==="forsidumynd"&&name.indexOf("banner_")===0){field.classList.add("mos-st-hero");}
    else if(span===6&&name.indexOf("banner_")===0){field.classList.add("mos-st-wide");}
    var cap=data.captions[name];
    if(cap){var p=el("p","mos-st-caption"); p.appendChild(el("strong","",cap.title||"(enginn titill)")); p.appendChild(el("span","",cap.href||"(enginn tengill)")); field.appendChild(p);}
    grid.appendChild(field);
  });
  fields.appendChild(box);
});
wrap.classList.add("mos-st--js");
var status=wrap.querySelector(".mos-st__status"), saved=new Map();
function inputs(){return form.querySelectorAll(".acf-field[data-name] input[type=hidden][name^=\"acf[\"], .acf-field[data-name] select[name^=\"acf[\"]");}
inputs().forEach(function(i){saved.set(i,i.value);});
function count(){
  var changed=new Set();
  form.querySelectorAll(".acf-field.is-changed").forEach(function(f){f.classList.remove("is-changed");});
  inputs().forEach(function(i){var f=i.closest(".acf-field[data-name]"); if(f&&(saved.has(i)?saved.get(i):"")!==i.value){changed.add(f); f.classList.add("is-changed");}});
  var n=changed.size;
  if(status){status.classList.toggle("is-dirty",n>0); status.textContent=n===0?"Engar óvistaðar breytingar":(n===1?"1 óvistuð breyting":n+" óvistaðar breytingar");}
}
if(window.jQuery){window.jQuery(form).on("change", count);} form.addEventListener("change", count); count();
})();';
}

function mos_stillingar_render(): void {
    echo '<div class="wrap mos-st"><h1>Stillingar</h1>';
    mos_stillingar_render_pictures();
    // Other storefront settings boxes (mos-instagram.php, mos-nav.php) hang here as cards; each checks its own rights.
    echo '<div class="mos-st__boxes">';
    do_action('mos_stillingar_after');
    echo '</div></div>';
}

/** The storefront's home page, for "Skoða forsíðu" (the headless target when set, else this site). */
function mos_stillingar_storefront_url(): string {
    $base = function_exists('mos_headless_target_base') ? mos_headless_target_base() : '';
    return $base !== '' ? $base . '/' : home_url('/');
}

/** The front-page pictures form with its side panel (or why it isn't shown), inside the page's wrap. */
function mos_stillingar_render_pictures(): void {
    $page_id = mos_stillingar_front_page_id();
    if (!mos_stillingar_ready()) {
        echo '<div class="notice notice-error"><p>Advanced Custom Fields og mos-headless-api.php þurfa að vera virk.'
            . '</p></div>';
        return;
    }
    if ($page_id === 0) {
        echo '<div class="notice notice-warning"><p>Engin forsíða er valin. Veldu hana í Stillingar → Lestur neðar í '
            . 'valmyndinni (Forsíða sýnir: Ákveðin síða).</p></div>';
        return;
    }
    if (!mos_stillingar_can_edit($page_id)) {
        echo '<div class="notice notice-error"><p>Þú hefur ekki heimild til að breyta forsíðunni.</p></div>';
        return;
    }
    $state = mos_stillingar_current($page_id);
    $layout = $state['layout'];
    if ($layout['hero'] === 'slides') {
        $top = 'Enginn borði hefur mynd, svo vöruglærurnar eru efst á forsíðunni.';
        foreach (mos_stillingar_hidden_slides($state['products'], $state['shown']) as $slide) {
            echo '<div class="notice notice-warning"><p>Glæra ' . (int) $slide . ' birtist ekki á forsíðunni: varan er '
                . 'ekki birt eða hefur enga mynd. Veldu aðra vöru eða mynd.</p></div>';
        }
    } elseif ($layout['hero'] === 'banner') {
        $top = "Forsíðumyndin er borði {$layout['hero_banner']}, fyrsti borðinn sem hefur mynd.";
    } else {
        $top = 'Engin mynd er efst á forsíðunni núna.';
    }
    // Set by mos_front_page_saved() during the save that redirected here (?updated=true); read once, and only then,
    // so another visit to this page doesn't use it up.
    $poked = isset($_GET['updated']) && function_exists('mos_front_page_poke_result') ? mos_front_page_poke_result() : '';
    $saved_message = $poked === 'ok' ? 'Myndir vistaðar og komnar á vefinn.' : 'Myndir vistaðar. Þær birtast á vefnum innan mínútu.';

    echo '<div class="mos-st__grid"><div class="mos-st__main">';
    acf_form([
        'id'              => 'mos-stillingar',
        'post_id'         => $page_id,
        'fields'          => mos_stillingar_field_keys(MOS_HERO_SLIDES, MOS_BANNER_SLOTS),
        'submit_value'    => 'Vista myndir',
        'updated_message' => $saved_message,
        'html_submit_button' => '<input type="submit" class="button button-primary button-large" value="%s" />',
    ]);
    echo '</div><aside class="mos-st__side"><h2>Forsíða</h2>'
        . '<p class="mos-st__status" role="status"></p>'
        . '<button type="submit" form="mos-stillingar" class="button button-primary button-large">Vista myndir</button>'
        . '<a class="mos-st__view" href="' . esc_url(mos_stillingar_storefront_url()) . '" target="_blank" rel="noopener">Skoða forsíðu ↗</a>'
        . '<p class="description">' . esc_html($top) . ' Myndirnar birtast á vefnum um leið og þú vistar. Textar, '
        . 'vörulínur og fótur eru á <a href="' . esc_url((string) get_edit_post_link($page_id)) . '">Forsíða</a>.</p>'
        . '</aside></div>';

    $captions = [];
    foreach ($state['captions'] as $i => $caption) { $captions["banner_{$i}_image"] = $caption; }
    echo '<script>' . mos_stillingar_script(['sections' => mos_stillingar_sections($layout), 'captions' => $captions]) . '</script>';
}
