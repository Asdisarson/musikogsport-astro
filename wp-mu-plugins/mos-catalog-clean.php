<?php
/**
 * Plugin Name: MOS Catalog Clean
 * Description: Catalog data hygiene and gap-filling for the storefront's filters. Everything is written to
 *  WooCommerce's own fields, so the owner can correct any value in wp-admin:
 *  - Term hygiene: merges duplicate/typo terms (Keflavik → Keflavík, Totttenham → Tottenham, …), tidies names,
 *    moves sports filed under Félag/Lið to Íþrótt, deletes empty duplicate colour terms.
 *  - Gap filling, only where a product has no value yet: brand (product_brand) from pa_vorumerki or the name;
 *    gender (the Karlar/Konur/Börn categories under "Kyn") from pa_kyn/pa_aldur or the name; sport (pa_ithrott)
 *    from the categories or the name; colour (pa_litur) from the name. A value is set only when exactly one rule
 *    matches (colour: the first colour named); everything else is reported, nothing is guessed twice.
 *    Inferred attributes are product-level (not visible on the product page, not used for variations).
 *  - WP-CLI: `wp mos-clean preview` (default, writes nothing), `wp mos-clean apply` (writes, with a journal in
 *    uploads/mos-clean/ that `wp mos-clean restore <file>` replays in reverse).
 *  - New and edited products: the same gap-filling runs at the end of the request, filling empty fields only.
 *  Attribute changes go through WC_Product::save() so the attribute lookup table the Store API filters on stays
 *  in step.
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_CLEAN_GENDER_CATS = ['karlar', 'konur', 'born'];   // product_cat slugs under "Kyn"
// Taxonomies a product snapshot covers (restore puts exactly these back).
const MOS_CLEAN_TRACKED = ['product_cat', 'product_brand', 'pa_felag-lid', 'pa_ithrott', 'pa_litur'];
const MOS_CLEAN_DIR = 'mos-clean';                                 // under wp-content/uploads
const MOS_CLEAN_FILLED_META = '_mos_clean_filled';                 // fields this plugin filled (never refilled)

/* ------------------------------------------------------------------------
 * 1. Rule tables (data, not code: extend these, not the functions below).
 * --------------------------------------------------------------------- */

/**
 * Term hygiene, applied in order. op: merge (products move from→to, then `from` is deleted once unused),
 * rename, move (from this taxonomy's term to another taxonomy's term).
 *
 * @return list<array<string,string>>
 */
function mos_clean_term_ops(): array {
    return [
        ['op' => 'merge', 'tax' => 'pa_felag-lid', 'from' => 'keflavik-2', 'to' => 'keflavik'],
        ['op' => 'merge', 'tax' => 'pa_felag-lid', 'from' => 'totttenham', 'to' => 'tottenham'],
        ['op' => 'merge', 'tax' => 'pa_felag-lid', 'from' => 'blakfelag-hafnarfjardar', 'to' => 'blakfelag-hafnarfjardar-2'],
        ['op' => 'merge', 'tax' => 'pa_felag-lid', 'from' => 'argentina-treyja', 'to' => 'argentina'],
        ['op' => 'merge', 'tax' => 'pa_felag-lid', 'from' => 'euro', 'to' => 'euro24'],
        ['op' => 'rename', 'tax' => 'pa_felag-lid', 'slug' => 'island-iceland', 'name' => 'Ísland'],
        ['op' => 'rename', 'tax' => 'pa_felag-lid', 'slug' => 'musiksport', 'name' => 'Músík & Sport'],
        ['op' => 'rename', 'tax' => 'pa_felag-lid', 'slug' => 'leiknir-reykjavik', 'name' => 'Leiknir Reykjavík'],
        ['op' => 'rename', 'tax' => 'pa_felag-lid', 'slug' => 'vikingur', 'name' => 'Víkingur'],
        ['op' => 'rename', 'tax' => 'pa_felag-lid', 'slug' => 'olympique-lyonnais', 'name' => 'Olympique Lyonnais'],
        ['op' => 'rename', 'tax' => 'pa_felag-lid', 'slug' => 'thor', 'name' => 'Þór'],
        // Sports and garment words that ended up in Félag/Lið.
        ['op' => 'move', 'tax' => 'pa_felag-lid', 'from' => 'fotbolti', 'to_tax' => 'pa_ithrott', 'to' => 'fotbolti'],
        ['op' => 'move', 'tax' => 'pa_felag-lid', 'from' => 'korfubolti', 'to_tax' => 'pa_ithrott', 'to' => 'korfubolti'],
        ['op' => 'move', 'tax' => 'pa_felag-lid', 'from' => 'korfuboltabolur', 'to_tax' => 'pa_ithrott', 'to' => 'korfubolti'],
        ['op' => 'move', 'tax' => 'pa_felag-lid', 'from' => 'fimleikabolur-blar', 'to_tax' => 'pa_ithrott', 'to' => 'fimleikar'],
        ['op' => 'move', 'tax' => 'pa_felag-lid', 'from' => 'fimleikbolur-bleikur', 'to_tax' => 'pa_ithrott', 'to' => 'fimleikar'],
        ['op' => 'merge', 'tax' => 'pa_ithrott', 'from' => 'snowboarding', 'to' => 'snjobretti'],
        ['op' => 'rename', 'tax' => 'pa_ithrott', 'slug' => 'snjobretti', 'name' => 'Snjóbretti'],
        // Colour shades folded into the base colour; "ISLAND" is a team, not a colour.
        ['op' => 'merge', 'tax' => 'pa_litur', 'from' => 'dokkblatt', 'to' => 'blar'],
        ['op' => 'merge', 'tax' => 'pa_litur', 'from' => 'mahagony-red', 'to' => 'raudur'],
        ['op' => 'merge', 'tax' => 'pa_litur', 'from' => 'dusty-pink', 'to' => 'bleikur'],
        ['op' => 'move', 'tax' => 'pa_litur', 'from' => 'island', 'to_tax' => 'pa_felag-lid', 'to' => 'island-iceland'],
        // Two-colour terms typed in capitals (kept as terms: some are used for variations).
        ['op' => 'rename', 'tax' => 'pa_litur', 'slug' => 'blar-hvitur', 'name' => 'Blár/hvítur'],
        ['op' => 'rename', 'tax' => 'pa_litur', 'slug' => 'blar-raudur', 'name' => 'Blár/rauður'],
        ['op' => 'rename', 'tax' => 'pa_litur', 'slug' => 'gulur-blar', 'name' => 'Gulur/blár'],
        ['op' => 'rename', 'tax' => 'pa_litur', 'slug' => 'hvitt-svart', 'name' => 'Hvítt/svart'],
        ['op' => 'rename', 'tax' => 'pa_litur', 'slug' => 'hvitur-graenn', 'name' => 'Hvítur/grænn'],
        ['op' => 'rename', 'tax' => 'pa_litur', 'slug' => 'raudur-hvitur', 'name' => 'Rauður/hvítur'],
        ['op' => 'rename', 'tax' => 'pa_litur', 'slug' => 'svartur-raudur', 'name' => 'Svartur/rauður'],
        // Only reached when the dusty-pink → bleikur merge above was skipped (the term is a variation option).
        ['op' => 'rename', 'tax' => 'pa_litur', 'slug' => 'dusty-pink', 'name' => 'Ljósbleikur'],
    ];
}

/**
 * Category tidy-up, applied in order after the term hygiene. op:
 *  - merge: products move from one category to another; the source is deleted once empty;
 *  - to_attr / to_brand: the category becomes an attribute term / brand on its products, then is deleted;
 *  - sports: every child of `root` becomes its pa_ithrott term (mos_clean_sport_cats()), then the tree is deleted;
 *  - reparent, rename, delete_empty (the default category is never deleted).
 * `fallback`: the category a product gets when the op would leave it with none besides Kyn/sale.
 * Storefront 301s for the removed URLs: MOVED_CATEGORIES in src/lib/paths.ts (keep the two in step).
 *
 * @return list<array<string,mixed>>
 */
