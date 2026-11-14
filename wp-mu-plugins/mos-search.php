<?php
/**
 * Plugin Name: MOS Search
 * Description: Product search for the storefront. WooCommerce looks for the whole query in a product's title (or
 *  SKU), so "nike skór", "peysur" (a category) and "addidas" found nothing. This replaces the search clause of
 *  product queries outside wp-admin (the Store API's `search` that the storefront reads, its counts included, and
 *  WordPress's `s`):
 *   - every word of the query has to match, each in the product's title, its SKU (variations too; a SKU typed
 *     whole, dashes and all, is looked up as one) or the name of
 *     one of its categories, brands, tags and attribute terms (a category's sub-categories count as the category);
 *   - a word matches a word that starts with it ("sko" finds "skór": results while typing), or that ends with its
 *     stem plus an ending, so the forms of an Icelandic word meet (peysa / peysur / peysu, and "skór" finds
 *     "fótboltaskór") without matching inside other words ("taska" is not in "fótboltaskór"); the u-umlaut pair is
 *     tried both ways (taska / töskur);
 *   - a word nothing in the shop matches is replaced by the nearest word that is there (addidas → adidas), or left
 *     out if nothing is near;
 *   - when no product has all the words, products with any of them are shown instead;
 *   - under the default order (newest first) products with the words in their title come first.
 *
 *  The index (the words of the titles, the SKUs, the term names) is kept in a transient for twelve hours and
 *  dropped when a product or a term is saved; it is rebuilt by the next search (tens of milliseconds).
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_SEARCH_MAX_WORDS = 6;
const MOS_SEARCH_INDEX_KEY = 'mos_search_index_v1';
/** Taxonomies that describe how a product is sold, not what it is. */
const MOS_SEARCH_SKIP_TAXONOMIES = ['product_type', 'product_visibility', 'product_shipping_class'];
/** Noun and adjective endings (folded), longest first. */
const MOS_SEARCH_ENDINGS = ['urnar', 'arnir', 'arnar', 'unum', 'anna', 'inum', 'inn', 'ana', 'ina', 'nar', 'nir', 'num', 'ur', 'ar', 'ir', 'um', 'an', 'in', 'id', 'a', 'i', 'u', 'r', 's'];

/* ------------------------------------------------------------------------
 * 1. Pure helpers (tests/mos_search_test.php). Everything is compared folded.
 * --------------------------------------------------------------------- */

