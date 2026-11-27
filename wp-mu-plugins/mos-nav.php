<?php
/**
 * Plugin Name: MOS Nav
 * Description: Builds the storefront's main menu from the catalog. `wp mos-nav preview` prints the menu it would
 *  build (with product counts); `wp mos-nav apply` writes it as the menu "Aðalvalmynd 2026" and puts it in the
 *  primary location. The previous menu is kept: switching back is one change in Útlit → Valmyndir. The result is an
 *  ordinary WordPress menu, and from then on it is the owner's: they order, rename, add and remove its items in
 *  Stillingar → Valmynd (mos-menu.php, the "Breyta valmynd" button on the Stillingar page), or in Útlit → Valmyndir
 *  as the fallback, and the storefront shows what they saved.
 *  A menu edited by hand, or one no build is recorded for, is never rebuilt unasked: `apply` refuses without
 *  `--force`, and "Smíða upp á nýtt úr vörulista" on the Stillingar page (administrators) needs its box ticked. Each
 *  rebuild keeps the menu it replaces, hand edits included, as "Aðalvalmynd 2026 (afrit)": one backup, in Útlit → Valmyndir.
 *  Konur / Karlar / Börn get the same columns (Fatnaður, Skór, Íþróttir, Félagslið, Vörumerki, Úrval); every
 *  column takes the links with the most products (none with fewer than MOS_NAV_MIN_PRODUCTS), lists them in
 *  alphabetical order (Icelandic), and is dropped when empty. The featured clubs (MOS_NAV_FEATURED_CLUBS) lead every
 *  Félagslið column they are in, and the featured national teams (MOS_NAV_FEATURED_NATIONAL_TEAMS) lead Landslið, in
 *  the order of those lists. Sports and clubs link to the storefront's filters (?ithrott=, ?team=), not to
 *  categories. The clubs in MOS_NAV_FEATURED_CLUBS and MOS_NAV_PINNED_TEAMS are listed under Íþróttir › Félagslið
 *  whatever their product count, unless they have none.
 *  National teams (MOS_NAV_NATIONAL_TEAMS) are not clubs: under Íþróttir they have their own column, Landslið.
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_NAV_MENU_NAME = 'Aðalvalmynd 2026';
const MOS_NAV_BACKUP_NAME = MOS_NAV_MENU_NAME . ' (afrit)';   // the build a rebuild replaced; one is kept
const MOS_NAV_LOCATION = 'primary';
const MOS_NAV_BUILT_OPTION = 'mos_nav_built';   // ['menu_id' => int, 'hash' => string]: the last build, as it was written
const MOS_NAV_MIN_PRODUCTS = 5;   // a link must lead to at least this many products
const MOS_NAV_COLUMN_LINKS = 8;   // links per column
const MOS_NAV_GENDERS = ['konur' => 'Konur', 'karlar' => 'Karlar', 'born' => 'Börn'];   // Kyn category slug → title
const MOS_NAV_CLUBS_CATEGORY = 'lidafatnadur-fatnadur-2';
// Félag/Lið slugs listed under Íþróttir › Félagslið besides the ranked clubs, however few products they have (not none).
const MOS_NAV_PINNED_TEAMS = ['paris-saint-germain', 'inter-milan', 'barcelona'];
// Félag/Lið slugs that lead every Félagslið column they are in, in this order (the rest of the column is
// alphabetical). Under Íþróttir › Félagslið they are also listed however few products they have (not none).
const MOS_NAV_FEATURED_CLUBS = ['manchester-united', 'barcelona', 'arsenal', 'liverpool'];
// The same for Íþróttir › Landslið (the spellings of one country the catalog has had).
const MOS_NAV_FEATURED_NATIONAL_TEAMS = ['island-iceland', 'island', 'iceland'];
// Félag/Lið slugs that are national teams (and national federations): under Íþróttir they get the column Landslið
// instead of Félagslið, whatever their product count (not none). Both spellings of a country are here because the catalog has had both; a slug it lacks is skipped.
const MOS_NAV_NATIONAL_TEAMS = [
    'island-iceland', 'island', 'iceland', 'ksi', 'hsi',
    'england', 'spann', 'spain', 'brasilia', 'brazil', 'argentina', 'thyskaland', 'germany', 'frakkland', 'france',
    'italy', 'italia', 'portugal', 'belgia', 'belgium', 'holland', 'netherlands', 'kroatia', 'croatia',
    'danmork', 'denmark', 'noregur', 'norway', 'svithjod', 'sweden', 'usa', 'mexico', 'japan',
];

/* ------------------------------------------------------------------------
 * 1. Pure helpers (no WordPress calls; tests/mos_nav_rules_test.php).
 *
 * The catalog index: ['terms' => [key => [term_id => {slug, name, parent}]], 'products' => list<[key => int[]]>],
 * keys cat (product_cat), brand (product_brand), team (pa_felag-lid), sport (pa_ithrott).
 * --------------------------------------------------------------------- */