function mos_clean_category_ops(): array {
    $clubs = 'lidafatnadur-fatnadur-2';
    return [
        // Clubs first: they may sit under felag-lid, which can only go once it has no subcategories.
        ['op' => 'to_attr', 'from' => 'stjarnan', 'tax' => 'pa_felag-lid', 'to' => 'stjarnan', 'fallback' => $clubs],
        ['op' => 'to_attr', 'from' => 'fh', 'tax' => 'pa_felag-lid', 'to' => 'fh', 'fallback' => $clubs],
        ['op' => 'to_attr', 'from' => 'fimleikafelagid-bjork', 'tax' => 'pa_felag-lid', 'to' => 'bjork', 'fallback' => $clubs],
        ['op' => 'merge', 'from' => 'boltar-2', 'to' => 'boltar-aefingarvorur'],
        ['op' => 'merge', 'from' => 'felag-lid', 'to' => $clubs],
        ['op' => 'to_brand', 'from' => 'didriksons', 'to' => 'didriksons', 'fallback' => 'vetur'],
        ['op' => 'sports', 'root' => 'ithrott'],
        ['op' => 'reparent', 'slug' => 'sumar', 'parent' => 'aefingarvorur'],
        ['op' => 'rename', 'tax' => 'product_cat', 'slug' => 'vetur', 'name' => 'Regn- og vetrarfatnaður'],
        ['op' => 'delete_empty', 'slugs' => ['unisex', 'uncategorized', 'oflokkad']],
    ];
}

/** Terms this plugin may create when a rule needs them: taxonomy → slug → name. */
function mos_clean_created_terms(): array {
    return [
        'pa_ithrott' => ['hjol' => 'Hjól', 'pilates' => 'Pilates'],
        'product_brand' => ['didriksons' => 'Didriksons'],   // the Didriksons category becomes this brand
    ];
}

/** product_cat slug → pa_ithrott slug (gap-filling and the Íþrótt category fold; after the fold some of these
 *  categories no longer exist, which is harmless). */
function mos_clean_sport_cats(): array {
    return [
        'fotbolti' => 'fotbolti', 'fotboltaskor-ithrottaskor' => 'fotbolti', 'fotboltamyndir-og-fl' => 'fotbolti',
        'handbolti' => 'handbolti', 'handboltaskor-ithrottaskor' => 'handbolti',
        'korfubolti' => 'korfubolti', 'korfuboltaskor' => 'korfubolti',
        'hlaup' => 'hlaup', 'hlaup-ithrott' => 'hlaup',
        'sund' => 'sund', 'sundfatnadur-fatnadur-2' => 'sund',
        'fimleikar' => 'fimleikar', 'fimleikar-ithrott' => 'fimleikar', 'fimleikafelagid-bjork' => 'fimleikar',
        'golf' => 'golf', 'joga' => 'yoga', 'frjalsar' => 'frjalsar', 'blak' => 'blak', 'crossfit' => 'crossfit',
        'skidi' => 'skidi', 'snjobretti' => 'snjobretti', 'hjol' => 'hjol', 'pilates-barre' => 'pilates',
    ];
}

/** Name rules: target slug → regexes over folded tokens (see mos_clean_tokens). @return array<string,list<string>> */
function mos_clean_sport_words(): array {
    return [
        'fotbolti' => ['/^fotbolt/', '/^football$/', '/^soccer$/'],
        'handbolti' => ['/^handbolt/', '/^handball$/'],
        'korfubolti' => ['/^korfubolt/', '/^basketball$/'],
        'hlaup' => ['/^hlaup(?!ahjol)/', '/^running$/'],               // hlaupahjól is a kick scooter
        'sund' => ['/^sund/', '/^swim/'],
        'fimleikar' => ['/^fimleik/', '/^gymnastics$/'],
        'golf' => ['/^golf/'],
        'yoga' => ['/^yoga/', '/^joga/'],
        'skidi' => ['/^skid(a|i|um)/', '/^ski$/', '/^skiing$/'],
        'snjobretti' => ['/^snjobrett/', '/^snowboard/'],
        'hjol' => ['/^hjol(?!ask)/', '/^bike$/', '/^cycling$/'],       // hjólaskór are Heelys, not cycling
        'blak' => ['/^blak/', '/^volleyball$/'],
        'frjalsar' => ['/^frjals/'],
        'crossfit' => ['/^crossfit$/'],
    ];
}

/** @return array<string,list<string>> */
function mos_clean_gender_words(): array {
    return [
        'karlar' => ['/^herra/', '/^karla/', '/^men$/', '/^mens$/', '/^kk$/'],
        'konur' => ['/^domu/', '/^kvenna/', '/^kvk$/', '/^konu/', '/^women$/', '/^womens$/', '/^wmns$/', '/^ladies$/'],
        'born' => ['/^barna/', '/^ungbarna/', '/^born$/', '/^kids?$/', '/^jr$/', '/^junior/', '/^boys?$/', '/^girls?$/',
            '/^gs$/', '/^youth$/', '/^baby$/', '/^infants?$/', '/^toddlers?$/'],
    ];
}

/** @return array<string,list<string>> */
function mos_clean_colour_words(): array {
    return [
        'svartur' => ['/^(dokk|ljos)?svart/', '/^(dokk|ljos)?svort/', '/^black$/'],
        'hvitur' => ['/^hvit/', '/^white$/'],
        'blar' => ['/^(dokk|ljos)?bla(r|tt|ir|ar|um|a)?$/', '/^blue$/', '/^navy$/'],
        'bleikur' => ['/^(ljos)?bleik/', '/^pink$/', '/^rose$/'],
        'graenn' => ['/^(dokk|ljos)?graen/', '/^green$/'],
        'raudur' => ['/^(dokk|ljos)?raud/', '/^red$/'],
        'grar' => ['/^(dokk|ljos)?gra(r|tt|ir|ar|um|a)?$/', '/^gr[ae]y$/'],
        'gulur' => ['/^gul(ur|t|ir|ar|a|um)?$/', '/^yellow$/'],
        'fjolublar' => ['/^fjolubla/', '/^purple$/', '/^violet$/'],
        'brunn' => ['/^(dokk|ljos)?brun(n|t|ir|ar|a|um)?$/', '/^brown$/'],
        'appelsinugulur' => ['/^appelsinugul/', '/^orange$/'],
    ];
}

/** Name tokens that mean "several colours": no colour is inferred. */
const MOS_CLEAN_MULTI_COLOUR = ['litir', 'litum', 'multi', 'multicolor', 'multicolour', 'assorted'];

/* ------------------------------------------------------------------------
 * 2. Pure helpers (no WordPress calls; tests/mos_clean_rules_test.php).
 * --------------------------------------------------------------------- */

/** Lowercase, entities decoded, Icelandic letters folded to ASCII ("Fótboltaskór" → "fotboltaskor").
 *  Keep in step with searchFold() in src/lib/archiveNav.ts. */