/** Lower case with accents and Icelandic letters reduced. */
function mos_search_fold(string $s): string {
    $s = mb_strtolower(trim(html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8')), 'UTF-8');
    return strtr($s, [
        'á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ý' => 'y', 'ð' => 'd', 'þ' => 'th',
        'æ' => 'ae', 'ö' => 'o', 'ø' => 'o', 'å' => 'a', 'ä' => 'a', 'ü' => 'u', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
        'ï' => 'i', 'ô' => 'o', 'ñ' => 'n', 'ç' => 'c',
    ]);
}

/** The folded words of a text: letters and digits, two characters or more, each once, in order. */
function mos_search_split(string $text): array {
    $words = preg_split('/[^a-z0-9]+/', mos_search_fold($text)) ?: [];
    return array_values(array_unique(array_filter($words, static fn ($w) => strlen($w) >= 2)));
}

/** The words of a query, at most MOS_SEARCH_MAX_WORDS. */
function mos_search_words(string $query): array {
    return array_slice(mos_search_split($query), 0, MOS_SEARCH_MAX_WORDS);
}

/** A folded word without its ending, so its forms meet ("peysur" and "peysa" → "peys"). Words under five letters
 *  and codes with a digit are left alone; at least three letters stay (four after a one-letter ending). */
function mos_search_stem(string $word): string {
    $len = strlen($word);
    if ($len < 5 || preg_match('/\d/', $word)) { return $word; }
    foreach (MOS_SEARCH_ENDINGS as $ending) {
        $cut = strlen($ending);
        if ($len - $cut >= ($cut === 1 ? 4 : 3) && substr($word, -$cut) === $ending) { return substr($word, 0, $len - $cut); }
    }
    return $word;
}

/** A stem and its u-umlaut twin (a ↔ o, folded from ö, in its last syllable when it ends in a consonant: "task"
 *  and "tosk"), the stem first. */
function mos_search_variants(string $stem): array {
    if (preg_match('/^(.*)([ao])([^aeiouy]+)$/', $stem, $m)) {
        return [$stem, $m[1] . ($m[2] === 'a' ? 'o' : 'a') . $m[3]];
    }
    return [$stem];
}

/** Whether a word of the shop answers to a stem: it starts with it, or (three letters or more) ends with it plus at
 *  most an ending. */
function mos_search_word_matches(string $stem, string $word): bool {
    $at = strpos($word, $stem);
    if ($at === false) { return false; }
    if ($at === 0) { return true; }
    if (strlen($stem) < 3) { return false; } // two letters only ever start a word
    $at = strrpos($word, $stem);
    $rest = substr($word, $at + strlen($stem));
    return $rest === '' || in_array($rest, MOS_SEARCH_ENDINGS, true);
}

/** The shop's words (keys of $vocab) that answer to any of the spellings. */
function mos_search_matching_words(array $spellings, array $vocab): array {
    $found = [];
    foreach ($vocab as $word => $_) {
        $word = (string) $word;
        foreach ($spellings as $spelling) {
            if (mos_search_word_matches($spelling, $word)) { $found[] = $word; break; }
        }
    }
    return $found;
}

/** The shop's word nearest a misspelt one, or null: one edit for 5–7 letters, two from 8; shorter words are never
 *  guessed. The nearer word wins, then the more common one. $vocab: word → how many products have it. */
function mos_search_correct(string $word, array $vocab): ?string {
    $len = strlen($word);
    $allowed = $len >= 8 ? 2 : ($len >= 5 ? 1 : 0);
    if ($allowed === 0 || $len > 40) { return null; }
    $best = null;
    $best_distance = $allowed + 1;
    $best_count = 0;
    foreach ($vocab as $candidate => $count) {
        $candidate = (string) $candidate;
        if (abs(strlen($candidate) - $len) > $allowed) { continue; }
        $distance = levenshtein($word, $candidate);
        if ($distance < $best_distance || ($distance === $best_distance && $count > $best_count)) {
            [$best, $best_distance, $best_count] = [$candidate, $distance, $count];
        }
    }
    return $best_distance <= $allowed ? $best : null;
}

/**
 * The index from the shop's data.
 * @param array<int,string> $titles product id → title
 * @param array<string,int> $skus SKU → product id (a variation's SKU under its parent's id)
 * @param list<array{id:int,name:string}> $terms id: term_taxonomy_id
 * @return array{title:array<string,list<int>>,sku:array<string,list<int>>,term:array<string,list<int>>,vocab:array<string,int>}
 */
function mos_search_build_index(array $titles, array $skus, array $terms): array {
    $index = ['title' => [], 'sku' => [], 'term' => [], 'vocab' => []];
    foreach ($titles as $id => $title) {
        foreach (mos_search_split((string) $title) as $word) { $index['title'][$word][] = (int) $id; }
    }
    foreach ($skus as $sku => $id) {
        $key = preg_replace('/[^a-z0-9]+/', '', mos_search_fold((string) $sku));
        if (strlen((string) $key) >= 3) { $index['sku'][$key][] = (int) $id; }
    }
    foreach ($terms as $term) {
        foreach (mos_search_split((string) $term['name']) as $word) { $index['term'][$word][] = (int) $term['id']; }
    }
    foreach (['title', 'term'] as $part) {
        foreach ($index[$part] as $word => $ids) { $index['vocab'][$word] = ($index['vocab'][$word] ?? 0) + count($ids); }
    }
    return $index;
}

/** The products with a SKU that contains the (folded, punctuation-free) text. */
function mos_search_by_sku(string $text, array $index): array {
    $found = [];
    foreach ($index['sku'] as $sku => $ids) {
        if (str_contains((string) $sku, $text)) { $found = array_merge($found, $ids); }
    }
    return array_values(array_unique($found));
}

/**
 * What a query finds, word by word: the products with the word in their title or SKU, and the terms named by it.
 * A word the shop does not have is replaced by its nearest word, or left out; `words` are the ones kept.
 * @return array{words:list<string>,parts:list<array{products:list<int>,terms:list<int>}>}
 */
function mos_search_resolve(string $query, array $index): array {
    $out = ['words' => [], 'parts' => []];
    // A SKU typed whole, punctuation and all ("H24-616"): it is one thing, not the words it splits into.
    $code = (string) preg_replace('/[^a-z0-9]+/', '', mos_search_fold($query));
    if (strlen($code) >= 4 && preg_match('/\d/', $code) && preg_match('/[^a-z0-9]/', trim(mos_search_fold($query)))) {
        $products = mos_search_by_sku($code, $index);
        if ($products !== []) { return ['words' => [$code], 'parts' => [['products' => $products, 'terms' => []]]]; }
    }
    foreach (mos_search_words($query) as $word) {
        $stem = mos_search_stem($word);
        // The u-umlaut twin only for a word that lost an ending ("taska", "töskur"), not for "skor" (→ "hanskar").
        $spellings = $stem !== $word ? mos_search_variants($stem) : [$stem];
        $matching = mos_search_matching_words($spellings, $index['vocab']);
        $by_sku = [];
        if (strlen($word) >= (preg_match('/\d/', $word) ? 3 : 4)) { $by_sku = mos_search_by_sku($word, $index); }
        if ($matching === [] && $by_sku === []) {
            $near = mos_search_correct($word, $index['vocab']);
            if ($near === null) { continue; }
            $word = $near;
            $matching = [$near];
        }
        $products = $by_sku;
        $terms = [];
        foreach ($matching as $hit) {
            if (isset($index['title'][$hit])) { $products = array_merge($products, $index['title'][$hit]); }
            if (isset($index['term'][$hit])) { $terms = array_merge($terms, $index['term'][$hit]); }
        }
        $out['words'][] = $word;
        $out['parts'][] = ['products' => array_values(array_unique($products)), 'terms' => array_values(array_unique($terms))];
    }
    return $out;
}

/* ------------------------------------------------------------------------
 * 2. The shop's index.
 * --------------------------------------------------------------------- */

function mos_search_taxonomies(): array {
    return array_values(array_diff(get_object_taxonomies('product'), MOS_SEARCH_SKIP_TAXONOMIES));
}

function mos_search_index(): array {
    if (isset($GLOBALS['mos_search_index'])) { return $GLOBALS['mos_search_index']; }
    $cached = get_transient(MOS_SEARCH_INDEX_KEY);
    if (is_array($cached) && isset($cached['vocab'])) { return $GLOBALS['mos_search_index'] = $cached; }
    global $wpdb;
    $titles = [];
    foreach ($wpdb->get_results("SELECT ID, post_title FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status = 'publish'") as $row) {
        $titles[(int) $row->ID] = (string) $row->post_title;
    }
    $skus = [];
    $rows = $wpdb->get_results(
        "SELECT sku.meta_value AS sku, IF(p.post_type = 'product_variation', p.post_parent, p.ID) AS product
         FROM {$wpdb->postmeta} sku JOIN {$wpdb->posts} p ON p.ID = sku.post_id
         WHERE sku.meta_key = '_sku' AND sku.meta_value <> '' AND p.post_type IN ('product', 'product_variation') AND p.post_status = 'publish'"
    );
    foreach ($rows as $row) {
        if (isset($titles[(int) $row->product])) { $skus[(string) $row->sku] = (int) $row->product; }
    }
    $terms = [];
    $taxonomies = mos_search_taxonomies();
    if ($taxonomies !== []) {
        $in = implode(',', array_fill(0, count($taxonomies), '%s'));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT tt.term_taxonomy_id AS id, t.name FROM {$wpdb->terms} t JOIN {$wpdb->term_taxonomy} tt ON tt.term_id = t.term_id WHERE tt.taxonomy IN ($in)",
            ...$taxonomies
        ));
        foreach ($rows as $row) { $terms[] = ['id' => (int) $row->id, 'name' => (string) $row->name]; }
    }
    $index = mos_search_build_index($titles, $skus, $terms);
    set_transient(MOS_SEARCH_INDEX_KEY, $index, 12 * HOUR_IN_SECONDS);
    return $GLOBALS['mos_search_index'] = $index;
}

