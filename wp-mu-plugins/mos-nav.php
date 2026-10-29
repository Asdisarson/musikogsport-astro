<?php
/**
 * Plugin Name: MOS Nav
 * Description: Builds the storefront's main menu from the catalog. `wp mos-nav preview` prints the menu it would
 *  build (with product counts); `wp mos-nav apply` writes it as the menu "Aðalvalmynd 2026" and puts it in the
 *  primary location. The previous menu is kept: switching back is one change in Útlit → Valmyndir. The result is an
 *  ordinary WordPress menu, so the owner can edit it in wp-admin afterwards (a later `apply` rebuilds it).
 *  Konur / Karlar / Börn get the same columns (Fatnaður, Skór, Íþróttir, Félagslið, Vörumerki, Úrval); every
 *  column lists its links by product count, drops links with fewer than MOS_NAV_MIN_PRODUCTS products and empty
 *  columns. Sports and clubs link to the storefront's filters (?ithrott=, ?team=), not to categories.
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_NAV_MENU_NAME = 'Aðalvalmynd 2026';
const MOS_NAV_LOCATION = 'primary';
const MOS_NAV_MIN_PRODUCTS = 5;   // a link must lead to at least this many products
const MOS_NAV_COLUMN_LINKS = 8;   // links per column
const MOS_NAV_GENDERS = ['konur' => 'Konur', 'karlar' => 'Karlar', 'born' => 'Börn'];   // Kyn category slug → title
const MOS_NAV_CLUBS_CATEGORY = 'lidafatnadur-fatnadur-2';

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
    $columns[] = mos_nav_item('Félagslið', $clubs !== null ? mos_nav_category_path($cats, $clubs) . $q : "/verslun/$q",
        mos_nav_ranked($index, 'team', $within, static fn ($s) => "/verslun/$q&team=$s", $max));
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
    $items[] = mos_nav_item('Íþróttir', '#', array_filter([
        mos_nav_item('Íþróttir', '/verslun/', mos_nav_ranked($index, 'sport', [], static fn ($s) => "/verslun/?ithrott=$s", 2 * $max)),
        mos_nav_item('Félagslið', '/verslun/', mos_nav_ranked($index, 'team', [], static fn ($s) => "/verslun/?team=$s", 2 * $max)),
    ], static fn ($c) => $c['children'] !== []));
    $items[] = mos_nav_category_item($index, 'aefingarvorur', 'Æfingavörur', 'Flokkar', false);
    $brands = mos_nav_ranked($index, 'brand', [], static fn ($s) => "/brand/$s/", 2 * $max);
    $items[] = mos_nav_item('Vörumerki', '#', array_filter([
        mos_nav_item('Vinsæl vörumerki', '#', array_slice($brands, 0, $max)),
        mos_nav_item('Fleiri vörumerki', '#', array_slice($brands, $max)),
    ], static fn ($c) => $c['children'] !== []));
    $sale = mos_nav_id($index['terms']['cat'], 'sale');
    $items[] = mos_nav_item('Útsala', $sale !== null ? mos_nav_category_path($index['terms']['cat'], $sale) : '/verslun/?utsala=1');
    return array_values(array_filter($items));
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

/**
 * Write the tree as the menu MOS_NAV_MENU_NAME and put it in the primary location. It is built as a new menu and
 * swapped in only once complete, so a failure halfway leaves the menu the storefront shows untouched; an earlier
 * MOS_NAV_MENU_NAME is then deleted and the new one takes its name.
 *
 * @return array{menu_id:int,items:int,previous:string,warnings:list<string>}
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
                'menu-item-url' => $item['href'] === '#' ? '#' : home_url($item['href']),
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
    $replaces_own_build = $existing && $previous_id === (int) $existing->term_id;
    $previous = $previous_id && !$replaces_own_build ? (wp_get_nav_menu_object($previous_id)->name ?? (string) $previous_id) : '';
    $locations[MOS_NAV_LOCATION] = $menu_id;
    set_theme_mod('nav_menu_locations', $locations);
    $warnings = [];
    if ($existing && wp_delete_nav_menu((int) $existing->term_id) !== true) {
        $warnings[] = "the earlier \"" . MOS_NAV_MENU_NAME . "\" (menu {$existing->term_id}) could not be deleted";
    }
    $renamed = wp_update_nav_menu_object($menu_id, ['menu-name' => MOS_NAV_MENU_NAME]);
    if (is_wp_error($renamed)) { $warnings[] = 'the new menu keeps its dated name: ' . $renamed->get_error_message(); }
    foreach ([$menu_id, $previous_id, $existing ? (int) $existing->term_id : 0] as $id) { if ($id) { delete_transient("mos_menu_$id"); } }
    return ['menu_id' => $menu_id, 'items' => $count, 'previous' => $previous, 'warnings' => $warnings];
}

/* ------------------------------------------------------------------------
 * 3. WP-CLI: wp mos-nav preview | apply
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

        /** Write the menu as "Aðalvalmynd 2026" and put it in the primary location (the previous menu is kept). */
        public function apply(array $args, array $assoc): void {
            $tree = mos_nav_tree(mos_nav_index());
            if (!array_filter($tree, static fn ($item) => $item['children'] !== [])) {
                WP_CLI::error('Nothing to write: the catalog gave no menu columns (no published products or categories?).');
            }
            $this->print($tree, 0);
            try {
                $r = mos_nav_write($tree);
            } catch (\Throwable $e) {
                WP_CLI::error($e->getMessage());
            }
            foreach ($r['warnings'] as $warning) { WP_CLI::warning($warning); }
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