/** A term id by slug within one key of the index, or null. */
function mos_nav_id(array $terms, string $slug): ?int {
    foreach ($terms as $id => $t) { if ($t['slug'] === $slug) { return (int) $id; } }
    return null;
}

/** A category and every category under it. @return int[] */
function mos_nav_descendants(array $cats, int $root): array {
    $out = [$root];
    for ($i = 0; $i < count($out); $i++) {
        foreach ($cats as $id => $c) { if ((int) $c['parent'] === $out[$i]) { $out[] = (int) $id; } }
    }
    return $out;
}

/** The storefront path of a category (/voruflokkur/<parent chain>/<slug>/). */
function mos_nav_category_path(array $cats, int $id): string {
    $chain = [];
    for ($seen = 0; isset($cats[$id]) && $seen < 10; $seen++) {
        array_unshift($chain, $cats[$id]['slug']);
        $id = (int) $cats[$id]['parent'];
    }
    return '/voruflokkur/' . implode('/', $chain) . '/';
}

/** Products matching every condition; a condition is [key => term ids], met when the product has any of them. */
function mos_nav_count(array $index, array ...$conds): int {
    $n = 0;
    foreach ($index['products'] as $p) {
        foreach ($conds as $cond) {
            foreach ($cond as $key => $ids) {
                if (!array_intersect($p[$key] ?? [], $ids)) { continue 3; }
            }
        }
        $n++;
    }
    return $n;
}

/**
 * The terms of one key ranked by how many products within $within carry them: at least MOS_NAV_MIN_PRODUCTS each,
 * at most $max, ties by name.
 *
 * @param callable(string):string $href term slug → link
 * @return list<array{title:string,href:string,children:array,count:int}>
 */
function mos_nav_ranked(array $index, string $key, array $within, callable $href, int $max): array {
    $rows = [];
    foreach ($index['terms'][$key] as $id => $t) {
        $rows[] = ['title' => $t['name'], 'href' => $href($t['slug']), 'children' => [], 'count' => mos_nav_count($index, $within, [$key => [(int) $id]])];
    }
    return mos_nav_top($rows, $max);
}

/** Rows with at least MOS_NAV_MIN_PRODUCTS products, most first (ties by title), at most $max. */
function mos_nav_top(array $rows, int $max): array {
    $rows = array_filter($rows, static fn ($r) => $r['count'] >= MOS_NAV_MIN_PRODUCTS);
    usort($rows, static fn ($a, $b) => [$b['count'], $a['title']] <=> [$a['count'], $b['title']]);
    return array_slice($rows, 0, $max);
}

/**
 * $ranked followed by the terms of $slugs it lacks, in the order of $slugs: no MOS_NAV_MIN_PRODUCTS, no maximum. A
 * slug the catalog has no term for, or whose term no product carries (the link would list nothing), is skipped.
 *
 * @param list<array{title:string,href:string,children:array,count:int}> $ranked
 * @param list<string> $slugs
 * @param callable(string):string $href term slug → link (the one $ranked was built with)
 * @return list<array{title:string,href:string,children:array,count:int}>
 */
function mos_nav_with_pinned(array $index, string $key, array $ranked, array $slugs, callable $href): array {
    $listed = array_flip(array_column($ranked, 'href'));
    foreach ($slugs as $slug) {
        $id = mos_nav_id($index['terms'][$key], $slug);
        $link = $href($slug);
        if ($id === null || isset($listed[$link])) { continue; }
        $count = mos_nav_count($index, [$key => [$id]]);
        if ($count === 0) { continue; }
        $listed[$link] = true;
        $ranked[] = ['title' => $index['terms'][$key][$id]['name'], 'href' => $link, 'children' => [], 'count' => $count];
    }
    return $ranked;
}

/** Whether a team link (built by $href) is a national team's. */
function mos_nav_is_national(string $link, callable $href): bool {
    foreach (MOS_NAV_NATIONAL_TEAMS as $slug) {
        if ($href($slug) === $link) { return true; }
    }
    return false;
}

/** The national teams with products, the featured ones marked (mos_nav_alphabetical orders the column). */
function mos_nav_national_teams(array $index, callable $href): array {
    return mos_nav_featured(mos_nav_with_pinned($index, 'team', [], MOS_NAV_NATIONAL_TEAMS, $href), MOS_NAV_FEATURED_NATIONAL_TEAMS, $href);
}

/**
 * $links with the ones $slugs name marked `featured` => their place in $slugs: mos_nav_alphabetical() lists those
 * first, in that order. A slug with no link in $links marks nothing.
 *
 * @param list<array{title:string,href:string,children:array,count:int}> $links
 * @param list<string> $slugs
 * @param callable(string):string $href term slug → link (the one $links was built with)
 * @return list<array{title:string,href:string,children:array,count:int,featured?:int}>
 */