function mos_search_forget_index(): void {
    delete_transient(MOS_SEARCH_INDEX_KEY);
    unset($GLOBALS['mos_search_index'], $GLOBALS['mos_search_memo']); // this request's copies too
}
add_action('save_post_product', 'mos_search_forget_index');
add_action('save_post_product_variation', 'mos_search_forget_index');
add_action('created_term', 'mos_search_forget_index');
add_action('edited_term', 'mos_search_forget_index');
add_action('delete_term', 'mos_search_forget_index');

/* ------------------------------------------------------------------------
 * 3. The search clause.
 * --------------------------------------------------------------------- */

/** The named terms with the sub-terms of hierarchical ones (term_taxonomy ids). */
function mos_search_with_children(array $tt_ids): array {
    global $wpdb;
    if ($tt_ids === []) { return []; }
    $all = $tt_ids;
    $rows = $wpdb->get_results("SELECT term_id, taxonomy FROM {$wpdb->term_taxonomy} WHERE term_taxonomy_id IN (" . implode(',', array_map('intval', $tt_ids)) . ')');
    foreach ($rows as $row) {
        if (!is_taxonomy_hierarchical($row->taxonomy)) { continue; }
        $children = get_term_children((int) $row->term_id, $row->taxonomy);
        if (!is_array($children) || $children === []) { continue; }
        $child_ids = get_terms(['taxonomy' => $row->taxonomy, 'include' => $children, 'hide_empty' => false, 'fields' => 'tt_ids']);
        if (is_array($child_ids)) { $all = array_merge($all, array_map('intval', $child_ids)); }
    }
    return array_slice(array_values(array_unique($all)), 0, 1000);
}