function mos_clean_fold(string $s): string {
    $s = mb_strtolower(html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8'), 'UTF-8');
    return strtr($s, [
        'á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ý' => 'y', 'ð' => 'd', 'þ' => 'th',
        'æ' => 'ae', 'ö' => 'o', 'ø' => 'o', 'å' => 'a', 'ä' => 'a', 'ü' => 'u', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
        'ï' => 'i', 'ô' => 'o', 'ñ' => 'n', 'ç' => 'c', '´' => '', '’' => '', "'" => '',
    ]);
}

/** @return list<string> folded words, in order */
function mos_clean_tokens(string $s): array {
    return array_values(array_filter(preg_split('/[^a-z0-9]+/', mos_clean_fold($s)) ?: [], 'strlen'));
}

/** A comparison key: folded, letters and digits only ("Chilly´s" = "chillys", "G-FORM" = "gform"). */
function mos_clean_key(string $s): string {
    return (string) preg_replace('/[^a-z0-9]+/', '', mos_clean_fold($s));
}

/**
 * Targets whose rules match any token, ordered by the first token that matched.
 *
 * @param list<string> $tokens
 * @param array<string,list<string>> $rules
 * @return list<string>
 */
function mos_clean_match(array $tokens, array $rules): array {
    $first = [];
    foreach ($tokens as $pos => $token) {
        foreach ($rules as $target => $patterns) {
            if (isset($first[$target])) { continue; }
            foreach ($patterns as $re) {
                if (preg_match($re, $token)) { $first[$target] = $pos; break; }
            }
        }
    }
    asort($first);
    return array_keys($first);
}

/**
 * Gender categories from pa_aldur / pa_kyn: children go to Börn; Karl/Kona map across; adult Unisex is both.
 *
 * @param list<string> $kyn pa_kyn slugs
 * @param list<string> $aldur pa_aldur slugs
 * @return list<string> category slugs (possibly empty)
 */
function mos_clean_gender_from_attrs(array $kyn, array $aldur): array {
    if (in_array('born', $aldur, true)) { return ['born']; }
    $out = [];
    if (in_array('karl', $kyn, true) || in_array('unisex', $kyn, true)) { $out[] = 'karlar'; }
    if (in_array('kona', $kyn, true) || in_array('unisex', $kyn, true)) { $out[] = 'konur'; }
    return $out;
}

/**
 * A brand named at the start of the product name ("SPEEDO BOYS DIVE …" → speedo), from the first one to three words.
 *
 * @param list<string> $tokens
 * @param array<string,string> $brand_keys key → brand slug
 */
function mos_clean_brand_from_name(array $tokens, array $brand_keys): ?string {
    $found = [];
    for ($n = 1; $n <= min(3, count($tokens)); $n++) {
        $key = implode('', array_slice($tokens, 0, $n));
        if (isset($brand_keys[$key])) { $found[$brand_keys[$key]] = true; }
    }
    return count($found) === 1 ? (string) array_key_first($found) : null;
}

/**
 * What to fill in for one product. Facts in, decisions out; a field is only decided when the product has none.
 *
 * @param array{name:string,cats:list<string>,has_brand:bool,vorumerki:list<string>,kyn:list<string>,
 *   aldur:list<string>,has_sport:bool,has_colour:bool} $f
 * @param array<string,string> $brand_keys normalised key → product_brand slug
 * @return array{brand:?string,brand_new:?string,gender:list<string>,sport:?string,colour:?string,conflicts:array<string,list<string>>}
 */
function mos_clean_decide(array $f, array $brand_keys): array {
    $tokens = mos_clean_tokens($f['name']);
    $out = ['brand' => null, 'brand_new' => null, 'gender' => [], 'sport' => null, 'colour' => null, 'conflicts' => []];

    if (!$f['has_brand']) {
        $from_attr = [];
        $unknown = [];
        foreach ($f['vorumerki'] as $name) {
            $key = mos_clean_key($name);
            if ($key === '') { continue; }
            if (isset($brand_keys[$key])) { $from_attr[$brand_keys[$key]] = true; } else { $unknown[$key] = $name; }
        }
        if (count($from_attr) === 1 && !$unknown) {
            $out['brand'] = (string) array_key_first($from_attr);
        } elseif (!$from_attr && count($unknown) === 1) {
            $out['brand_new'] = (string) reset($unknown);   // a brand term to create from the pa_vorumerki name
        } elseif ($from_attr || $unknown) {
            $out['conflicts']['brand'] = array_merge(array_keys($from_attr), array_values($unknown));
        } else {
            $out['brand'] = mos_clean_brand_from_name($tokens, $brand_keys);
        }
    }

    if (!array_intersect($f['cats'], MOS_CLEAN_GENDER_CATS)) {
        $gender = mos_clean_gender_from_attrs($f['kyn'], $f['aldur']);
        if (!$gender) {
            $words = mos_clean_match($tokens, mos_clean_gender_words());
            if (count($words) === 1) { $gender = $words; }
            elseif ($words) { $out['conflicts']['gender'] = $words; }
        }
        $out['gender'] = $gender;
    }

    if (!$f['has_sport']) {
        $map = mos_clean_sport_cats();
        $from_cats = array_values(array_unique(array_values(array_intersect_key($map, array_flip($f['cats'])))));
        if (count($from_cats) === 1) {
            $out['sport'] = $from_cats[0];
        } elseif ($from_cats) {
            $out['conflicts']['sport'] = $from_cats;
        } else {
            $words = mos_clean_match($tokens, mos_clean_sport_words());
            if (count($words) === 1) { $out['sport'] = $words[0]; }
            elseif ($words) { $out['conflicts']['sport'] = $words; }
        }
    }

    if (!$f['has_colour'] && !array_intersect($tokens, MOS_CLEAN_MULTI_COLOUR)) {
        $colours = mos_clean_match($tokens, mos_clean_colour_words());
        $out['colour'] = $colours[0] ?? null;   // "Black/Grey" → the first colour named
    }
    return $out;
}

/** "TABEDESIGN" → "Tabedesign"; mixed-case names are kept as typed. */
function mos_clean_brand_display_name(string $name): string {
    $name = trim(html_entity_decode($name, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    return ($name === mb_strtoupper($name, 'UTF-8') && mb_strlen($name, 'UTF-8') > 3)
        ? mb_convert_case(mb_strtolower($name, 'UTF-8'), MB_CASE_TITLE, 'UTF-8')
        : $name;
}

/** Whether a product left with these category ids has none besides the ignored ones (Kyn, sale).
 *  @param int[] $remaining @param int[] $ignored */
function mos_clean_needs_fallback(array $remaining, array $ignored): bool {
    return array_diff($remaining, $ignored) === [];
}

/** The pa_ithrott slug a sports category folds into, or null. */
function mos_clean_sport_for_category(string $slug): ?string {
    return mos_clean_sport_cats()[$slug] ?? null;
}

/* ------------------------------------------------------------------------
 * 3. WordPress readers and writers.
 * --------------------------------------------------------------------- */

/** @return list<string> slugs of a product's terms in $tax */
function mos_clean_slugs(int $id, string $tax): array {
    $terms = get_the_terms($id, $tax);
    return is_array($terms) ? array_values(array_map(static fn ($t) => (string) $t->slug, $terms)) : [];
}

/** normalised key → product_brand slug, from every brand's name and slug. @return array<string,string> */
function mos_clean_brand_keys(): array {
    $keys = [];
    $ambiguous = [];
    $terms = get_terms(['taxonomy' => 'product_brand', 'hide_empty' => false]);
    foreach (is_array($terms) ? $terms : [] as $t) {
        foreach ([mos_clean_key($t->name), mos_clean_key($t->slug)] as $key) {
            // Two brands with the same key ("Kari Traa" and "Karitraa") match neither: guessing could pick the wrong one.
            if (isset($keys[$key]) && $keys[$key] !== $t->slug) { $ambiguous[$key] = true; }
            $keys[$key] = $t->slug;
        }
    }
    return array_diff_key($keys, $ambiguous, ['' => true]);
}

/** @return array{name:string,cats:list<string>,has_brand:bool,vorumerki:list<string>,kyn:list<string>,aldur:list<string>,has_sport:bool,has_colour:bool} */
function mos_clean_facts(WC_Product $p): array {
    $id = $p->get_id();
    $vorumerki = get_the_terms($id, 'pa_vorumerki');
    $has_colour = mos_clean_slugs($id, 'pa_litur') !== [];
    foreach ($p->get_attributes() as $attr) {
        if (!$attr->is_taxonomy() && mos_clean_key($attr->get_name()) === 'litur') { $has_colour = true; }
    }
    return [
        'name' => $p->get_name(),
        'cats' => mos_clean_slugs($id, 'product_cat'),
        'has_brand' => mos_clean_slugs($id, 'product_brand') !== [],
        'vorumerki' => is_array($vorumerki) ? array_values(array_map(static fn ($t) => (string) $t->name, $vorumerki)) : [],
        'kyn' => mos_clean_slugs($id, 'pa_kyn'),
        'aldur' => mos_clean_slugs($id, 'pa_aldur'),
        'has_sport' => mos_clean_slugs($id, 'pa_ithrott') !== [],
        'has_colour' => $has_colour,
    ];
}

/** A term id by slug, created from mos_clean_created_terms() when allowed and missing; null otherwise. */
function mos_clean_term_id(string $tax, string $slug, ?MOS_Clean_Journal $journal = null, ?string $create_name = null): ?int {
    $term = get_term_by('slug', $slug, $tax);
    if ($term instanceof WP_Term) { return (int) $term->term_id; }
    $create_name ??= mos_clean_created_terms()[$tax][$slug] ?? null;
    if ($create_name === null || $journal === null) { return null; }
    $made = wp_insert_term($create_name, $tax, ['slug' => $slug]);
    if (is_wp_error($made)) { error_log("mos-catalog-clean: could not create $tax/$slug: " . $made->get_error_message()); return null; }
    $journal->created($tax, (int) $made['term_id']);
    return (int) $made['term_id'];
}

/**
 * Set a product's term ids for a global attribute (added as a hidden, non-variation attribute when missing,
 * removed when $ids is empty). Variation attributes are never touched.
 *
 * @param int[] $ids
 * @return bool false when the attribute is used for variations
 */
function mos_clean_set_attribute(WC_Product $p, string $tax, array $ids): bool {
    $attrs = $p->get_attributes();
    $attr = $attrs[$tax] ?? null;
    if ($attr instanceof WC_Product_Attribute && $attr->get_variation()) { return false; }
    // A copy: changing the product's own attribute object in place leaves set_attributes() seeing no change,
    // and save() would then skip the attributes.
    if ($attr instanceof WC_Product_Attribute) { $attr = clone $attr; }
    $ids = array_values(array_unique(array_map('intval', $ids)));
    if (!$ids) {
        unset($attrs[$tax]);
    } else {
        if (!$attr instanceof WC_Product_Attribute) {
            $attr = new WC_Product_Attribute();
            $attr->set_id((int) wc_attribute_taxonomy_id_by_name($tax));
            $attr->set_name($tax);
            $attr->set_visible(false);
            $attr->set_variation(false);
            $attr->set_position(count($attrs));
        }
        $attr->set_options($ids);
        $attrs[$tax] = $attr;
    }
    $p->set_attributes($attrs);
    return true;
}

/** @return int[] a product's term ids for a global attribute, as the product object holds them */
function mos_clean_attribute_ids(WC_Product $p, string $tax): array {
    $attr = $p->get_attributes()[$tax] ?? null;
    return $attr instanceof WC_Product_Attribute ? array_map('intval', $attr->get_options()) : [];
}

/** Products (any status) carrying a term. @return int[] */
function mos_clean_products_with(string $tax, int $term_id): array {
    $ids = get_objects_in_term($term_id, $tax);
    if (!is_array($ids)) { return []; }
    return array_values(array_filter(array_map('intval', $ids), static fn ($id) => get_post_type($id) === 'product'));
}

/** Report a problem to the operator (WP-CLI) or the error log (web requests). */
function mos_clean_warn(string $message): void {
    if (defined('WP_CLI') && WP_CLI) { WP_CLI::warning($message); return; }
    error_log("mos-catalog-clean: $message");
}

/** Drop cached counts: Woo's filter-data transients (and product transients for the changed ids). Never throws. */
function mos_clean_invalidate_caches(array $ids = []): void {
    try {
        foreach ($ids as $id) { wc_delete_product_transients((int) $id); }
        $class = \Automattic\WooCommerce\Internal\ProductFilters\CacheController::class;
        if (function_exists('wc_get_container') && class_exists($class) && method_exists($class, 'invalidate_filter_data_cache')) {
            wc_get_container()->get($class)->invalidate_filter_data_cache();
        }
    } catch (\Throwable $e) {
        mos_clean_warn('cache invalidation failed: ' . $e->getMessage());
    }
}

/** Delete a term and journal it; false (and a warning) when WordPress refuses. */
function mos_clean_delete_term(WP_Term $t, MOS_Clean_Journal $journal): bool {
    $done = wp_delete_term((int) $t->term_id, $t->taxonomy);
    if ($done !== true) {
        mos_clean_warn("could not delete {$t->taxonomy}/{$t->slug}" . (is_wp_error($done) ? ': ' . $done->get_error_message() : ''));
        return false;
    }
    $journal->deleted($t);
    $journal->save();
    return true;
}

/**
 * The journal behind `restore`: product snapshots (taken before the first write to a product), created terms,
 * renames and deleted terms. Written to disk after every batch so an interrupted run can still be restored.
 */
final class MOS_Clean_Journal {
    /** @var array<string,mixed> */
    private array $data = ['version' => 1, 'products' => [], 'created' => [], 'renamed' => [], 'deleted' => [], 'reparented' => []];

    public function __construct(private ?string $file) {
        $this->data['started'] = gmdate('c');
    }

    public function snapshot(int $id): void {
        if ($id <= 0 || isset($this->data['products'][$id])) { return; }
        $terms = [];
        foreach (MOS_CLEAN_TRACKED as $tax) { $terms[$tax] = mos_clean_slugs($id, $tax); }
        $this->data['products'][$id] = [
            'attributes' => get_post_meta($id, '_product_attributes', true),
            'terms' => $terms,
            'filled' => mos_clean_filled($id),
        ];
    }

    public function created(string $tax, int $term_id): void { $this->data['created'][] = ['tax' => $tax, 'term_id' => $term_id]; }

    public function renamed(string $tax, int $term_id, string $old): void { $this->data['renamed'][] = ['tax' => $tax, 'term_id' => $term_id, 'name' => $old]; }

    public function deleted(WP_Term $t): void {
        $parent = $t->parent ? get_term((int) $t->parent, $t->taxonomy) : null;
        $this->data['deleted'][] = ['tax' => $t->taxonomy, 'slug' => $t->slug, 'name' => $t->name, 'description' => $t->description,
            'parent' => $parent instanceof WP_Term ? $parent->slug : ''];
    }

    public function reparented(WP_Term $t): void {
        $parent = $t->parent ? get_term((int) $t->parent, $t->taxonomy) : null;
        $this->data['reparented'][] = ['tax' => $t->taxonomy, 'term_id' => (int) $t->term_id, 'parent' => $parent instanceof WP_Term ? $parent->slug : ''];
    }

    public function save(): void {
        if ($this->file === null) { return; }
        $json = wp_json_encode($this->data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($json === false || file_put_contents($this->file, $json) === false) {
            throw new RuntimeException("could not write the journal {$this->file}");
        }
    }

    public function product_count(): int { return count($this->data['products']); }
}

/**
 * Run the term hygiene ops. Products whose attribute is used for variations are skipped and reported; a merged
 * or moved term is deleted only once nothing carries it. The journal is saved after every op.
 *
 * @return array{changed:int[],skipped:list<string>,log:list<string>}
 */
function mos_clean_run_term_ops(?MOS_Clean_Journal $journal): array {
    $dry = $journal === null;
    $changed = [];
    $skipped = [];
    $log = [];
    $emptied = [];   // term ids an op empties (in a preview: would empty)
    foreach (mos_clean_term_ops() as $op) {
        $tax = $op['tax'];
        if (!taxonomy_exists($tax)) { $log[] = "skip {$op['op']} $tax: taxonomy missing"; continue; }
        if ($op['op'] === 'rename') {
            $line = mos_clean_rename_term($op, $journal);
            if ($line !== null) { $log[] = $line; }
            continue;
        }
        $from = get_term_by('slug', $op['from'], $tax);
        if (!$from instanceof WP_Term) { continue; }
        $r = mos_clean_move_products($op, $from, $journal);
        $log[] = $r['log'];
        $skipped = array_merge($skipped, $r['skipped']);
        $changed += array_fill_keys($r['changed'], true);
        if ($dry ? ($r['moved'] && !$r['skipped']) : get_objects_in_term((int) $from->term_id, $tax) === []) {
            $emptied[(int) $from->term_id] = true;
            $log[] = "delete $tax/{$op['from']}";
            if (!$dry) { mos_clean_delete_term($from, $journal); }
        }
        $journal?->save();
    }
    $log[] = 'delete pa_litur terms nothing uses: ' . mos_clean_delete_unused_colours($journal, $emptied);
    return ['changed' => array_keys($changed), 'skipped' => $skipped, 'log' => $log];
}

/** Rename one term to its proper name. @return string|null the log line, null when already right */
function mos_clean_rename_term(array $op, ?MOS_Clean_Journal $journal): ?string {
    $term = get_term_by('slug', $op['slug'], $op['tax']);
    if (!$term instanceof WP_Term) { return null; }
    $name = html_entity_decode($term->name, ENT_QUOTES, 'UTF-8');
    if ($name === $op['name']) { return null; }
    $line = sprintf('rename %s "%s" → "%s"', $op['tax'], $name, $op['name']);
    if ($journal === null) { return $line; }
    $done = wp_update_term((int) $term->term_id, $op['tax'], ['name' => $op['name']]);
    if (is_wp_error($done)) {
        mos_clean_warn("$line failed: " . $done->get_error_message());
        return "$line (failed)";
    }
    $journal->renamed($op['tax'], (int) $term->term_id, $term->name);
    return $line;
}

/**
 * Move every product off a merge/move op's source term onto its target. A preview ($journal null) only counts.
 *
 * @return array{changed:int[],skipped:list<string>,moved:bool,log:string}
 */
function mos_clean_move_products(array $op, WP_Term $from, ?MOS_Clean_Journal $journal): array {
    $tax = $op['tax'];
    $to_tax = $op['op'] === 'move' ? $op['to_tax'] : $tax;
    $to_id = mos_clean_term_id($to_tax, $op['to'], $journal);
    // A preview creates nothing, so a target this plugin would create counts as there.
    $exists = $to_id !== null || ($journal === null && isset(mos_clean_created_terms()[$to_tax][$op['to']]));
    if (!$exists) {
        return ['changed' => [], 'skipped' => [], 'moved' => false, 'log' => "skip {$op['op']} $tax/{$op['from']}: target $to_tax/{$op['to']} missing"];
    }
    $ids = mos_clean_products_with($tax, (int) $from->term_id);
    $changed = [];
    $skipped = [];
    foreach ($ids as $id) {
        $p = wc_get_product($id);
        if (!$p instanceof WC_Product) { continue; }
        if (($p->get_attributes()[$tax] ?? null)?->get_variation()) {
            $skipped[] = "$id {$op['op']} $tax/{$op['from']}: used for variations";
            continue;
        }
        if ($journal === null) { $changed[] = $id; continue; }
        try {
            $journal->snapshot($id);
            $rest = array_values(array_diff(mos_clean_attribute_ids($p, $tax), [(int) $from->term_id]));
            if ($op['op'] === 'merge') {
                mos_clean_set_attribute($p, $tax, array_merge($rest, [$to_id]));
            } else {
                if (!mos_clean_set_attribute($p, $to_tax, array_merge(mos_clean_attribute_ids($p, $to_tax), [$to_id]))) {
                    $skipped[] = "$id move to $to_tax: target attribute used for variations";
                    continue;
                }
                mos_clean_set_attribute($p, $tax, $rest);
            }
            $p->save();
            $changed[] = $id;
        } catch (\Throwable $e) {
            $skipped[] = "$id {$op['op']} $tax/{$op['from']}: " . $e->getMessage();
        }
    }
    $log = sprintf('%s %s/%s → %s/%s: %d products', $op['op'], $tax, $op['from'], $to_tax, $op['to'], count($ids));
    return ['changed' => $changed, 'skipped' => $skipped, 'moved' => true, 'log' => $log];
}

/**
 * Delete the colour terms nothing uses (English and spelling duplicates of the Icelandic ones).
 *
 * @param array<int,true> $emptied terms the ops above emptied (or, in a preview, would empty): not counted twice
 * @return int how many were (or would be) deleted
 */
function mos_clean_delete_unused_colours(?MOS_Clean_Journal $journal, array $emptied): int {
    $terms = get_terms(['taxonomy' => 'pa_litur', 'hide_empty' => false]);
    $n = 0;
    foreach (is_array($terms) ? $terms : [] as $t) {
        if (isset($emptied[(int) $t->term_id]) || get_objects_in_term((int) $t->term_id, 'pa_litur') !== []) { continue; }
        if ($journal === null || mos_clean_delete_term($t, $journal)) { $n++; }
    }
    return $n;
}

/**
 * Run the category tidy-up (mos_clean_category_ops). A preview ($journal null) only counts. A source category is
 * deleted once nothing carries it; products whose target attribute is used for variations keep the category.
 *
 * @return array{changed:int[],skipped:list<string>,log:list<string>}
 */
function mos_clean_run_category_ops(?MOS_Clean_Journal $journal): array {
    $changed = [];
    $skipped = [];
    $log = [];
    $emptied = [];   // term ids emptied (in a preview: that would be)
    foreach (mos_clean_expand_category_ops() as $op) {
        if ($op['op'] === 'rename') {
            $line = mos_clean_rename_term($op, $journal);
            if ($line !== null) { $log[] = $line; }
        } elseif ($op['op'] === 'reparent') {
            $line = mos_clean_reparent_category($op, $journal);
            if ($line !== null) { $log[] = $line; }
        } elseif ($op['op'] === 'delete_empty') {
            foreach ($op['slugs'] as $slug) {
                $line = mos_clean_delete_empty_category($slug, $journal, $emptied);
                if ($line !== null) { $log[] = $line; }
            }
        } else {
            $from = get_term_by('slug', $op['from'], 'product_cat');
            if (!$from instanceof WP_Term) { continue; }
            $r = mos_clean_move_category($op, $from, $journal);
            $log[] = $r['log'];
            $skipped = array_merge($skipped, $r['skipped']);
            $changed += array_fill_keys($r['changed'], true);
            $subcategories = get_term_children((int) $from->term_id, 'product_cat');
            $is_empty = $journal === null ? !$r['skipped'] : mos_clean_products_with('product_cat', (int) $from->term_id) === [];
            if (!$r['moved']) {
                // target missing: logged by mos_clean_move_category, the category stays
            } elseif (is_array($subcategories) && array_diff(array_map('intval', $subcategories), array_keys($emptied))) {
                // Deleting it would lift its subcategories to the top level, which the journal can't put back.
                $log[] = "keep product_cat/{$op['from']}: still has subcategories";
            } elseif (!$is_empty) {
                $log[] = "keep product_cat/{$op['from']}: still has products";
            } elseif ($journal === null || mos_clean_delete_term($from, $journal)) {
                $log[] = "delete product_cat/{$op['from']}";
                $emptied[(int) $from->term_id] = true;
            }
        }
        $journal?->save();
    }
    if ($journal !== null && function_exists('wc_recount_all_terms')) { wc_recount_all_terms(); }
    return ['changed' => array_keys($changed), 'skipped' => $skipped, 'log' => $log];
}

/** mos_clean_category_ops() with each `sports` op expanded into one to_attr op per child, then the root's delete. */
function mos_clean_expand_category_ops(): array {
    $ops = [];
    foreach (mos_clean_category_ops() as $op) {
        if ($op['op'] !== 'sports') { $ops[] = $op; continue; }
        $root = get_term_by('slug', $op['root'], 'product_cat');
        if (!$root instanceof WP_Term) { continue; }
        $children = get_terms(['taxonomy' => 'product_cat', 'parent' => (int) $root->term_id, 'hide_empty' => false]);
        foreach (is_array($children) ? $children : [] as $child) {
            $sport = mos_clean_sport_for_category($child->slug);
            $ops[] = $sport === null
                ? ['op' => 'delete_empty', 'slugs' => [$child->slug]]
                : ['op' => 'to_attr', 'from' => $child->slug, 'tax' => 'pa_ithrott', 'to' => $sport];
        }
        $ops[] = ['op' => 'delete_empty', 'slugs' => [$op['root']]];
    }
    return $ops;
}

/**
 * Move every product off one category: onto another category (merge), an attribute term (to_attr) or a brand
 * (to_brand); a product left with no category besides Kyn/sale gets the op's fallback.
 *
 * @return array{changed:int[],skipped:list<string>,moved:bool,log:string}
 */
function mos_clean_move_category(array $op, WP_Term $from, ?MOS_Clean_Journal $journal): array {
    $kind = $op['op'];
    $target_tax = ['merge' => 'product_cat', 'to_attr' => $op['tax'] ?? '', 'to_brand' => 'product_brand'][$kind] ?? '';
    $to_id = taxonomy_exists($target_tax) ? mos_clean_term_id($target_tax, $op['to'], $journal) : null;
    $fallback_id = isset($op['fallback']) ? mos_clean_term_id('product_cat', $op['fallback']) : null;
    $label = sprintf('%s product_cat/%s → %s/%s', $kind, $op['from'], $target_tax, $op['to']);
    // A preview creates nothing, so a target this plugin would create counts as there (-1).
    if ($to_id === null && $journal === null && isset(mos_clean_created_terms()[$target_tax][$op['to']])) { $to_id = -1; }
    if ($to_id === null || (isset($op['fallback']) && $fallback_id === null)) {
        return ['changed' => [], 'skipped' => [], 'moved' => false, 'log' => "skip $label: target missing"];
    }
    $ignored = mos_clean_ignored_category_ids();
    $ids = mos_clean_products_with('product_cat', (int) $from->term_id);
    $changed = [];
    $skipped = [];
    $fallbacks = 0;
    $orphans = 0;   // left with no category but Kyn/sale (WooCommerce then files them under the default category)
    foreach ($ids as $id) {
        $p = wc_get_product($id);
        if (!$p instanceof WC_Product) { continue; }
        $variation = $kind === 'to_attr' && ($p->get_attributes()[$target_tax] ?? null)?->get_variation();
        if ($variation && !in_array($to_id, mos_clean_attribute_ids($p, $target_tax), true)) {
            $skipped[] = "$id $label: used for variations";
            continue;
        }
        $rest = array_values(array_diff(array_map('intval', $p->get_category_ids()), [(int) $from->term_id]));
        if ($kind === 'merge') { $rest[] = $to_id; }
        if (mos_clean_needs_fallback($rest, $ignored)) {
            if ($fallback_id !== null) { $rest[] = $fallback_id; $fallbacks++; } else { $orphans++; }
        }
        if ($journal === null) { $changed[] = $id; continue; }
        try {
            $journal->snapshot($id);
            if ($kind === 'to_attr' && !$variation) {   // a variation attribute already carrying the term stays as it is
                mos_clean_set_attribute($p, $target_tax, array_merge(mos_clean_attribute_ids($p, $target_tax), [$to_id]));
            }
            $before = array_map('intval', $p->get_category_ids());
            $p->set_category_ids(array_values(array_unique($rest)));
            $p->save();
            // product_brand is not part of WC_Product's data, so it is set after the save (as in fill_product); if
            // that fails the category goes back, so the product never ends up with neither.
            if ($kind === 'to_brand') {
                $done = wp_set_object_terms($id, [$to_id], 'product_brand', true);
                if (is_wp_error($done)) {
                    $p->set_category_ids($before);
                    $p->save();
                    throw new RuntimeException($done->get_error_message());
                }
            }
            $changed[] = $id;
        } catch (\Throwable $e) {
            $skipped[] = "$id $label: " . $e->getMessage();
        }
    }
    $log = sprintf('%s: %d of %d products%s%s', $label, count($changed), count($ids),
        $fallbacks ? " ($fallbacks get fallback {$op['fallback']})" : '', $orphans ? " ($orphans left with no category)" : '');
    return ['changed' => $changed, 'skipped' => $skipped, 'moved' => true, 'log' => $log];
}

/** Kyn (and its children) and the sale category: a product in only these has no real category. @return int[] */
function mos_clean_ignored_category_ids(): array {
    $ids = [];
    foreach (['kyn', 'sale'] as $slug) {
        $t = get_term_by('slug', $slug, 'product_cat');
        if (!$t instanceof WP_Term) { continue; }
        $ids[] = (int) $t->term_id;
        $children = get_term_children((int) $t->term_id, 'product_cat');
        if (is_array($children)) { $ids = array_merge($ids, array_map('intval', $children)); }
    }
    return $ids;
}

/** Move a category under another parent (its slug, and so its storefront URL's last part, stays). */
function mos_clean_reparent_category(array $op, ?MOS_Clean_Journal $journal): ?string {
    $term = get_term_by('slug', $op['slug'], 'product_cat');
    $parent = get_term_by('slug', $op['parent'], 'product_cat');
    if (!$term instanceof WP_Term || !$parent instanceof WP_Term || (int) $term->parent === (int) $parent->term_id) { return null; }
    $line = "reparent product_cat/{$op['slug']} under {$op['parent']}";
    if ($journal === null) { return $line; }
    $old = clone $term;
    $done = wp_update_term((int) $term->term_id, 'product_cat', ['parent' => (int) $parent->term_id]);
    if (is_wp_error($done)) {
        mos_clean_warn("$line failed: " . $done->get_error_message());
        return "$line (failed)";
    }
    $journal->reparented($old);
    return $line;
}

/** Delete a category nothing carries (never the default category).
 *  @param array<int,true> $emptied categories already emptied/deleted in this run (a preview deletes nothing) */
function mos_clean_delete_empty_category(string $slug, ?MOS_Clean_Journal $journal, array &$emptied): ?string {
    $t = get_term_by('slug', $slug, 'product_cat');
    if (!$t instanceof WP_Term) { return null; }
    if ((int) $t->term_id === (int) get_option('default_product_cat')) { return "keep product_cat/$slug: the default category"; }
    if (!isset($emptied[(int) $t->term_id]) && mos_clean_products_with('product_cat', (int) $t->term_id) !== []) {
        return "keep product_cat/$slug: still has products";
    }
    $children = get_term_children((int) $t->term_id, 'product_cat');
    if (is_array($children) && array_diff(array_map('intval', $children), array_keys($emptied))) {
        return "keep product_cat/$slug: still has subcategories";
    }
    if ($journal !== null && !mos_clean_delete_term($t, $journal)) { return "delete product_cat/$slug (failed)"; }
    $emptied[(int) $t->term_id] = true;
    return "delete product_cat/$slug";
}

/**
 * Fill one product's empty fields. Returns what was (or, dry, would be) set; never overwrites a value.
 *
 * @return array{set:array<string,string>,conflicts:array<string,list<string>>}
 */
function mos_clean_fill_product(WC_Product $p, array $brand_keys, ?MOS_Clean_Journal $journal, bool $dry): array {
    $id = $p->get_id();
    $d = mos_clean_decide(mos_clean_facts($p), $brand_keys);
    // A field this plugin filled once is never filled again: if the owner cleared it since, that was on purpose.
    $filled = mos_clean_filled($id);
    if (in_array('brand', $filled, true)) { $d['brand'] = $d['brand_new'] = null; }
    if (in_array('gender', $filled, true)) { $d['gender'] = []; }
    if (in_array('sport', $filled, true)) { $d['sport'] = null; }
    if (in_array('colour', $filled, true)) { $d['colour'] = null; }

    // Resolve every target term the same way in a preview and in apply (a preview counts only what apply would set;
    // a term this plugin may create counts as there).
    $term = static function (string $tax, string $slug, ?string $create_name = null) use ($dry, $journal): ?int {
        $t = get_term_by('slug', $slug, $tax);
        if ($t instanceof WP_Term) { return (int) $t->term_id; }
        $creatable = $create_name !== null || isset(mos_clean_created_terms()[$tax][$slug]);
        if ($dry) { return $creatable ? -1 : null; }
        return mos_clean_term_id($tax, $slug, $journal, $create_name);
    };
    $set = [];
    $brand_id = null;
    if ($d['brand'] !== null) {
        $brand_id = $term('product_brand', $d['brand']);
        if ($brand_id !== null) { $set['brand'] = $d['brand']; }
    } elseif ($d['brand_new'] !== null) {
        $name = mos_clean_brand_display_name($d['brand_new']);
        $brand_id = $term('product_brand', sanitize_title($name), $name);
        if ($brand_id !== null) { $set['brand'] = "$name (new)"; }
    }
    $cat_ids = [];
    foreach ($d['gender'] as $slug) {
        $cat_id = $term('product_cat', $slug);
        if ($cat_id !== null) { $cat_ids[] = $cat_id; }
    }
    if ($cat_ids) { $set['gender'] = implode('+', $d['gender']); }
    $attrs = [];
    foreach (['sport' => 'pa_ithrott', 'colour' => 'pa_litur'] as $field => $tax) {
        if ($d[$field] === null || mos_clean_attribute_ids($p, $tax)) { continue; }
        $term_id = $term($tax, $d[$field]);
        if ($term_id === null) { continue; }
        $attrs[$tax] = $term_id;
        $set[$field] = $d[$field];
    }
    if ($dry || !$set) { return ['set' => $set, 'conflicts' => $d['conflicts']]; }

    $journal?->snapshot($id);
    if ($cat_ids) { $p->set_category_ids(array_values(array_unique(array_merge($p->get_category_ids(), $cat_ids)))); }
    foreach ($attrs as $tax => $term_id) {
        if (!mos_clean_set_attribute($p, $tax, [$term_id])) { unset($set[$tax === 'pa_ithrott' ? 'sport' : 'colour']); }
    }
    if ($cat_ids || $attrs) { $p->save(); }
    // product_brand is not part of WC_Product's data, so it is set after the save (which would not keep it).
    if ($brand_id !== null) {
        $done = wp_set_object_terms($id, [$brand_id], 'product_brand', true);
        if (is_wp_error($done)) {
            mos_clean_warn("product $id: could not set the brand: " . $done->get_error_message());
            unset($set['brand']);
        }
    }
    update_post_meta($id, MOS_CLEAN_FILLED_META, array_values(array_unique(array_merge($filled, array_keys($set)))));
    return ['set' => $set, 'conflicts' => $d['conflicts']];
}

/** The fields (brand, gender, sport, colour) this plugin has filled on a product. @return list<string> */
function mos_clean_filled(int $id): array {
    $v = get_post_meta($id, MOS_CLEAN_FILLED_META, true);
    return is_array($v) ? array_values(array_filter($v, 'is_string')) : [];
}

/** Whether a product still lacks a brand, gender category, sport or colour that this plugin hasn't filled before:
 *  the save hook's first check, a few cached term lookups. A product nothing can be inferred for keeps answering
 *  true, which is why the hook only runs for catalog editors (see mos_clean_queue). */
function mos_clean_needs_fill(int $id): bool {
    $filled = mos_clean_filled($id);
    $missing = [
        'brand' => mos_clean_slugs($id, 'product_brand') === [],
        'gender' => !array_intersect(mos_clean_slugs($id, 'product_cat'), MOS_CLEAN_GENDER_CATS),
        'sport' => mos_clean_slugs($id, 'pa_ithrott') === [],
        'colour' => mos_clean_slugs($id, 'pa_litur') === [],
    ];
    foreach ($missing as $field => $is_missing) {
        if ($is_missing && !in_array($field, $filled, true)) { return true; }
    }
    return false;
}

/* ------------------------------------------------------------------------
 * 4. New and edited products: fill empty fields at the end of the request (queue, then flush once).
 * --------------------------------------------------------------------- */

/** Queue a product saved by a catalog editor (wp-admin, REST, WP-CLI imports). Saves from a checkout's stock
 *  change or any other visitor's request are left alone: they are not catalog edits. */
function mos_clean_queue(int $id): void {
    if ($id <= 0 || !empty($GLOBALS['mos_clean_running'])) { return; }
    if (!(defined('WP_CLI') && WP_CLI) && !current_user_can('edit_products')) { return; }
    if (empty($GLOBALS['mos_clean_dirty'])) {
        $GLOBALS['mos_clean_dirty'] = [];
        if (!has_action('shutdown', 'mos_clean_flush')) { add_action('shutdown', 'mos_clean_flush', PHP_INT_MAX - 1); }
    }
    $GLOBALS['mos_clean_dirty'][$id] = true;
}

function mos_clean_flush(): void {
    $ids = array_keys($GLOBALS['mos_clean_dirty'] ?? []);
    $GLOBALS['mos_clean_dirty'] = [];
    if (!$ids) { return; }
    $GLOBALS['mos_clean_running'] = true;   // our own save() must not queue the product again
    try {
        $keys = null;   // loaded once, and only when a product needs filling
        $changed = [];
        foreach ($ids as $id) {
            try {
                if (get_post_type((int) $id) !== 'product' || !mos_clean_needs_fill((int) $id)) { continue; }
                $p = wc_get_product((int) $id);
                if (!$p instanceof WC_Product) { continue; }
                $keys ??= mos_clean_brand_keys();
                if (mos_clean_fill_product($p, $keys, null, false)['set']) { $changed[] = (int) $id; }
            } catch (\Throwable $e) {
                error_log("mos-catalog-clean: fill failed for $id: " . $e->getMessage());
            }
        }
        if ($changed) { mos_clean_invalidate_caches($changed); }
    } finally {
        $GLOBALS['mos_clean_running'] = false;
    }
}

add_action('woocommerce_new_product', static fn ($id) => mos_clean_queue((int) $id));
add_action('woocommerce_update_product', static fn ($id) => mos_clean_queue((int) $id));

/* ------------------------------------------------------------------------
 * 5. WP-CLI: wp mos-clean preview | apply | restore
 * --------------------------------------------------------------------- */

if (defined('WP_CLI') && WP_CLI) {
    /**
     * Clean up the catalog's filter data and fill empty brand / gender / sport / colour fields.
     */
    class MOS_Clean_CLI {
        /**
         * Report what `apply` would change; writes nothing.
         *
         * ## OPTIONS
         *
         * [--samples=<n>]
         * : Conflicts to list per field.
         * ---
         * default: 15
         * ---
         */
        public function preview($args, $assoc) {
            $this->run(true, $assoc);
        }

        /**
         * Apply the term hygiene, then fill empty fields. Writes a journal for `restore`.
         *
         * ## OPTIONS
         *
         * [--batch=<n>]
         * : Products per batch.
         * ---
         * default: 200
         * ---
         *
         * [--samples=<n>]
         * : Conflicts to list per field.
         * ---
         * default: 15
         * ---
         */
        public function apply($args, $assoc) {
            $this->run(false, $assoc);
        }

        /**
         * Put back everything a journal recorded: product categories, brands and attributes, renamed and deleted
         * terms; then delete the terms the run created.
         *
         * ## OPTIONS
         *
         * <file>
         * : The journal (uploads/mos-clean/journal-*.json).
         */
        public function restore($args, $assoc) {
            $file = (string) ($args[0] ?? '');
            if ($file === '' || !is_file($file) || !is_readable($file)) { WP_CLI::error("Cannot read the journal: $file"); }
            $data = json_decode((string) file_get_contents($file), true);
            if (!is_array($data) || ($data['version'] ?? 0) !== 1) { WP_CLI::error("Not a mos-clean journal: $file"); }
            $failed = 0;
            $warn = static function (string $message) use (&$failed): void { $failed++; WP_CLI::warning($message); };
            $GLOBALS['mos_clean_running'] = true;
            try {
                $deleted = 0;
                // Newest first: a parent category is deleted after its children, so it comes back before them.
                foreach (array_reverse((array) ($data['deleted'] ?? [])) as $t) {
                    if (!isset($t['tax'], $t['slug'], $t['name']) || get_term_by('slug', $t['slug'], $t['tax'])) { continue; }
                    $parent = ($t['parent'] ?? '') !== '' ? get_term_by('slug', $t['parent'], $t['tax']) : null;
                    $made = wp_insert_term(html_entity_decode($t['name'], ENT_QUOTES, 'UTF-8'), $t['tax'], ['slug' => $t['slug'], 'description' => $t['description'] ?? '',
                        'parent' => $parent instanceof WP_Term ? (int) $parent->term_id : 0]);
                    if (is_wp_error($made)) { $warn("re-create {$t['tax']}/{$t['slug']}: " . $made->get_error_message()); continue; }
                    $deleted++;
                }
                $renamed = 0;
                foreach (array_reverse((array) ($data['renamed'] ?? [])) as $r) {
                    if (!isset($r['tax'], $r['term_id'], $r['name']) || !get_term((int) $r['term_id'], $r['tax']) instanceof WP_Term) { continue; }
                    $done = wp_update_term((int) $r['term_id'], $r['tax'], ['name' => html_entity_decode($r['name'], ENT_QUOTES, 'UTF-8')]);
                    if (is_wp_error($done)) { $warn("rename back {$r['tax']}/{$r['term_id']}: " . $done->get_error_message()); continue; }
                    $renamed++;
                }
                $reparented = 0;
                foreach (array_reverse((array) ($data['reparented'] ?? [])) as $r) {
                    if (!isset($r['tax'], $r['term_id'], $r['parent']) || !get_term((int) $r['term_id'], $r['tax']) instanceof WP_Term) { continue; }
                    $parent = $r['parent'] !== '' ? get_term_by('slug', $r['parent'], $r['tax']) : null;
                    $done = wp_update_term((int) $r['term_id'], $r['tax'], ['parent' => $parent instanceof WP_Term ? (int) $parent->term_id : 0]);
                    if (is_wp_error($done)) { $warn("reparent back {$r['tax']}/{$r['term_id']}: " . $done->get_error_message()); continue; }
                    $reparented++;
                }
                $products = (array) ($data['products'] ?? []);
                $n = 0;
                foreach ($products as $id => $snap) {
                    $id = (int) $id;
                    if (!is_array($snap) || get_post_type($id) !== 'product') { $warn("product $id: not restored (gone, or a bad entry)"); continue; }
                    try {
                        $this->restore_product($id, $snap, $warn);
                        $n++;
                    } catch (\Throwable $e) {
                        $warn("product $id: " . $e->getMessage());
                    }
                    if ($n % 200 === 0 && function_exists('wp_cache_flush_runtime')) { wp_cache_flush_runtime(); }
                }
                $removed = 0;
                foreach (array_reverse((array) ($data['created'] ?? [])) as $c) {
                    if (!isset($c['tax'], $c['term_id'])) { continue; }
                    $t = get_term((int) $c['term_id'], $c['tax']);
                    if (!$t instanceof WP_Term || get_objects_in_term((int) $t->term_id, $c['tax']) !== []) { continue; }
                    if (wp_delete_term((int) $t->term_id, $c['tax']) === true) { $removed++; } else { $warn("could not remove created term {$c['tax']}/{$t->slug}"); }
                }
                mos_clean_invalidate_caches(array_map('intval', array_keys($products)));
            } finally {
                $GLOBALS['mos_clean_running'] = false;
            }
            $summary = sprintf('Restored %d of %d products, %d deleted terms, %d renames, %d reparents; removed %d created terms.', $n, count($products), $deleted, $renamed, $reparented, $removed);
            if ($failed) { WP_CLI::warning("$summary $failed problems, listed above."); return; }
            WP_CLI::success($summary);
        }

        /** Put one product's snapshot back. @param callable(string):void $warn */
        private function restore_product(int $id, array $snap, callable $warn): void {
            update_post_meta($id, '_product_attributes', $snap['attributes'] ?? '');
            if (empty($snap['filled'])) { delete_post_meta($id, MOS_CLEAN_FILLED_META); }
            else { update_post_meta($id, MOS_CLEAN_FILLED_META, $snap['filled']); }
            foreach ((array) ($snap['terms'] ?? []) as $tax => $slugs) {
                $ids = [];
                foreach ((array) $slugs as $slug) {
                    $t = get_term_by('slug', (string) $slug, $tax);
                    if ($t instanceof WP_Term) { $ids[] = (int) $t->term_id; } else { $warn("product $id: $tax/$slug no longer exists"); }
                }
                $done = wp_set_object_terms($id, $ids, $tax, false);
                if (is_wp_error($done)) { $warn("product $id: $tax: " . $done->get_error_message()); }
            }
            clean_post_cache($id);
            $p = wc_get_product($id);
            if ($p instanceof WC_Product) { $p->save(); }   // rewrites the attribute lookup rows
        }

        private function run(bool $dry, array $assoc): void {
            global $wpdb;
            $samples = max(0, (int) ($assoc['samples'] ?? 15));
            $batch = max(1, (int) ($assoc['batch'] ?? 200));
            $journal = $dry ? null : $this->open_journal();
            $start = microtime(true);
            $ids = array_map('intval', $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status IN ('publish', 'private', 'draft', 'pending', 'future') ORDER BY ID"));
            $published = array_map('intval', $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status = 'publish'"));
            $before = $this->coverage($published);

            $GLOBALS['mos_clean_running'] = true;
            try {
                WP_CLI::log('— Term hygiene' . ($dry ? ' (preview)' : ''));
                $ops = mos_clean_run_term_ops($journal);
                foreach ($ops['log'] as $line) { WP_CLI::log("  $line"); }
                foreach ($ops['skipped'] as $line) { WP_CLI::log("  skipped: $line"); }
                $journal?->save();

                WP_CLI::log('— Categories' . ($dry ? ' (preview)' : ''));
                $cats = mos_clean_run_category_ops($journal);
                foreach ($cats['log'] as $line) { WP_CLI::log("  $line"); }
                foreach ($cats['skipped'] as $line) { WP_CLI::log("  skipped: $line"); }
                $ops['changed'] = array_merge($ops['changed'], $cats['changed']);

                WP_CLI::log('— Filling empty fields' . ($dry ? ' (preview: before the hygiene above, so sport counts can differ slightly)' : ''));
                $keys = $journal ? $this->create_brands($ids, $journal) : mos_clean_brand_keys();
                $fill = $this->fill($ids, $keys, $journal, $batch);
                if ($journal) { mos_clean_invalidate_caches(array_values(array_unique(array_merge($ops['changed'], $fill['changed'])))); }
            } finally {
                $GLOBALS['mos_clean_running'] = false;
            }

            WP_CLI::log(sprintf('%s %d products in %.1fs', $dry ? 'Would set' : 'Set', count($ids), microtime(true) - $start));
            $this->report($fill, $samples, $before, $dry ? null : $this->coverage($published), count($published));
            WP_CLI::success($dry ? 'Preview done; nothing written.' : sprintf('Applied; %d products in the journal.', $journal->product_count()));
        }

        /** A new journal in uploads/mos-clean/, a folder the web server will not list or serve. */
        private function open_journal(): MOS_Clean_Journal {
            $dir = trailingslashit(wp_upload_dir()['basedir']) . MOS_CLEAN_DIR;
            if (!wp_mkdir_p($dir)) { WP_CLI::error("Cannot create $dir"); }
            if (!file_exists("$dir/.htaccess")) { file_put_contents("$dir/.htaccess", "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n"); }
            if (!file_exists("$dir/index.php")) { file_put_contents("$dir/index.php", "<?php\n// Silence is golden.\n"); }
            $file = sprintf('%s/journal-%s-%s.json', $dir, gmdate('Ymd-His'), bin2hex(random_bytes(6)));
            $journal = new MOS_Clean_Journal($file);
            $journal->save();
            WP_CLI::log("Journal: $file");
            return $journal;
        }

        /**
         * Create the brand terms pa_vorumerki names first, so a product whose name starts with one of them is
         * matched in this same run rather than the next. @param int[] $ids @return array the refreshed brand keys
         */
        private function create_brands(array $ids, MOS_Clean_Journal $journal): array {
            $keys = mos_clean_brand_keys();
            foreach ($ids as $id) {
                if (in_array('brand', mos_clean_filled($id), true)) { continue; }
                $p = wc_get_product($id);
                if (!$p instanceof WC_Product) { continue; }
                $new = mos_clean_decide(mos_clean_facts($p), $keys)['brand_new'];
                if ($new === null) { continue; }
                $name = mos_clean_brand_display_name($new);
                if (mos_clean_term_id('product_brand', sanitize_title($name), $journal, $name) === null) {
                    WP_CLI::warning("could not create the brand term \"$name\"");
                    continue;
                }
                $keys = mos_clean_brand_keys();
            }
            $journal->save();
            if (function_exists('wp_cache_flush_runtime')) { wp_cache_flush_runtime(); }
            return $keys;
        }

        /**
         * Fill every product's empty fields, in batches.
         *
         * @param int[] $ids
         * @return array{set:array<string,int>,new_brands:array<string,int>,conflicts:array<string,list<string>>,changed:int[]}
         */
        private function fill(array $ids, array $keys, ?MOS_Clean_Journal $journal, int $batch): array {
            $out = ['set' => ['brand' => 0, 'gender' => 0, 'sport' => 0, 'colour' => 0], 'new_brands' => [], 'conflicts' => ['brand' => [], 'gender' => [], 'sport' => []], 'changed' => []];
            foreach (array_chunk($ids, $batch) as $chunk) {
                foreach ($chunk as $id) {
                    $p = wc_get_product($id);
                    if (!$p instanceof WC_Product) { continue; }
                    try {
                        $r = mos_clean_fill_product($p, $keys, $journal, $journal === null);
                    } catch (\Throwable $e) {
                        WP_CLI::warning("product $id: " . $e->getMessage());
                        continue;
                    }
                    foreach ($r['set'] as $field => $value) {
                        $out['set'][$field]++;
                        if ($field === 'brand' && str_ends_with($value, ' (new)')) { $out['new_brands'][$value] = ($out['new_brands'][$value] ?? 0) + 1; }
                    }
                    if ($r['set']) { $out['changed'][] = $id; }
                    foreach ($r['conflicts'] as $field => $candidates) {
                        $out['conflicts'][$field][] = sprintf('%d "%s": %s', $id, $p->get_name(), implode(' | ', $candidates));
                    }
                }
                $journal?->save();
                if (function_exists('wp_cache_flush_runtime')) { wp_cache_flush_runtime(); }
            }
            return $out;
        }

        /** Print what was set, the conflicts and the coverage. */
        private function report(array $fill, int $samples, array $before, ?array $after, int $published): void {
            foreach ($fill['set'] as $field => $n) { WP_CLI::log(sprintf('  %-7s %5d products', $field, $n)); }
            if ($fill['new_brands']) {
                $new_brands = $fill['new_brands'];
                ksort($new_brands);
                WP_CLI::log('  new brand terms: ' . implode(', ', array_map(static fn ($k, $v) => str_replace(' (new)', '', $k) . " ($v)", array_keys($new_brands), $new_brands)));
            }
            foreach ($fill['conflicts'] as $field => $lines) {
                WP_CLI::log(sprintf('  %s conflicts (left empty): %d', $field, count($lines)));
                foreach (array_slice($lines, 0, $samples) as $line) { WP_CLI::log("    $line"); }
            }
            WP_CLI::log(sprintf('Coverage of %d published products%s:', $published, $after === null ? ' (now)' : ' before → after'));
            foreach ($before as $field => $n) {
                WP_CLI::log(sprintf('  %-7s %5.1f%%%s', $field, 100 * $n / max(1, $published),
                    $after ? sprintf(' → %5.1f%%', 100 * $after[$field] / max(1, $published)) : ''));
            }
        }

        /**
         * Published products having at least one brand / gender category / sport / colour.
         *
         * @param int[] $ids
         * @return array{brand:int,gender:int,sport:int,colour:int}
         */
        private function coverage(array $ids): array {
            global $wpdb;
            if (!$ids) { return ['brand' => 0, 'gender' => 0, 'sport' => 0, 'colour' => 0]; }
            $in = implode(',', array_map('intval', $ids));
            $count = static function (string $tax, ?array $slugs = null) use ($wpdb, $in): int {
                $slug_sql = $slugs ? ' AND t.slug IN (' . implode(',', array_map(static fn ($s) => $wpdb->prepare('%s', $s), $slugs)) . ')' : '';
                return (int) $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(DISTINCT tr.object_id) FROM {$wpdb->term_relationships} tr
                     JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
                     JOIN {$wpdb->terms} t ON t.term_id = tt.term_id
                     WHERE tt.taxonomy = %s AND tr.object_id IN ($in)$slug_sql", $tax));
            };
            return [
                'brand' => $count('product_brand'),
                'gender' => $count('product_cat', MOS_CLEAN_GENDER_CATS),
                'sport' => $count('pa_ithrott'),
                'colour' => $count('pa_litur'),
            ];
        }
    }
    WP_CLI::add_command('mos-clean', 'MOS_Clean_CLI');
}