function mos_nav_featured(array $links, array $slugs, callable $href): array {
    $place = array_flip(array_map($href, $slugs));
    foreach ($links as &$link) {
        if (isset($place[$link['href']])) { $link['featured'] = $place[$link['href']]; }
    }
    unset($link);
    return $links;
}

/** The key a title sorts by in the Icelandic alphabet (a á b d ð e é f g h i í j k l m n o ó p r s t u ú v x y ý þ æ ö),
 *  whatever its case; letters the alphabet lacks (c, q, w, z) fall where they do in English, digits come first. */
function mos_nav_alpha_key(string $title): string {
    static $order = null;
    if ($order === null) {
        $letters = ['a', 'á', 'b', 'c', 'd', 'ð', 'e', 'é', 'f', 'g', 'h', 'i', 'í', 'j', 'k', 'l', 'm', 'n', 'o', 'ó', 'p', 'q', 'r', 's', 't', 'u', 'ú', 'v', 'w', 'x', 'y', 'ý', 'z', 'þ', 'æ', 'ö'];
        $order = [];
        foreach ($letters as $i => $letter) { $order[$letter] = chr(65 + $i); }
    }
    $key = '';
    foreach (preg_split('//u', mb_strtolower(html_entity_decode($title, ENT_QUOTES | ENT_HTML5, 'UTF-8'), 'UTF-8'), -1, PREG_SPLIT_NO_EMPTY) ?: [] as $char) {
        if (isset($order[$char])) { $key .= $order[$char]; }
        elseif (ctype_digit($char)) { $key .= chr(48 + (int) $char); }
        elseif ($char === ' ') { $key .= ' '; }
        // punctuation carries no order
    }
    return $key;
}

/**
 * The tree with every listed column in alphabetical order. A column is "listed" when its links were picked by
 * product count (they carry `count`): which links make a column is still decided by the products, only their order
 * is the alphabet's. Links marked `featured` (mos_nav_featured) come before the others, in the order of their
 * marks. Columns written by hand (Úrval, Fyrir) and the order of the columns and of the menu itself stay.
 */
function mos_nav_alphabetical(array $items): array {
    foreach ($items as &$item) {
        foreach ($item['children'] as &$column) {
            $links = $column['children'];
            if ($links === [] || array_filter($links, static fn ($l) => !array_key_exists('count', $l)) !== []) { continue; }
            usort($links, static fn ($a, $b) => (($a['featured'] ?? PHP_INT_MAX) <=> ($b['featured'] ?? PHP_INT_MAX))
                ?: strcmp(mos_nav_alpha_key($a['title']), mos_nav_alpha_key($b['title'])) ?: strcmp($a['title'], $b['title']));
            $column['children'] = $links;
        }
        unset($column);
    }
    unset($item);
    return $items;
}

/** The leaf categories under a root, ranked like mos_nav_ranked(); $query is appended to each path. */
function mos_nav_ranked_leaves(array $index, int $root, array $within, string $query, int $max): array {
    $cats = $index['terms']['cat'];
    $parents = array_flip(array_map(static fn ($c) => (int) $c['parent'], $cats));
    $rows = [];
    foreach (mos_nav_descendants($cats, $root) as $id) {
        if ($id === $root || isset($parents[$id])) { continue; }
        $n = $within ? mos_nav_count($index, $within, ['cat' => [$id]]) : mos_nav_count($index, ['cat' => [$id]]);
        $rows[] = ['title' => $cats[$id]['name'], 'href' => mos_nav_category_path($cats, $id) . $query, 'children' => [], 'count' => $n];
    }
    return mos_nav_top($rows, $max);
}

/** A menu item. @param list<array> $children */
function mos_nav_item(string $title, string $href, array $children = []): array {
    return ['title' => $title, 'href' => $href, 'children' => array_values($children)];
}

/** Konur / Karlar / Börn: the same columns, each narrowed to the gender. */
function mos_nav_gender_item(array $index, string $slug, string $title): ?array {
    $cats = $index['terms']['cat'];
    $gender = mos_nav_id($cats, $slug);
    if ($gender === null) { return null; }
    $within = ['cat' => [$gender]];
    $q = "?kyn=$slug";
    $max = MOS_NAV_COLUMN_LINKS;
    $columns = [];
    foreach (['fatnadur' => 'Fatnaður', 'skor' => 'Skór'] as $root_slug => $col) {
        $root = mos_nav_id($cats, $root_slug);
        if ($root !== null) { $columns[] = mos_nav_item($col, mos_nav_category_path($cats, $root) . $q, mos_nav_ranked_leaves($index, $root, $within, $q, $max)); }
    }
    $columns[] = mos_nav_item('Íþróttir', "/verslun/$q", mos_nav_ranked($index, 'sport', $within, static fn ($s) => "/verslun/$q&ithrott=$s", $max));
    $clubs = mos_nav_id($cats, MOS_NAV_CLUBS_CATEGORY);
    $team_href = static fn ($s) => "/verslun/$q&team=$s";
    $columns[] = mos_nav_item('Félagslið', $clubs !== null ? mos_nav_category_path($cats, $clubs) . $q : "/verslun/$q",
        mos_nav_featured(mos_nav_ranked($index, 'team', $within, $team_href, $max), MOS_NAV_FEATURED_CLUBS, $team_href));
    $columns[] = mos_nav_item('Vörumerki', "/verslun/$q", mos_nav_ranked($index, 'brand', $within, static fn ($s) => "/brand/$s/$q", $max));
    $picks = [mos_nav_item('Vinsælt núna', "/verslun/$q&orderby=popularity"), mos_nav_item('Nýjast', "/verslun/$q&orderby=date")];
    $sale = mos_nav_id($cats, 'sale');
    if ($sale !== null && mos_nav_count($index, $within, ['cat' => [$sale]]) >= MOS_NAV_MIN_PRODUCTS) {
        $picks[] = mos_nav_item('Útsala', mos_nav_category_path($cats, $sale) . $q);
    }
    $columns = array_filter($columns, static fn ($c) => $c['children'] !== []);
    $columns[] = mos_nav_item('Úrval', '#', $picks);
    return mos_nav_item($title, "/verslun/$q", $columns);
}