/** The condition for one word of the query. */
function mos_search_part_sql(array $part): string {
    global $wpdb;
    $any = [];
    if ($part['products'] !== []) { $any[] = "{$wpdb->posts}.ID IN (" . implode(',', array_map('intval', $part['products'])) . ')'; }
    $terms = mos_search_with_children($part['terms']);
    if ($terms !== []) {
        $any[] = "{$wpdb->posts}.ID IN (SELECT object_id FROM {$wpdb->term_relationships} WHERE term_taxonomy_id IN (" . implode(',', $terms) . '))';
    }
    return $any === [] ? '(1 = 0)' : '(' . implode(' OR ', $any) . ')';
}

/** The condition for a query, and how its results rank; `where` is '' when the query has no words. */
function mos_search_clause(string $query): array {
    $memo = &$GLOBALS['mos_search_memo'];
    if (!is_array($memo)) { $memo = []; }
    if (isset($memo[$query])) { return $memo[$query]; }
    global $wpdb;
    $empty = ['where' => '', 'rank' => ''];
    if (mos_search_words($query) === []) { return $memo[$query] = $empty; }
    $found = mos_search_resolve($query, mos_search_index());
    if ($found['parts'] === []) { return $memo[$query] = ['where' => '(1 = 0)', 'rank' => '']; } // nothing like it in the shop
    $parts = array_map('mos_search_part_sql', $found['parts']);
    $where = implode(' AND ', $parts);
    if (count($parts) > 1) {
        // No product with every word: show the ones with any of them rather than nothing. (Asked of the published
        // products as a whole: a filter chosen on the results page can still leave the every-word search empty.)
        $has_all = $wpdb->get_var("SELECT 1 FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status = 'publish' AND $where LIMIT 1");
        if ($has_all === null) { $where = implode(' OR ', $parts); }
    }
    // Rank: every word in the title or SKU, then some word there, then matched by a category or other term only.
    $lists = array_column($found['parts'], 'products');
    $in_all = count($lists) > 1 ? array_values(array_intersect(...$lists)) : $lists[0];
    $in_any = array_values(array_unique(array_merge(...$lists)));
    $rank = '';
    if ($in_any !== []) {
        $rank = '(CASE' . ($in_all !== [] ? " WHEN {$wpdb->posts}.ID IN (" . implode(',', $in_all) . ') THEN 0' : '')
            . " WHEN {$wpdb->posts}.ID IN (" . implode(',', $in_any) . ') THEN 1 ELSE 2 END)';
    }
    return $memo[$query] = ['where' => "($where)", 'rank' => $rank];
}