/** A category with its leaf categories and its brands as columns (Skór, Æfingavörur). */
function mos_nav_category_item(array $index, string $slug, string $title, string $leaves_title, bool $by_gender): ?array {
    $cats = $index['terms']['cat'];
    $root = mos_nav_id($cats, $slug);
    if ($root === null) { return null; }
    $path = mos_nav_category_path($cats, $root);
    $within = ['cat' => mos_nav_descendants($cats, $root)];
    $columns = [mos_nav_item($leaves_title, $path, mos_nav_ranked_leaves($index, $root, [], '', MOS_NAV_COLUMN_LINKS))];
    if ($by_gender) {
        $links = [];
        foreach (MOS_NAV_GENDERS as $g => $g_title) {
            $id = mos_nav_id($cats, $g);
            if ($id !== null && mos_nav_count($index, $within, ['cat' => [$id]]) >= MOS_NAV_MIN_PRODUCTS) { $links[] = mos_nav_item($g_title, "$path?kyn=$g"); }
        }
        $columns[] = mos_nav_item('Fyrir', '#', $links);
    }
    $columns[] = mos_nav_item('Vörumerki', $path, mos_nav_ranked($index, 'brand', $within, static fn ($s) => "/brand/$s/?product-category=$slug", MOS_NAV_COLUMN_LINKS));
    return mos_nav_item($title, $path, array_filter($columns, static fn ($c) => $c['children'] !== []));
}

/** The whole menu. @return list<array{title:string,href:string,children:array}> */
function mos_nav_tree(array $index): array {
    $max = MOS_NAV_COLUMN_LINKS;
    $items = [];
    foreach (MOS_NAV_GENDERS as $slug => $title) { $items[] = mos_nav_gender_item($index, $slug, $title); }
    $items[] = mos_nav_category_item($index, 'skor', 'Skór', 'Tegundir', true);
    $team_href = static fn ($s) => "/verslun/?team=$s";
    // The clubs: the ranked teams without the national ones (ranked without a maximum first, so that taking the
    // national teams out leaves the column full).
    $clubs = array_slice(array_values(array_filter(
        mos_nav_ranked($index, 'team', [], $team_href, PHP_INT_MAX),
        static fn ($row) => !mos_nav_is_national($row['href'], $team_href)
    )), 0, 2 * $max);
    $items[] = mos_nav_item('Íþróttir', '#', array_filter([
        mos_nav_item('Íþróttir', '/verslun/', mos_nav_ranked($index, 'sport', [], static fn ($s) => "/verslun/?ithrott=$s", 2 * $max)),
        mos_nav_item('Félagslið', '/verslun/', mos_nav_featured(
            mos_nav_with_pinned($index, 'team', $clubs, [...MOS_NAV_FEATURED_CLUBS, ...MOS_NAV_PINNED_TEAMS], $team_href), MOS_NAV_FEATURED_CLUBS, $team_href)),
        mos_nav_item('Landslið', '/verslun/', mos_nav_national_teams($index, $team_href)),
    ], static fn ($c) => $c['children'] !== []));
    $items[] = mos_nav_category_item($index, 'aefingarvorur', 'Æfingavörur', 'Flokkar', false);
    $brands = mos_nav_ranked($index, 'brand', [], static fn ($s) => "/brand/$s/", 2 * $max);
    $items[] = mos_nav_item('Vörumerki', '#', array_filter([
        mos_nav_item('Vinsæl vörumerki', '#', array_slice($brands, 0, $max)),
        mos_nav_item('Fleiri vörumerki', '#', array_slice($brands, $max)),
    ], static fn ($c) => $c['children'] !== []));
    $sale = mos_nav_id($index['terms']['cat'], 'sale');
    $items[] = mos_nav_item('Útsala', $sale !== null ? mos_nav_category_path($index['terms']['cat'], $sale) : '/verslun/?utsala=1');
    return mos_nav_alphabetical(array_values(array_filter($items)));
}

/**
 * A fingerprint of a menu as its editor shows it: each item's title and address, in order, with the position of the
 * item it sits under. Item ids are left out, so a rebuild of the same menu has the same fingerprint.
 *
 * @param list<array{id:int,parent:int,title:string,url:string}> $rows in menu order
 */
function mos_nav_items_hash(array $rows): string {
    $position = [];
    foreach (array_values($rows) as $i => $row) { $position[(int) $row['id']] = $i; }
    $shape = [];
    foreach ($rows as $row) {
        $shape[] = [(string) $row['title'], (string) $row['url'], $position[(int) $row['parent']] ?? -1];
    }
    return sha1((string) json_encode($shape));
}

/**
 * Whether the menu shown is the owner's own work: anything but the last build exactly as it was written. With no
 * menu shown there is nothing to lose. A menu no build is recorded for counts as theirs.
 *
 * @param mixed $built the MOS_NAV_BUILT_OPTION record
 */
function mos_nav_is_hand_edited($built, int $shown_menu_id, string $shown_hash): bool {
    if ($shown_menu_id <= 0) { return false; }
    if (!is_array($built) || !is_int($built['menu_id'] ?? null) || !is_string($built['hash'] ?? null)) { return true; }
    return $built['menu_id'] !== $shown_menu_id || $built['hash'] !== $shown_hash;
}

/* ------------------------------------------------------------------------
 * 2. WordPress: the catalog index and the menu writer.
 * --------------------------------------------------------------------- */

/** Every published product's categories, brands, clubs and sports, and those terms. */
function mos_nav_index(): array {
    global $wpdb;
    $taxes = ['cat' => 'product_cat', 'brand' => 'product_brand', 'team' => 'pa_felag-lid', 'sport' => 'pa_ithrott'];
    $index = ['terms' => [], 'products' => []];
    $products = [];
    foreach ($taxes as $key => $tax) {
        $index['terms'][$key] = [];
        $terms = get_terms(['taxonomy' => $tax, 'hide_empty' => false]);
        foreach (is_array($terms) ? $terms : [] as $t) {
            $index['terms'][$key][(int) $t->term_id] = ['slug' => $t->slug, 'name' => html_entity_decode($t->name, ENT_QUOTES, 'UTF-8'), 'parent' => (int) $t->parent];
        }
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT tr.object_id AS id, tt.term_id AS term FROM {$wpdb->term_relationships} tr
             JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
             JOIN {$wpdb->posts} p ON p.ID = tr.object_id AND p.post_type = 'product' AND p.post_status = 'publish'
             WHERE tt.taxonomy = %s", $tax));
        foreach ($rows ?: [] as $r) { $products[(int) $r->id][$key][] = (int) $r->term; }
    }
    $index['products'] = array_values($products);
    return $index;
}

/** The address a menu item is saved with: a place in the shop ("/…") on this site; a heading ("#") or a full address as it is. */
function mos_nav_item_url(string $href): string {
    return $href !== '' && $href[0] === '/' ? home_url($href) : $href;
}

/**
 * Write the tree as the menu MOS_NAV_MENU_NAME and put it in the primary location. It is built as a new menu and
 * swapped in only once complete, so a failure halfway leaves the menu the storefront shows untouched; an earlier
 * MOS_NAV_MENU_NAME is then kept as MOS_NAV_BACKUP_NAME (with any hand edits; the backup before it goes) and the
 * new one takes its name. When the owner had switched back to the backup, that one stays the backup instead.
 *
 * @return array{menu_id:int,items:int,previous:string,backup:string,warnings:list<string>}
 */