/** The text a product query searches for, or '': WordPress's `s`, or the Store API's own `search` variable. */
function mos_search_text($query, string $var): string {
    if (!$query instanceof WP_Query || is_admin()) { return ''; }
    if (!in_array('product', (array) $query->get('post_type'), true)) { return ''; }
    $text = $query->get($var);
    return is_string($text) ? trim($text) : '';
}

// WordPress's own search clause (a query with `s`). Not for shop staff: the admin's product lists search through
// REST with `s` too (drafts and private products included), and the index holds published products only.
add_filter('posts_search', static function ($search, $query) {
    $text = current_user_can('edit_products') ? '' : mos_search_text($query, 's');
    if ($text === '') { return $search; }
    global $wpdb;
    $clause = mos_search_clause($text);
    if ($clause['where'] === '') { return $search; }
    // As WordPress's own clause: password-protected products stay out for visitors.
    return ' AND ' . $clause['where'] . (is_user_logged_in() ? '' : " AND ({$wpdb->posts}.post_password = '')") . ' ';
}, 20, 2);

add_filter('posts_search_orderby', static function ($orderby, $query) {
    $text = current_user_can('edit_products') ? '' : mos_search_text($query, 's');
    $rank = $text === '' ? '' : mos_search_clause($text)['rank'];
    global $wpdb;
    return $rank === '' ? $orderby : "$rank, {$wpdb->posts}.post_date DESC";
}, 20, 2);

/** The clause WooCommerce's Store API adds for its `search` variable (StoreApi\Utilities\ProductQuery::
 *  add_query_clauses, read at WooCommerce 10): the whole text in the title, or in the SKU. Both of its shapes. */
function mos_search_store_api_clauses(string $text): array {
    global $wpdb;
    $like = '%' . $wpdb->esc_like($text) . '%';
    return [
        $wpdb->prepare(" AND ( $wpdb->posts.post_title LIKE %s OR wc_product_meta_lookup.sku LIKE %s ) ", $like, $like),
        $wpdb->prepare(" AND $wpdb->posts.post_title LIKE %s ", $like),
    ];
}

// The Store API (what the storefront reads) searches through `posts_clauses`, not `s`: its clause is swapped for
// ours. If WooCommerce ever writes that clause differently it is not found and its own search stays in place.
add_filter('posts_clauses', static function ($clauses, $query) {
    $text = mos_search_text($query, 'search');
    if ($text === '' || !is_array($clauses) || !isset($clauses['where'])) { return $clauses; }
    $ours = mos_search_clause($text);
    if ($ours['where'] === '') { return $clauses; }
    foreach (mos_search_store_api_clauses((string) $query->get('search')) as $theirs) {
        if (!str_contains($clauses['where'], $theirs)) { continue; }
        $clauses['where'] = str_replace($theirs, ' AND ' . $ours['where'] . ' ', $clauses['where']);
        // Newest first is the default order: there, the better matches lead and the date orders within them.
        global $wpdb;
        if ($ours['rank'] !== '' && isset($clauses['orderby']) && preg_match('/^\s*' . preg_quote("{$wpdb->posts}.post_date", '/') . '\s+DESC\b/i', (string) $clauses['orderby'])) {
            $clauses['orderby'] = $ours['rank'] . ', ' . $clauses['orderby'];
        }
        break;
    }
    return $clauses;
}, 20, 2);