function mos_nav_write(array $tree): array {
    $existing = wp_get_nav_menu_object(MOS_NAV_MENU_NAME);
    $menu_id = wp_create_nav_menu(MOS_NAV_MENU_NAME . ' (' . gmdate('Y-m-d H:i:s') . ')');
    if (is_wp_error($menu_id)) { throw new RuntimeException('could not create the menu: ' . $menu_id->get_error_message()); }
    $count = 0;
    $add = static function (array $items, int $parent) use (&$add, &$count, $menu_id): void {
        foreach ($items as $item) {
            $id = wp_update_nav_menu_item($menu_id, 0, [
                'menu-item-title' => $item['title'],
                'menu-item-url' => mos_nav_item_url($item['href']),
                'menu-item-type' => 'custom',
                'menu-item-status' => 'publish',
                'menu-item-parent-id' => $parent,
            ]);
            if (is_wp_error($id)) { throw new RuntimeException("could not add \"{$item['title']}\": " . $id->get_error_message()); }
            $count++;
            $add($item['children'], (int) $id);
        }
    };
    try {
        $add($tree, 0);
    } catch (\Throwable $e) {
        // The half-built menu goes; the storefront still shows the old one.
        $cleaned = wp_delete_nav_menu($menu_id) === true ? '' : " (and the half-built menu $menu_id could not be deleted)";
        throw new RuntimeException($e->getMessage() . $cleaned, 0, $e);
    }
    $locations = get_nav_menu_locations();
    $previous_id = (int) ($locations[MOS_NAV_LOCATION] ?? 0);
    $old_backup = wp_get_nav_menu_object(MOS_NAV_BACKUP_NAME);
    $shows_backup = $old_backup && $previous_id === (int) $old_backup->term_id;   // the owner went back to the backup
    $replaces_own_build = ($existing && $previous_id === (int) $existing->term_id) || $shows_backup;
    $previous = $previous_id && !$replaces_own_build ? (wp_get_nav_menu_object($previous_id)->name ?? (string) $previous_id) : '';
    $locations[MOS_NAV_LOCATION] = $menu_id;
    set_theme_mod('nav_menu_locations', $locations);
    $warnings = [];
    $backup = $old_backup ? MOS_NAV_BACKUP_NAME : '';
    if ($shows_backup) {
        // The backup is the menu they chose, so the build they left is the one to go.
        if ($existing && wp_delete_nav_menu((int) $existing->term_id) !== true) {
            $warnings[] = "the earlier \"" . MOS_NAV_MENU_NAME . "\" (menu {$existing->term_id}) could not be deleted";
        }
    } elseif ($existing) {
        $backup = mos_nav_rotate_backup((int) $existing->term_id, $old_backup ? (int) $old_backup->term_id : 0, $warnings) ? MOS_NAV_BACKUP_NAME : $backup;
    }
    $renamed = wp_update_nav_menu_object($menu_id, ['menu-name' => MOS_NAV_MENU_NAME]);
    if (is_wp_error($renamed)) { $warnings[] = 'the new menu keeps its dated name: ' . $renamed->get_error_message(); }
    foreach ([$menu_id, $previous_id, $existing ? (int) $existing->term_id : 0] as $id) { if ($id) { delete_transient("mos_menu_$id"); } }
    return ['menu_id' => $menu_id, 'items' => $count, 'previous' => $previous, 'backup' => $backup, 'warnings' => $warnings];
}

/**
 * Make menu $replaced the backup in place of $old_backup (0: none). $replaced is moved off its name first, so the
 * old backup only goes once the new one is safe; a failure is added to $warnings and leaves the old backup.
 */
function mos_nav_rotate_backup(int $replaced, int $old_backup, array &$warnings): bool {
    $parked = wp_update_nav_menu_object($replaced, ['menu-name' => MOS_NAV_BACKUP_NAME . ' ' . gmdate('Y-m-d H:i:s')]);
    if (is_wp_error($parked)) {
        $warnings[] = "the earlier menu $replaced was not kept as the backup: " . $parked->get_error_message();
        return false;
    }
    if ($old_backup && wp_delete_nav_menu($old_backup) !== true) {
        $warnings[] = "the earlier backup (menu $old_backup) could not be deleted; menu $replaced keeps its dated backup name";
        return false;
    }
    $named = wp_update_nav_menu_object($replaced, ['menu-name' => MOS_NAV_BACKUP_NAME]);
    if (is_wp_error($named)) { $warnings[] = "the backup (menu $replaced) keeps its dated name: " . $named->get_error_message(); }
    return true;
}

/** The catalog gave no menu columns: nothing is written. */
final class MOS_Nav_Empty extends RuntimeException {}
/** The menu shown is the owner's own work and replacing it was not asked for: nothing is written. */
final class MOS_Nav_Edited extends RuntimeException {}

/** The menu in the primary location (0: none). */
function mos_nav_shown_menu_id(): int {
    return (int) (get_nav_menu_locations()[MOS_NAV_LOCATION] ?? 0);
}

/** The fingerprint (mos_nav_items_hash) of a menu as it is saved now. */
function mos_nav_menu_hash(int $menu_id): string {
    $items = wp_get_nav_menu_items($menu_id);
    $rows = [];
    foreach (is_array($items) ? $items : [] as $item) {
        $rows[] = ['id' => (int) $item->ID, 'parent' => (int) $item->menu_item_parent, 'title' => (string) $item->title, 'url' => (string) $item->url];
    }
    return mos_nav_items_hash($rows);
}

/** Whether the menu shown has the owner's own work in it (mos_nav_is_hand_edited). */
function mos_nav_hand_edited(): bool {
    $shown = mos_nav_shown_menu_id();
    return mos_nav_is_hand_edited(get_option(MOS_NAV_BUILT_OPTION, null), $shown, $shown > 0 ? mos_nav_menu_hash($shown) : '');
}

/**
 * Build the menu from the catalog and write it (`wp mos-nav apply` and the Stillingar button).
 *
 * @param null|callable(list<array>):void $before_write gets the tree once it is known to be writable
 * @param bool $force replace a menu the owner edited by hand too (it is kept as the backup)
 * @return array{menu_id:int,items:int,previous:string,backup:string,warnings:list<string>,tree:list<array>}
 * @throws MOS_Nav_Empty when the catalog gives no columns; MOS_Nav_Edited when the menu shown is the owner's own work
 *  and $force is false; RuntimeException when the write fails (nothing changed in any of the three).
 */
function mos_nav_rebuild(?callable $before_write = null, bool $force = false): array {
    // Refused first, before the catalog index and tree are built: a refused rebuild costs nothing. An edited menu
    // wins over an empty catalog, so MOS_Nav_Edited is thrown even when there would be nothing to write either.
    if (!$force && mos_nav_hand_edited()) {
        throw new MOS_Nav_Edited('Nothing written: the menu shown was edited by hand, or was not built here.');
    }
    $tree = mos_nav_tree(mos_nav_index());
    if (!array_filter($tree, static fn ($item) => $item['children'] !== [])) {
        throw new MOS_Nav_Empty('Nothing to write: the catalog gave no menu columns (no published products or categories?).');
    }
    if ($before_write !== null) { $before_write($tree); }
    $r = mos_nav_write($tree);
    // Read back, not computed from $tree: the fingerprint is of the menu as WordPress saved it.
    update_option(MOS_NAV_BUILT_OPTION, ['menu_id' => (int) $r['menu_id'], 'hash' => mos_nav_menu_hash((int) $r['menu_id'])], false);
    return $r + ['tree' => $tree];
}

/* ------------------------------------------------------------------------
 * 3. wp-admin: the "Valmynd" box on the Stillingar page (administrators only)
 * --------------------------------------------------------------------- */

const MOS_NAV_NOTICES = [
    'rebuilt' => ['success', 'Valmyndin var endursmíðuð (%d atriði).'],
    'backup'  => ['success', 'Valmyndin var endursmíðuð (%d atriði). Fyrri útgáfa er geymd sem afrit í Útlit → Valmyndir.'],
    'empty'   => ['error', 'Ekkert til að smíða úr: engar birtar vörur eða flokkar fundust. Valmyndin er óbreytt.'],
    'failed'  => ['error', 'Endursmíðin mistókst og valmyndin er óbreytt. Ástæðan er í villuskrá vefþjónsins.'],
    'refused' => ['error', 'Valmyndin er óbreytt: henni hefur verið breytt handvirkt. Hakaðu í reitinn til að smíða hana samt upp á nýtt.'],
];
const MOS_NAV_CONFIRM = 'Þetta smíðar aðalvalmyndina upp á nýtt úr vörulistanum og setur hana í stað þeirrar sem nú er sýnd. '
    . 'Sú sem nú er sýnd er geymd sem afrit í Útlit → Valmyndir. Halda áfram?';

add_action('mos_settings_after', 'mos_nav_admin_box');
add_action('admin_post_mos_nav_rebuild', 'mos_nav_handle_rebuild');

/** The Stillingar page at the Valmynd box, showing one of MOS_NAV_NOTICES. */
function mos_nav_admin_url(string $notice, int $items = 0): string {
    $args = ['page' => defined('MOS_SETTINGS_SLUG') ? MOS_SETTINGS_SLUG : 'mos-settings', 'mos_nav' => $notice];
    if ($items > 0) { $args['mos_nav_items'] = $items; }
    return add_query_arg($args, admin_url('admin.php')) . '#menu';
}

function mos_nav_admin_box(): void {
    if (!current_user_can('manage_options')) { return; }
    $notice = isset($_GET['mos_nav']) ? sanitize_key(wp_unslash($_GET['mos_nav'])) : '';
    $shown = mos_nav_shown_menu_id();
    $edited = mos_nav_hand_edited();
    echo '<section class="mos-set-box"><h2 id="menu">Valmynd</h2>';
    if (isset(MOS_NAV_NOTICES[$notice])) {
        [$kind, $text] = MOS_NAV_NOTICES[$notice];
        $text = sprintf($text, absint(wp_unslash($_GET['mos_nav_items'] ?? 0)));
        echo '<div class="notice notice-' . esc_attr($kind) . ' inline"><p>' . esc_html($text) . '</p></div>';
    }
    echo '<p>Þú ræður aðalvalmyndinni: hvað er í henni, hvað það heitir og í hvaða röð.</p>';
    // The owner's own editor (mos-menu.php) when it is installed, else WordPress's menu screen.
    $edit = function_exists('mos_menu_editor_url') ? mos_menu_editor_url() : admin_url('nav-menus.php' . ($shown > 0 ? '?action=edit&menu=' . $shown : ''));
    echo '<p><a class="button button-primary" href="' . esc_url($edit) . '">Breyta valmynd</a></p>';
    echo '<h3>Smíða upp á nýtt úr vörulista</h3>';
    echo '<p>' . ($edited
        ? '<strong>Handbreytt.</strong> Valmyndinni hefur verið breytt frá síðustu sjálfvirku smíð (eða hún var ekki smíðuð hér).'
        : '<strong>Óbreytt</strong> frá síðustu sjálfvirku smíð.')
        . ' Sjálfvirka smíðin velur flokka, íþróttir, félagslið og vörumerki eftir vörufjölda og kemur í stað valmyndarinnar sem nú er sýnd; sú er geymd sem afrit.</p>';
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" '
        . 'onsubmit="if(!confirm(\'' . esc_js(MOS_NAV_CONFIRM) . '\'))return false;this.querySelector(\'button\').disabled=true">';
    echo '<input type="hidden" name="action" value="mos_nav_rebuild">';
    wp_nonce_field('mos_nav_rebuild');
    if ($edited) {
        echo '<p><label><input type="checkbox" name="mos_nav_discard" value="1" required> '
            . 'Ég skil að valmyndin sem ég hef breytt fer úr versluninni og verður aðeins til sem afrit.</label></p>';
    }
    echo '<button class="button">Smíða upp á nýtt úr vörulista</button></form></section>';
}

function mos_nav_handle_rebuild(): void {
    if (!current_user_can('manage_options')) {
        wp_die('Aðeins stjórnendur geta endursmíðað valmyndina.', 'Valmynd', ['response' => 403]);
    }
    check_admin_referer('mos_nav_rebuild');
    $user = get_current_user_id();
    try {
        // The tick is asked for only when the menu is the owner's own work; without it such a menu is left alone.
        $r = mos_nav_rebuild(null, !empty($_POST['mos_nav_discard']));
        foreach ($r['warnings'] as $warning) { error_log('[mos-nav] ' . $warning); }
        error_log(sprintf('[mos-nav] rebuilt by user %d: %d items (menu %d)', $user, $r['items'], $r['menu_id']));
        $to = mos_nav_admin_url($r['backup'] !== '' ? 'backup' : 'rebuilt', $r['items']);
    } catch (MOS_Nav_Empty $e) {
        error_log(sprintf('[mos-nav] rebuild by user %d refused: the catalog gave no menu columns', $user));
        $to = mos_nav_admin_url('empty');
    } catch (MOS_Nav_Edited $e) {
        error_log(sprintf('[mos-nav] rebuild by user %d refused: the menu shown was edited by hand', $user));
        $to = mos_nav_admin_url('refused');
    } catch (\Throwable $e) {
        error_log(sprintf('[mos-nav] rebuild by user %d failed: %s', $user, $e->getMessage()));
        $to = mos_nav_admin_url('failed');
    }
    wp_safe_redirect($to);
    exit;
}

/* ------------------------------------------------------------------------
 * 4. WP-CLI: wp mos-nav preview | apply
 * --------------------------------------------------------------------- */

if (defined('WP_CLI') && WP_CLI) {
    /**
     * Build the storefront's main menu from the catalog.
     */
    class MOS_Nav_CLI {
        /** Print the menu `apply` would write, with product counts; writes nothing. */
        public function preview(array $args, array $assoc): void {
            $this->print(mos_nav_tree(mos_nav_index()), 0);
            WP_CLI::success('Preview done; nothing written.');
        }

        /**
         * Write the menu as "Aðalvalmynd 2026" and put it in the primary location (the previous menu is kept, and the build it replaces as one backup).
         *
         * ## OPTIONS
         *
         * [--force]
         * : Replace the menu shown even when the owner edited it by hand, or when no build is recorded for it.
         */
        public function apply(array $args, array $assoc): void {
            try {
                $r = mos_nav_rebuild(fn (array $tree) => $this->print($tree, 0), !empty($assoc['force']));
            } catch (MOS_Nav_Edited $e) {
                WP_CLI::error('The menu shown was edited by hand, or was not built by mos-nav, so it is the owner\'s: nothing written. '
                    . 'To replace it anyway (it is kept as the backup): wp mos-nav apply --force');
            } catch (\Throwable $e) {
                WP_CLI::error($e->getMessage());
            }
            foreach ($r['warnings'] as $warning) { WP_CLI::warning($warning); }
            if ($r['backup'] !== '') { WP_CLI::log("Earlier build kept as \"{$r['backup']}\" (switch back in Útlit → Valmyndir)."); }
            if ($r['previous'] !== '') { WP_CLI::log("Previous menu kept: \"{$r['previous']}\" (switch back in Útlit → Valmyndir)."); }
            WP_CLI::success(sprintf('Wrote %d items to "%s" (menu %d), now in the %s location.', $r['items'], MOS_NAV_MENU_NAME, $r['menu_id'], MOS_NAV_LOCATION));
        }

        private function print(array $items, int $depth): void {
            foreach ($items as $item) {
                WP_CLI::log(str_repeat('  ', $depth) . $item['title'] . ' → ' . $item['href'] . (isset($item['count']) ? " ({$item['count']})" : ''));
                $this->print($item['children'], $depth + 1);
            }
        }
    }
    WP_CLI::add_command('mos-nav', 'MOS_Nav_CLI');
}
