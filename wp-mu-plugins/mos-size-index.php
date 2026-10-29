<?php
/**
 * Plugin Name: MOS Size Index
 * Description: A derived, read-only size index for the storefront's size filter. A hidden taxonomy
 *  `mos_size` on products, built from the local "Stærðir"-style product attributes (every misspelling)
 *  and the global size attributes (`pa_staerdir`, `pa_skostaerdir`), with the values normalised
 *  ("38 2/3" = "382/3", "38,5" = "38.5"). Only sizes that are in stock are indexed. Product data is
 *  never written: the index is the taxonomy's own terms and term relationships, nothing else.
 *  - Store API: `mos_size=<slug,slug>` on /wc/store/v1/products and …/products/collection-data
 *    (OR within the sizes, AND with every other filter); `mos_size_counts=1` on collection-data adds
 *    `mos_size_counts: [{slug,label,group,sort,count}]` for the current filters minus the size filter;
 *    `mos_extra_counts=1` adds `mos_extra_counts: {price: [n…], on_sale: n}` — the products per
 *    `mos_price_ranges=min:max,…` range (in place of the request's own price filter) and, with
 *    `mos_sale_count=1`, on sale, within every other filter — so the storefront's price presets and
 *    Útsala need no request of their own.
 *  - GET /wp-json/mos/v1/sizes: every indexed size (slug, label, group, sort, count), cached.
 *  - WP-CLI: `wp mos-size reindex [--batch=200] [--dry-run]` (backfill) and `wp mos-size purge`.
 *  Kept in sync on product/variation saves and stock-status changes.
 *  Uninstall: `wp mos-size purge` while this file is still installed, then delete the file.
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_SIZE_TAXONOMY  = 'mos_size';
const MOS_SIZE_GROUPS    = ['shoe', 'letter', 'kids', 'other'];
const MOS_SIZE_MAX_PARAM = 60;            // most slugs one request may filter by
const MOS_SIZE_LIST_KEY  = 'mos_size_list'; // transient behind GET mos/v1/sizes
// Statuses that count as "available": a backorderable size can still be bought.
const MOS_SIZE_AVAILABLE = ['instock', 'onbackorder'];

/* ------------------------------------------------------------------------
 * 1. Normaliser (pure: no WordPress calls, unit-tested in tests/mos_size_normalise_test.php).
 *
 * mos_size_normalise(raw) → ['slug','label','group','sort'] or null (junk / unknown).
 * The label is canonical and normalises back to the same slug, so a term's group and sort are
 * always re-derived from its name (no term meta is stored).
 *
 * Rules, in the order they are tried (after trimming, collapsing spaces, mapping ½ ⅓ ⅔ to " 1/2"
 * etc., dropping a parenthetical note such as "(kid)" or "( 36/39)", and a trailing "." after a digit):
 *  - "One size", "OS", "OSFA", "Ein stærð"          → ein-staerd  "Ein stærð"  other
 *  - "Newborn", "Nýfætt"                             → nyfaett     "Nýfætt"     kids
 *  - "Barna", "Kids", "Youth", "JR", "Barnast(ærð)"  → barna       "Barna"      other
 *  - "Adult", "SR", "Fullorðins", "Fullorðinsst(ærð)" → fullordins "Fullorðins" other
 *  - months  "3m", "6-9m", "12/18 mánaða"            → 3m, 6-9m    "6-9 mán."   kids
 *  - years   "7-8 ára", "1-3 ára"                    → 7-8-ara     "7-8 ára"    kids
 *  - toddler "3T"                                    → 3t          "3T"         kids
 *  - thirds  "38 2/3", "382/3", "38⅔"                → 38-2-3      "38 2/3"     (sort 38.667)
 *      typos "37/13" = 37 1/3, "40/23" = 40 2/3; "42/3" (digit lost) follows the adidas step, where an
 *      even whole size is followed by its ⅔ and an odd one by its ⅓: 42/3 = 42 2/3, 41/3 = 41 1/3.
 *  - halves  "38.5", "38,5", "38 1/2"                → 38-5        "38,5"       (decimal comma)
 *  - other decimals keep their digits: "37.6"        → 37-6        "37,6"
 *      (below 10, a decimal whose digit is larger than the whole part, e.g. 2.5, gets "2k5" so it
 *      can never collide with the range "2-5"; two decimal digits get a trailing "d", "12,15" →
 *      "12-15d", so they can't collide with the range "12/15" either)
 *  - integers "40"                                    → 40          "40"
 *  - ranges "33/34", "33-34", "23,5-27", "122/128 cm" → 33-34      "33/34"      (upper > lower, gap ≤ 25)
 *  Numeric groups (a string-only normaliser cannot tell a shoe 38 from a swimsuit 38; the storefront
 *  shows sizes per listing, where the products already disambiguate):
 *      16 ≤ v < 51          shoe   (incl. ⅓ ⅔ ½; also EU clothing 34–48, e.g. swimwear)
 *      51 ≤ v < 80, whole   kids   (baby heights 56/62/68/74 — beyond the 80–176 band, per the data)
 *      80 ≤ v ≤ 176, whole  kids   (children's heights in cm)
 *      v < 16               other  (balls 3/4/5, hats 1-3, gloves 6-12, US kids sizes; too mixed to group)
 *      v > 176              null
 *      ranges: both ends shoe → shoe; both < 16 → other; lower ≥ 62 and upper ≤ 176 → kids;
 *              lower ≥ 50 with a 6 cm step ("50/56") → kids; otherwise both 50–65 (hat/head
 *              circumference "55-59") → other; anything else (e.g. "46/52") → null.
 *  - trousers waist/length "32X32", "34/30" (descending, so never a range) → w32-l32 "W32/L32" other
 *  - letters XXS…5XL ("XXL" = "2XL", "XXXL" = "3XL", "SX" = "XS", "Small/Medium/Large") → letter,
 *      sort 1 (4XS) … 12 (5XL). Ranges "S/M", "L-XL", "XXS/XS" → s-m "S/M" (sort lower + 0.5).
 *      A trailing qualifier is dropped: Tall/T/Short/S ("M/S", "L/S")/Long, a cup ("C/D", "D skál", "Dcup"), an inseam
 *      ("5''"), KVK/KK/herrastærð/fullorðins. An "A" (adult) prefix is dropped too: "AXS" = XS.
 *      A "C"/"Y" (child/youth) prefix or "barna(stærð)" makes it kids: "CL", "YXS", "2YXS" (= 2XS),
 *      "XL barnastærð" → l-barna "L barna" (sort ≈ the matching height in cm).
 *  - "1X"/"6X" → other; "6+" → other; "T1".."T4" → other; "00" → other; bra bands "36D" → other.
 * --------------------------------------------------------------------- */

/** @return array{slug: string, label: string, group: string, sort: float} */
function mos_size_term(string $slug, string $label, string $group, float $sort): array {
    return ['slug' => $slug, 'label' => $label, 'group' => $group, 'sort' => round($sort, 4)];
}

function mos_size_clean(string $raw): string {
    $s = str_replace(
        ["\u{00A0}", '½', '⅓', '⅔', '¼', '¾', '–', '—', '″', '”', '“', "''"],
        [' ', ' 1/2', ' 1/3', ' 2/3', ' 1/4', ' 3/4', '-', '-', '"', '"', '"', '"'],
        $raw
    );
    $s = trim((string) preg_replace('/\s+/u', ' ', $s));
    $bare = trim((string) preg_replace('/\s*\([^)]*\)\s*/u', ' ', $s));
    if ($bare !== '') { $s = $bare; }
    $s = (string) preg_replace('/(\d)\.$/', '$1', $s);
    return trim((string) preg_replace('/\s+/u', ' ', $s));
}

/** Format a size number: [slug part, label part]. Thirds and halves get their own spellings. */
function mos_size_fmt(float $v): array {
    $whole = (int) floor($v + 1e-9);
    $frac  = $v - $whole;
    if ($frac < 1e-6) { return [(string) $whole, (string) $whole]; }
    if (abs($frac - 1 / 3) < 1e-3) { return ["$whole-1-3", "$whole 1/3"]; }
    if (abs($frac - 2 / 3) < 1e-3) { return ["$whole-2-3", "$whole 2/3"]; }
    $dec = rtrim(substr(sprintf('%.2f', $frac), 2), '0');
    $sep = ($whole < 10 && (int) $dec > $whole) ? 'k' : '-';
    // Two decimal digits after a "-" could read as a range ("12-15" = 12/15): mark them, "12,15" → "12-15d".
    $mark = ($sep === '-' && strlen($dec) > 1) ? 'd' : '';
    return [$whole . $sep . $dec . $mark, $whole . ',' . $dec];
}

/** Group of a single size number, or null when it is out of every band. */
function mos_size_num_group(float $v): ?string {
    $whole = abs($v - round($v)) < 1e-9;
    if ($v < 0) { return null; }
    if ($v < 16) { return 'other'; }
    if ($v < 51) { return 'shoe'; }
    if ($v <= 176 && $whole) { return 'kids'; }
    return null;
}

function mos_size_range_group(float $a, float $b): ?string {
    if ($b <= $a || $b - $a > 25) { return null; }
    if ($b < 16) { return 'other'; }
    if ($a >= 16 && $b < 51) { return 'shoe'; }
    if ($a >= 62 && $b <= 176) { return 'kids'; }
    if ($a >= 50 && $b - $a == 6.0) { return 'kids'; }   // baby height pair 50/56, 56/62 (6 cm steps)
    if ($a >= 50 && $b <= 65) { return 'other'; }         // head circumference 55-59, 61-63
    return null;
}

const MOS_SIZE_LETTERS = [1 => '4XS', 2 => '3XS', 3 => 'XXS', 4 => 'XS', 5 => 'S', 6 => 'M',
                          7 => 'L', 8 => 'XL', 9 => 'XXL', 10 => '3XL', 11 => '4XL', 12 => '5XL'];

/** Rank (1 = 4XS … 12 = 5XL) of one letter-size token such as "XXL", "2XL", "XS", or null. */
function mos_size_letter_rank(string $tok): ?int {
    if ($tok === 'M') { return 6; }
    if (!preg_match('/^(\d?)(X*)(S|L)$/', $tok, $m)) { return null; }
    if ($m[1] !== '') {
        if (strlen($m[2]) !== 1) { return null; }
        $n = (int) $m[1];
    } else {
        $n = strlen($m[2]);
    }
    if ($m[3] === 'S') { return $n <= 4 ? 5 - $n : null; }
    return $n <= 5 ? 7 + $n : null;
}

function mos_size_letter_term(int $rank, bool $kids): array {
    $label = MOS_SIZE_LETTERS[$rank];
    if ($kids) {
        // Children's letter sizes sort with the heights they correspond to (XS ≈ 116 … XL ≈ 164).
        return mos_size_term(strtolower($label) . '-barna', "$label barna", 'kids', 68 + $rank * 12 + 0.5);
    }
    return mos_size_term(strtolower($label), $label, 'letter', (float) $rank);
}

function mos_size_normalise_letters(string $s): ?array {
    $u = mb_strtoupper($s, 'UTF-8');
    $u = (string) preg_replace(['/^X-?LARGE\b/u', '/^XX-?LARGE\b/u', '/^SMALL\b/u', '/^MEDIUM\b/u', '/^LARGE\b/u'],
                               ['XL', 'XXL', 'S', 'M', 'L'], $u);
    if ($u === 'SX') { $u = 'XS'; }

    $tok = '(\d?X*[SML])';
    if (preg_match("/^$tok ?[-\\/] ?$tok$/u", $u, $m)) {
        $r1 = mos_size_letter_rank($m[1]);
        $r2 = mos_size_letter_rank($m[2]);
        if ($r1 !== null && $r2 !== null && $r2 > $r1 && $r2 - $r1 <= 3) {
            $a = MOS_SIZE_LETTERS[$r1];
            $b = MOS_SIZE_LETTERS[$r2];
            return mos_size_term(strtolower("$a-$b"), "$a/$b", 'letter', $r1 + 0.5);
        }
        // Not an ascending range: "M/S", "L/S" are M and L in Short (read on as a qualifier below).
    }
    if (!preg_match("/^(A|C|Y|\\dY)?$tok(.*)$/u", $u, $m)) { return null; }
    [, $prefix, $size, $rest] = $m;
    if (strlen($prefix) === 2 && preg_match('/^X(S|L)$/', $size)) { $size = $prefix[0] . $size; } // 2YXS = 2XS
    $rank = mos_size_letter_rank($size);
    if ($rank === null) { return null; }
    $kids = in_array($prefix[0] ?? '', ['C', 'Y'], true) || ctype_digit($prefix[0] ?? '');

    $rest = trim((string) preg_replace('/^[\s\-\/]+/u', '', $rest));
    $ok = $rest === ''
        || preg_match('/^(T|TALL|S|SHORT|LONG|REGULAR|R)$/u', $rest)
        || preg_match('/^[A-F]{1,2}( ?[-\/] ?[A-F])? ?(CUP|SKÁL)?$/u', $rest)
        || preg_match('/^\d{1,2} ?("|IN|INCH)?$/u', $rest)
        || preg_match('/^(KVK|KK|KARLA|KVENNA|HERRAST(Æ|AE)R(Ð|D)|D(Ö|O)MUST(Æ|AE)R(Ð|D)|FULL?OR(Ð|D)INS|ADULT)$/u', $rest);
    if (!$ok && preg_match('/^(BARNAST(Æ|AE)R(Ð|D)|BARNA|KIDS|YOUTH|JR|JUNIOR)$/u', $rest)) {
        $ok = true;
        $kids = true;
    }
    return $ok ? mos_size_letter_term($rank, $kids) : null;
}

/** @return array{slug: string, label: string, group: string, sort: float}|null */
function mos_size_normalise(string $raw): ?array {
    $s = mos_size_clean($raw);
    if ($s === '') { return null; }
    $l = mb_strtolower($s, 'UTF-8');
    $ae = '(æ|ae|a)';
    $d  = '(ð|d)';

    if (preg_match("/^(one ?size( fits all)?|onesize|os|osfa|ein ?st{$ae}r{$d}|einst{$ae}r{$d})$/u", $l)) {
        return mos_size_term('ein-staerd', 'Ein stærð', 'other', -1);
    }
    if (preg_match('/^(newborn|nýfætt|nyfaett|nb)$/u', $l)) {
        return mos_size_term('nyfaett', 'Nýfætt', 'kids', 49);
    }
    if (preg_match("/^(barna|kids?|youth|junior|jr\\.?|barnast\\.?|barnast{$ae}r{$d})$/u", $l)) {
        return mos_size_term('barna', 'Barna', 'other', 900);
    }
    if (preg_match("/^(adult|senior|sr\\.?|full?or{$d}ins|full?or{$d}insst\\.?|full?or{$d}insst{$ae}r{$d})$/u", $l)) {
        return mos_size_term('fullordins', 'Fullorðins', 'other', 901);
    }
    if (preg_match('/^(\d{1,2})(?: ?[-\/] ?(\d{1,2}))? ?(m|mán\.?|mánaða|mánuðir|man|months?|mths?)$/u', $l, $m)) {
        $a = (int) $m[1];
        $b = isset($m[2]) && $m[2] !== '' ? (int) $m[2] : null;
        if ($b !== null && $b <= $a) { return null; }
        return $b === null
            ? mos_size_term("{$a}m", "$a mán.", 'kids', 50 + $a * 2)
            : mos_size_term("$a-{$b}m", "$a-$b mán.", 'kids', 50 + $a * 2 + ($b - $a) / 100);
    }
    if (preg_match('/^(\d{1,2})(?: ?[-\/] ?(\d{1,2}))? ?(ára|ara|ár|years?|yrs?|y)$/u', $l, $m)) {
        $a = (int) $m[1];
        $b = isset($m[2]) && $m[2] !== '' ? (int) $m[2] : null;
        if ($b !== null && $b <= $a) { return null; }
        return $b === null
            ? mos_size_term("$a-ara", "$a ára", 'kids', 77 + $a * 6)
            : mos_size_term("$a-$b-ara", "$a-$b ára", 'kids', 77 + $a * 6 + ($b - $a) / 100);
    }
    if (preg_match('/^(\d{1,2})t$/u', $l, $m)) {
        $a = (int) $m[1];
        return mos_size_term("{$a}t", "{$a}T", 'kids', 77 + $a * 6 + 0.5);
    }

    // Numbers (decimal comma read as a point; a trailing "cm" is only a unit).
    $n = trim((string) preg_replace('/ ?cm$/u', '', str_replace(',', '.', $l)));
    $v = null;
    if (preg_match('/^(\d{2})\/3$/', $n, $m) && (int) $m[1] >= 16 && (int) $m[1] <= 50) {
        $v = (int) $m[1] + ((int) $m[1] % 2 === 0 ? 2 : 1) / 3;            // "42/3": adidas step
    } elseif (preg_match('/^(\d{2})\/([12])3$/', $n, $m) && (int) $m[1] >= 16 && (int) $m[1] <= 50) {
        $v = (int) $m[1] + (int) $m[2] / 3;                                 // "37/13", "40/23"
    } elseif (preg_match('/^(\d{1,2}) ?([12])\/3$/', $n, $m)) {
        $v = (int) $m[1] + (int) $m[2] / 3;                                 // "38 2/3", "382/3"
    } elseif (preg_match('/^(\d{1,2}) ?1\/2$/', $n, $m)) {
        $v = (int) $m[1] + 0.5;                                             // "38 1/2"
    } elseif (preg_match('/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/', $n)) {
        $v = (float) $n;
    }
    if ($v !== null) {
        $group = mos_size_num_group($v);
        if ($group === null) { return null; }
        [$slug, $label] = mos_size_fmt($v);
        return mos_size_term($slug, $label, $group, $v);
    }
    // Trousers waist × length: "32X32", "W33/L30", or "34/30" (a descending pair is never a range).
    if (preg_match('/^w?(2[4-9]|3\d|4[0-4]) ?(x|\/) ?l?(2[6-9]|3[0-6])$/', $n, $m) && ($m[2] === 'x' || (int) $m[3] <= (int) $m[1] || $n[0] === 'w')) {
        return mos_size_term("w{$m[1]}-l{$m[3]}", "W{$m[1]}/L{$m[3]}", 'other', 400 + (int) $m[1] + (int) $m[3] / 100);
    }
    $num = '((?:0|[1-9]\d{0,2})(?:\.\d{1,2})?)';
    if (preg_match("/^$num ?[-\\/] ?$num$/", $n, $m)) {
        $a = (float) $m[1];
        $b = (float) $m[2];
        $group = mos_size_range_group($a, $b);
        if ($group === null) { return null; }
        [$sa, $la] = mos_size_fmt($a);
        [$sb, $lb] = mos_size_fmt($b);
        return mos_size_term("$sa-$sb", "$la/$lb", $group, $a + ($b - $a) / 1000);
    }

    $letter = mos_size_normalise_letters($s);
    if ($letter !== null) { return $letter; }

    $u = mb_strtoupper($s, 'UTF-8');
    if (preg_match('/^0{2,3}$/', $u)) { return mos_size_term($u, $u, 'other', -0.5); }
    if (preg_match('/^(\d)X$/', $u, $m)) { return mos_size_term("{$m[1]}x", "{$m[1]}X", 'other', 100 + (int) $m[1]); }
    if (preg_match('/^(\d{1,2})\+$/', $u, $m)) { return mos_size_term("{$m[1]}-plus", "{$m[1]}+", 'other', (int) $m[1] + 0.6); }
    if (preg_match('/^T(\d)$/', $u, $m)) { return mos_size_term("t{$m[1]}", "T{$m[1]}", 'other', 200 + (int) $m[1]); }
    if (preg_match('/^(2[89]|3\d|4[0-8]|6[5-9]|[7-9]\d|100)([A-G]{1,2})$/', $u, $m)) {
        return mos_size_term(strtolower($u), $u, 'other', 300 + (int) $m[1] / 1000);
    }
    return null;
}

/* ------------------------------------------------------------------------
 * 2. Which attributes are sizes.
 *    Local attributes: by sanitized key — stærðir/stærð/stæðir (+ sko-/barna-, size/sizes), so the
 *    misspelled "stærðir", "STærðir", "Stæðir", "Stærð" all count. Global: pa_<same key>.
 * --------------------------------------------------------------------- */

function mos_size_is_size_key(string $key): bool {
    return (bool) preg_match('/^(sko|barna)?staer?d(ir)?$|^sizes?$/', $key);
}

/** @return string[] global attribute taxonomies that hold sizes (pa_staerdir, pa_skostaerdir). */
function mos_size_global_taxonomies(): array {
    static $taxonomies = null;
    if ($taxonomies === null) {
        $taxonomies = [];
        foreach (wc_get_attribute_taxonomy_names() as $taxonomy) {
            if (mos_size_is_size_key(substr($taxonomy, 3))) { $taxonomies[] = $taxonomy; }
        }
    }
    return $taxonomies;
}

/* ------------------------------------------------------------------------
 * 3. Compute: the sizes a product is available in. Read straight from the tables (4 queries per
 *    batch, any batch size), so the hooks and the CLI share one code path.
 *    - A size attribute that variations use: a size counts when at least one published variation
 *      with that size (or with "any" for it) is in stock or on backorder.
 *    - Otherwise (simple products, attributes not used for variations): every value counts while the
 *      product itself is in stock or on backorder; none when it is out of stock.
 *    A variation's own value wins over the parent's list (they can differ in spelling: "42 2/3"
 *    vs "422/3"); global-attribute variations hold a term slug, resolved to the term's name (the
 *    slug itself is lossy: "365" is "36,5"). A slug the product no longer has is stale and skipped.
 * --------------------------------------------------------------------- */

/**
 * @param int[] $ids product ids
 * @param array<string, int> $unmapped raw value => products, for values the normaliser rejects
 * @return array<int, array<string, array{slug: string, label: string, group: string, sort: float}>>
 */
function mos_size_compute(array $ids, array &$unmapped = []): array {
    global $wpdb;
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
    if (!$ids) { return []; }
    $in = implode(',', $ids);

    $attrs = [];
    $stock = [];
    // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $in is integers only.
    foreach ($wpdb->get_results("SELECT post_id, meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id IN ($in) AND meta_key IN ('_product_attributes', '_stock_status')") as $row) {
        if ($row->meta_key === '_stock_status') {
            $stock[(int) $row->post_id] = (string) $row->meta_value;
        } else {
            $attrs[(int) $row->post_id] = maybe_unserialize($row->meta_value);
        }
    }

    // Global size attribute terms per product: taxonomy => slug => name.
    $global = [];
    $taxonomies = mos_size_global_taxonomies();
    if ($taxonomies) {
        $tax_in = "'" . implode("','", array_map('esc_sql', $taxonomies)) . "'";
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        foreach ($wpdb->get_results("SELECT tr.object_id, tt.taxonomy, t.slug, t.name FROM {$wpdb->term_relationships} tr INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id INNER JOIN {$wpdb->terms} t ON t.term_id = tt.term_id WHERE tr.object_id IN ($in) AND tt.taxonomy IN ($tax_in)") as $row) {
            $global[(int) $row->object_id][$row->taxonomy][$row->slug] = html_entity_decode((string) $row->name, ENT_QUOTES, 'UTF-8');
        }
    }

    // Variations: parent => variation => ['status', 'stock', 'attrs' => key => value].
    $variations = [];
    // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
    foreach ($wpdb->get_results("SELECT v.ID, v.post_parent, v.post_status, pm.meta_key, pm.meta_value FROM {$wpdb->posts} v INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = v.ID WHERE v.post_type = 'product_variation' AND v.post_parent IN ($in) AND (pm.meta_key = '_stock_status' OR pm.meta_key LIKE 'attribute\\_%')") as $row) {
        $var = &$variations[(int) $row->post_parent][(int) $row->ID];
        $var['status'] = $row->post_status;
        if ($row->meta_key === '_stock_status') {
            $var['stock'] = (string) $row->meta_value;
        } else {
            $var['attrs'][substr($row->meta_key, 10)] = (string) $row->meta_value;
        }
        unset($var);
    }

    $result = [];
    foreach ($ids as $id) {
        // Each source: attribute key on variations => [raw values, variation value => raw value].
        $sources = [];
        foreach (is_array($attrs[$id] ?? null) ? $attrs[$id] : [] as $key => $attr) {
            if (!is_array($attr) || !empty($attr['is_taxonomy']) || !mos_size_is_size_key((string) $key)) { continue; }
            $values = array_values(array_filter(array_map('trim', explode('|', (string) ($attr['value'] ?? ''))), 'strlen'));
            $lookup = [];
            foreach ($values as $value) {
                $lookup[$value] = $value;
                $lookup[mb_strtolower($value, 'UTF-8')] = $value;
                $lookup[sanitize_title($value)] = $value;
            }
            $sources[(string) $key] = [$values, $lookup];
        }
        foreach ($global[$id] ?? [] as $taxonomy => $terms) {
            $sources[$taxonomy] = [array_values($terms), $terms, true];
        }

        $available = in_array($stock[$id] ?? '', MOS_SIZE_AVAILABLE, true);
        $raw_sizes = [];
        foreach ($sources as $key => $source) {
            [$values, $lookup] = $source;
            $is_global = !empty($source[2]);
            $used = false;
            $picked = [];
            foreach ($variations[$id] ?? [] as $var) {
                if (!array_key_exists($key, $var['attrs'] ?? [])) { continue; }
                $used = true;
                if (($var['status'] ?? '') !== 'publish' || !in_array($var['stock'] ?? '', MOS_SIZE_AVAILABLE, true)) { continue; }
                $value = $var['attrs'][$key];
                if ($value === '') {                       // "any size" variation
                    foreach ($values as $v) { $picked[$v] = true; }
                    continue;
                }
                $raw = $lookup[$value] ?? $lookup[mb_strtolower($value, 'UTF-8')] ?? null;
                if ($raw === null && $is_global) { continue; } // stale slug the product no longer has (e.g. "l-en"): not sellable
                $picked[$raw ?? $value] = true;
            }
            if (!$used && $available) {
                foreach ($values as $v) { $picked[$v] = true; }
            }
            $raw_sizes += $picked;
        }

        $terms = [];
        foreach (array_keys($raw_sizes) as $raw) {
            $term = mos_size_normalise((string) $raw);
            if ($term === null) {
                $unmapped[(string) $raw] = ($unmapped[(string) $raw] ?? 0) + 1;
                continue;
            }
            $terms[$term['slug']] = $term;
        }
        $result[$id] = $terms;
    }
    return $result;
}

/* ------------------------------------------------------------------------
 * 3b. Guards. The filters below lean on WooCommerce internals (FilterDataProvider, ProductQuery,
 *     ProductQueryFilters, the filter-data cache) that a Woo update can rename or change. On the live
 *     request path a failure must never break a listing: it is logged and the request is answered
 *     as if this plugin weren't there.
 * --------------------------------------------------------------------- */

/**
 * Run $fn; on any Throwable log "mos-size-index: <what> failed: …" and return $fallback.
 *
 * @template T
 * @param callable(): T $fn
 * @param T $fallback
 * @return T
 */
function mos_size_guarded(string $what, callable $fn, $fallback) {
    try {
        return $fn();
    } catch (\Throwable $e) {
        error_log("mos-size-index: $what failed: " . $e->getMessage());
        return $fallback;
    }
}

/** Woo's filter-data provider (collection-data counts with a recomputed tax_query) is there as expected. */
function mos_size_filter_data_available(): bool {
    return function_exists('wc_get_container')
        && class_exists(\Automattic\WooCommerce\Internal\ProductFilters\FilterDataProvider::class)
        && class_exists(\Automattic\WooCommerce\StoreApi\Utilities\ProductQuery::class)
        && method_exists(\Automattic\WooCommerce\Internal\ProductFilters\FilterDataProvider::class, 'with');
}

/** The Store API's ProductQueryFilters, which counts collection-data, is there as expected. */
function mos_size_query_filters_available(): bool {
    $class = \Automattic\WooCommerce\StoreApi\Utilities\ProductQueryFilters::class;
    return class_exists($class) && method_exists($class, 'get_taxonomy_counts') && method_exists($class, 'get_stock_status_counts');
}

/* ------------------------------------------------------------------------
 * 4. Write: the product's mos_size terms (the only thing this plugin ever writes).
 * --------------------------------------------------------------------- */

function mos_size_term_id(array $term): int {
    static $ids = [];
    if (isset($ids[$term['slug']])) { return $ids[$term['slug']]; }
    $existing = get_term_by('slug', $term['slug'], MOS_SIZE_TAXONOMY);
    if ($existing instanceof WP_Term) { return $ids[$term['slug']] = (int) $existing->term_id; }
    $created = wp_insert_term($term['label'], MOS_SIZE_TAXONOMY, ['slug' => $term['slug']]);
    if (is_wp_error($created)) {
        $dupe = (int) $created->get_error_data('term_exists');
        if ($dupe > 0) { return $ids[$term['slug']] = $dupe; }
        throw new RuntimeException('mos_size: ' . $created->get_error_message());
    }
    return $ids[$term['slug']] = (int) $created['term_id'];
}

/**
 * Set each product's mos_size terms to the computed ones (no write when unchanged).
 *
 * @param array<int, array<string, array>> $computed from mos_size_compute()
 * @return int products whose terms changed
 */
function mos_size_apply(array $computed): int {
    $changed = 0;
    foreach ($computed as $id => $terms) {
        $want = [];
        foreach ($terms as $term) { $want[] = mos_size_term_id($term); }
        sort($want);
        $have = wp_get_object_terms($id, MOS_SIZE_TAXONOMY, ['fields' => 'ids']);
        $have = is_wp_error($have) ? [] : array_map('intval', $have);
        sort($have);
        if ($want === $have) { continue; }
        $set = wp_set_object_terms($id, $want, MOS_SIZE_TAXONOMY, false);
        if (is_wp_error($set)) { throw new RuntimeException('mos_size: ' . $set->get_error_message()); }
        $changed++;
    }
    return $changed;
}

/** Drop cached counts once the index changed: Woo's filter-data transients and our size list. */
function mos_size_invalidate_caches(): void {
    delete_transient(MOS_SIZE_LIST_KEY);
    $class = \Automattic\WooCommerce\Internal\ProductFilters\CacheController::class;
    if (function_exists('wc_get_container') && class_exists($class) && method_exists($class, 'invalidate_filter_data_cache')) {
        wc_get_container()->get($class)->invalidate_filter_data_cache();
    }
}

/* ------------------------------------------------------------------------
 * 5. Taxonomy: hidden, not public, no UI, not in REST. Only this plugin's filters query it.
 * --------------------------------------------------------------------- */

add_action('init', static function () {
    register_taxonomy(MOS_SIZE_TAXONOMY, ['product'], [
        'label'              => 'Stærðir (sía)',
        'public'             => false,
        'publicly_queryable' => false,
        'hierarchical'       => false,
        'show_ui'            => false,
        'show_in_menu'       => false,
        'show_in_nav_menus'  => false,
        'show_tagcloud'      => false,
        'show_in_quick_edit' => false,
        'show_admin_column'  => false,
        'show_in_rest'       => false,
        'meta_box_cb'        => false,
        'query_var'          => false,
        'rewrite'            => false,
    ]);
}, 20);

/* ------------------------------------------------------------------------
 * 6. Sync. Saves and stock changes queue the product (a variation queues its parent); the queue is
 *    recomputed once: before the response of a REST request that writes products (so an API client
 *    reading back sees the index), otherwise at the very end of shutdown, after the response has been
 *    sent (fastcgi_finish_request) and after WooCommerce's own shutdown work (session save). These
 *    hooks also run when an order reduces stock, so a failure is logged and swallowed — it must never
 *    break or slow a checkout. Large queues (imports, batch edits) are recomputed 200 products at a time.
 * --------------------------------------------------------------------- */

const MOS_SIZE_FLUSH_CHUNK = 200;

function mos_size_queue(int $product_id): void {
    if ($product_id <= 0) { return; }
    if (empty($GLOBALS['mos_size_dirty'])) {
        $GLOBALS['mos_size_dirty'] = [];
        if (!has_action('shutdown', 'mos_size_shutdown_flush')) { add_action('shutdown', 'mos_size_shutdown_flush', PHP_INT_MAX); }
    }
    $GLOBALS['mos_size_dirty'][$product_id] = true;
}

/** Whether a REST request writes products: WC REST products, a product, its variations, or their batch routes.
 *  (Categories, tags, attributes, reviews, orders and the Store API are not product writes.) */
function mos_size_is_product_write(string $method, string $route): bool {
    if (in_array(strtoupper($method), ['GET', 'HEAD', 'OPTIONS'], true)) { return false; }
    return (bool) preg_match('#^/wc/v[1-3]/products(/batch|/\d+(/variations(/batch|/\d+)?)?)?/?$#', $route);
}

/**
 * Call $apply once per chunk of distinct ids; a failing chunk is logged and the next one still runs.
 *
 * @param int[] $ids
 * @param callable(int[]): void $apply
 * @return int chunks that failed
 */
function mos_size_process_in_chunks(array $ids, callable $apply, int $size = MOS_SIZE_FLUSH_CHUNK): int {
    $failed = 0;
    foreach (array_chunk(array_values(array_unique(array_map('intval', $ids))), max(1, $size)) as $chunk) {
        try {
            $apply($chunk);
        } catch (\Throwable $e) {
            $failed++;
            error_log('mos-size-index: sync failed for ' . implode(',', $chunk) . ': ' . $e->getMessage());
        }
    }
    return $failed;
}

/** End of the request: answer the client first (php-fpm), then recompute the queue. */
function mos_size_shutdown_flush(): void {
    if (empty($GLOBALS['mos_size_dirty'])) { return; }
    if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); }
    mos_size_flush();
}

function mos_size_queue_parent(int $variation_id): void {
    mos_size_queue((int) wp_get_post_parent_id($variation_id));
}

function mos_size_flush(): void {
    $ids = array_keys($GLOBALS['mos_size_dirty'] ?? []);
    $GLOBALS['mos_size_dirty'] = [];
    if (!$ids || !taxonomy_exists(MOS_SIZE_TAXONOMY)) { return; }
    $changed = 0;
    mos_size_process_in_chunks($ids, static function (array $chunk) use (&$changed) {
        $chunk = array_values(array_filter($chunk, static fn ($id) => get_post_type($id) === 'product'));
        if ($chunk) { $changed += mos_size_apply(mos_size_compute($chunk)); }
    });
    if ($changed > 0) { mos_size_guarded('cache invalidation', 'mos_size_invalidate_caches', null); }
}

add_action('woocommerce_new_product', static fn ($id) => mos_size_queue((int) $id));
add_action('woocommerce_update_product', static fn ($id) => mos_size_queue((int) $id));
add_action('woocommerce_product_set_stock_status', static fn ($id) => mos_size_queue((int) $id));
add_action('woocommerce_variable_product_sync_data', static function ($product) {
    if ($product instanceof WC_Product) { mos_size_queue($product->get_id()); }
});
add_action('woocommerce_new_product_variation', static fn ($id) => mos_size_queue_parent((int) $id));
add_action('woocommerce_update_product_variation', static fn ($id) => mos_size_queue_parent((int) $id));
add_action('woocommerce_save_product_variation', static fn ($id) => mos_size_queue_parent((int) $id));
add_action('woocommerce_variation_set_stock_status', static function ($id, $status = '', $product = null) {
    mos_size_queue($product instanceof WC_Product ? $product->get_parent_id() : (int) wp_get_post_parent_id((int) $id));
}, 10, 3);
add_action('woocommerce_trash_product_variation', static fn ($id) => mos_size_queue_parent((int) $id));
add_action('before_delete_post', static function ($id, $post = null) {
    if ($post instanceof WP_Post && $post->post_type === 'product_variation') { mos_size_queue((int) $post->post_parent); }
}, 10, 2);
add_filter('rest_post_dispatch', static function ($response, $server = null, $request = null) {
    if (!empty($GLOBALS['mos_size_dirty']) && $request instanceof WP_REST_Request
        && mos_size_is_product_write($request->get_method(), $request->get_route())) {
        mos_size_flush();
    }
    return $response;
}, 99, 3);

/* ------------------------------------------------------------------------
 * 7. Store API: `mos_size=<slugs>` (OR within, AND with the rest) on /products and
 *    /products/collection-data, and `mos_size_counts=1` on collection-data. Same shape as
 *    `mos_and_cat` in mos-headless-api.php: a request-scoped global read by pre_get_posts.
 * --------------------------------------------------------------------- */

/** @return string[] valid slugs from a `mos_size` param value (string "a,b" or array). */
function mos_size_param_slugs($raw): array {
    $parts = is_array($raw) ? $raw : explode(',', (string) $raw);
    $slugs = [];
    foreach ($parts as $part) {
        if (!is_scalar($part)) { continue; }    // mos_size[]=…[] and the like: not a size
        $slug = sanitize_title((string) $part);
        if ($slug !== '') { $slugs[$slug] = true; }
    }
    // array_keys() turns numeric slugs ("42") into ints: cast back, callers compare strictly.
    return array_slice(array_map('strval', array_keys($slugs)), 0, MOS_SIZE_MAX_PARAM);
}

/** term ids for slugs; [0] when none exist, so the clause matches nothing (an unknown size has no products). */
function mos_size_slug_term_ids(array $slugs): array {
    $ids = get_terms(['taxonomy' => MOS_SIZE_TAXONOMY, 'slug' => $slugs, 'hide_empty' => false, 'fields' => 'ids']);
    $ids = is_wp_error($ids) ? [] : array_map('intval', $ids);
    return $ids ?: [0];
}

function mos_size_clause(array $slugs): array {
    return [
        'taxonomy' => MOS_SIZE_TAXONOMY,
        'field'    => 'term_id',
        'terms'    => mos_size_slug_term_ids($slugs),
        'operator' => 'IN',
    ];
}

add_filter('rest_request_before_callbacks', static function ($response, $handler, $request) {
    if ($request instanceof WP_REST_Request && strpos($request->get_route(), '/wc/store/v1/products') === 0) {
        $GLOBALS['mos_size'] = mos_size_param_slugs($request->get_param('mos_size') ?? '');
    }
    return $response;
}, 10, 3);

add_action('pre_get_posts', static function (WP_Query $query) {
    $slugs = $GLOBALS['mos_size'] ?? [];
    if (!$slugs || !in_array('product', (array) $query->get('post_type'), true)) { return; }
    $tax_query = (array) ($query->get('tax_query') ?: []);
    $tax_query[] = mos_size_clause($slugs);
    $query->set('tax_query', $tax_query);
});

// Woo caches collection-data counts by query vars, which don't carry our clause: recompute with it
// folded in under a marker key (a distinct cache entry; the marker stops the recursion). Composes
// with the `mos_and_cat` filter (priority 10): whichever runs first recurses, the other then folds
// its own clause in. The marker also records mos_and_cat, which pre_get_posts adds to the ID query
// for count types that filter doesn't recompute (stock), so their cache entries stay distinct.
// Woo-internal calls: guarded (section 3b) — on failure Woo computes the count itself, without the size clause.
add_filter('woocommerce_pre_product_filter_data', static function ($pre, $type, $query_vars, $extra) {
    $slugs = $GLOBALS['mos_size'] ?? [];
    if ($pre !== null || !$slugs || !empty($query_vars['mos_size']) || !mos_size_filter_data_available()) {
        return $pre;
    }
    return mos_size_guarded("filter data ($type)", static function () use ($pre, $type, $query_vars, $extra, $slugs) {
        $query_vars['mos_size'] = ['size' => $slugs, 'and_cat' => $GLOBALS['mos_and_cat'] ?? []];
        $query_vars['tax_query'] = array_merge((array) ($query_vars['tax_query'] ?? []), [mos_size_clause($slugs)]);
        $data = wc_get_container()
            ->get(\Automattic\WooCommerce\Internal\ProductFilters\FilterDataProvider::class)
            ->with(new \Automattic\WooCommerce\StoreApi\Utilities\ProductQuery());
        $taxonomy = (string) ($extra['taxonomy'] ?? '');
        switch ($type) {
            case 'taxonomy':  return $data->get_taxonomy_counts($query_vars, $taxonomy);
            case 'attribute': return $data->get_attribute_counts($query_vars, $taxonomy);
            case 'price':     return $data->get_filtered_price($query_vars);
            case 'rating':    return $data->get_rating_counts($query_vars);
            case 'stock':     return $data->get_stock_status_counts($query_vars, array_keys(wc_get_product_stock_status_options()));
            default:          return $pre;
        }
    }, $pre);
}, 11, 4);

/** All mos_size terms: term_taxonomy_id => {slug,label,group,sort,count}; count = published products. */
function mos_size_all_terms(): array {
    $terms = get_terms(['taxonomy' => MOS_SIZE_TAXONOMY, 'hide_empty' => false]);
    $out = [];
    foreach (is_wp_error($terms) ? [] : $terms as $term) {
        $label = html_entity_decode($term->name, ENT_QUOTES, 'UTF-8');
        $norm = mos_size_normalise($label);
        $out[(int) $term->term_taxonomy_id] = [
            'slug'  => $term->slug,
            'label' => $label,
            'group' => $norm['group'] ?? 'other',
            'sort'  => $norm['sort'] ?? 9999.0,
            'count' => (int) $term->count,
        ];
    }
    return $out;
}

function mos_size_sort_items(array $items): array {
    $rank = array_flip(MOS_SIZE_GROUPS);
    usort($items, static fn ($a, $b) => [$rank[$a['group']] ?? 9, $a['sort'], $a['slug']] <=> [$rank[$b['group']] ?? 9, $b['sort'], $b['slug']]);
    return $items;
}

// collection-data with mos_size_counts=1: per-size counts for the current filters with the size
// filter itself left out (so every size option shows what picking it would add — OR within sizes).
// Counted by Woo's own taxonomy-count path, so it shares its product-ID query and transient cache.
function mos_size_counts_field(WP_REST_Request $request, array $selected): array {
    $count_request = clone $request;
    $count_request->set_param('mos_size', null);
    // The size clause comes from the request-scoped global (pre_get_posts): off while sizes are counted.
    $GLOBALS['mos_size'] = [];
    try {
        $counts = (new \Automattic\WooCommerce\StoreApi\Utilities\ProductQueryFilters())->get_taxonomy_counts($count_request, [MOS_SIZE_TAXONOMY]);
    } finally {
        $GLOBALS['mos_size'] = $selected;
    }

    $terms = mos_size_all_terms();
    $items = [];
    foreach ($counts as $tt_id => $count) {
        if (isset($terms[(int) $tt_id]) && (int) $count > 0) {
            $items[$terms[(int) $tt_id]['slug']] = ['count' => (int) $count] + $terms[(int) $tt_id];
        }
    }
    foreach ($terms as $term) {   // a selected size stays listed (count 0) so its chip keeps a label
        if (in_array($term['slug'], $selected, true) && !isset($items[$term['slug']])) {
            $items[$term['slug']] = ['count' => 0] + $term;
        }
    }
    return array_map(
        static fn ($i) => ['slug' => $i['slug'], 'label' => $i['label'], 'group' => $i['group'], 'sort' => $i['sort'], 'count' => $i['count']],
        mos_size_sort_items(array_values($items))
    );
}

/**
 * `mos_price_ranges`: "min:max,min:max" (inclusive, the Store API's minor units, either side may be open).
 * Malformed or inverted ranges are skipped; at most 8.
 *
 * @return array<int, array{0: ?int, 1: ?int}>
 */
function mos_size_parse_price_ranges($raw): array {
    $parts = is_array($raw) ? $raw : explode(',', (string) ($raw ?? ''));
    $ranges = [];
    foreach ($parts as $part) {
        if (!is_scalar($part) || !preg_match('/^\s*(\d{0,12}):(\d{0,12})\s*$/', (string) $part, $m) || ($m[1] === '' && $m[2] === '')) { continue; }
        $min = $m[1] === '' ? null : (int) $m[1];
        $max = $m[2] === '' ? null : (int) $m[2];
        if ($min !== null && $max !== null && $max < $min) { continue; }
        $ranges[] = [$min, $max];
        if (count($ranges) === 8) { break; }
    }
    return $ranges;
}

/** Products matching a query, from its stock-status counts: every status, or only the ones it is limited to. */
function mos_size_sum_stock(array $counts, array $only): int {
    $n = 0;
    foreach ($counts as $status => $count) {
        if (!$only || in_array((string) $status, $only, true)) { $n += (int) $count; }
    }
    return $n;
}

// collection-data with mos_extra_counts=1: one match count per `mos_price_ranges` range (that range in
// place of the request's own min/max price) and, with mos_sale_count=1, with on_sale added — each
// within every other filter, exactly as a collection-data request of its own with
// calculate_stock_status_counts would count it (the storefront's old per-preset path). A count that
// fails is null; the storefront then shows that option without a count.
function mos_size_extra_counts_field(WP_REST_Request $request): array {
    $filters = new \Automattic\WooCommerce\StoreApi\Utilities\ProductQueryFilters();
    $only = array_values(array_filter(array_map('strval', (array) ($request->get_param('stock_status') ?? [])), 'strlen'));
    $count = static fn (WP_REST_Request $r): int => mos_size_sum_stock((array) $filters->get_stock_status_counts($r), $only);
    $out = ['price' => [], 'on_sale' => null];
    foreach (mos_size_parse_price_ranges($request->get_param('mos_price_ranges')) as [$min, $max]) {
        $r = clone $request;
        $r->set_param('min_price', $min);
        $r->set_param('max_price', $max);
        $out['price'][] = mos_size_guarded('price count', static fn () => $count($r), null);
    }
    if (rest_sanitize_boolean($request->get_param('mos_sale_count') ?? false)) {
        $r = clone $request;
        $r->set_param('on_sale', true);
        $out['on_sale'] = mos_size_guarded('sale count', static fn () => $count($r), null);
    }
    return $out;
}

add_filter('rest_request_after_callbacks', static function ($response, $handler, $request) {
    if (!$request instanceof WP_REST_Request || $request->get_route() !== '/wc/store/v1/products/collection-data'
        || !$response instanceof WP_REST_Response || !mos_size_query_filters_available()) {
        return $response;
    }
    $sizes = rest_sanitize_boolean($request->get_param('mos_size_counts') ?? false);
    $extra = rest_sanitize_boolean($request->get_param('mos_extra_counts') ?? false);
    if (!$sizes && !$extra) { return $response; }
    $data = $response->get_data();
    if (!is_array($data)) { return $response; }
    if ($sizes) {
        $field = mos_size_guarded('size counts', static fn () => mos_size_counts_field($request, $GLOBALS['mos_size'] ?? []), null);
        if ($field === null) { return $response; }   // as if the plugin weren't there: the storefront copes
        $data['mos_size_counts'] = $field;
    }
    if ($extra) {
        $field = mos_size_guarded('extra counts', static fn () => mos_size_extra_counts_field($request), null);
        if ($field !== null) { $data['mos_extra_counts'] = $field; }
    }
    $response->set_data($data);
    return $response;
}, 10, 3);

// The request-scoped size filter ends with the request (never leaks into a later request of a batch).
// Late, so the count fields above still see it.
add_filter('rest_request_after_callbacks', static function ($response, $handler, $request) {
    if ($request instanceof WP_REST_Request && strpos($request->get_route(), '/wc/store/v1/products') === 0) {
        $GLOBALS['mos_size'] = [];
    }
    return $response;
}, 1000, 3);

/* ------------------------------------------------------------------------
 * 8. GET /wp-json/mos/v1/sizes — every size with products: {sizes: [{slug,label,group,sort,count}]},
 *    sorted shoe → letter → kids → other, then by size. Cached for 10 minutes; reindex/purge clear it.
 * --------------------------------------------------------------------- */

add_action('rest_api_init', static function () {
    register_rest_route('mos/v1', '/sizes', [
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => static function () {
            $sizes = get_transient(MOS_SIZE_LIST_KEY);
            if (!is_array($sizes)) {
                $sizes = mos_size_sort_items(array_values(array_filter(mos_size_all_terms(), static fn ($t) => $t['count'] > 0)));
                set_transient(MOS_SIZE_LIST_KEY, $sizes, 10 * 60);
            }
            return new WP_REST_Response(['sizes' => $sizes]);
        },
    ]);
});

/* ------------------------------------------------------------------------
 * 9. WP-CLI: wp mos-size reindex | purge
 * --------------------------------------------------------------------- */

if (defined('WP_CLI') && WP_CLI) {
    /**
     * Build or remove the derived size index (taxonomy mos_size). Product data is never changed.
     */
    class MOS_Size_CLI {
        /** The index is rebuilt either way; a cache that can't be cleared only means counts trail it briefly. */
        private static function invalidate_caches(): void {
            try {
                mos_size_invalidate_caches();
            } catch (\Throwable $e) {
                WP_CLI::warning('Cached counts not cleared (they expire on their own): ' . $e->getMessage());
            }
        }

        /**
         * Recompute every product's sizes (backfill) and print counts per group and unmapped values.
         *
         * ## OPTIONS
         *
         * [--batch=<n>]
         * : Products per batch.
         * ---
         * default: 200
         * ---
         *
         * [--dry-run]
         * : Compute and report only; write nothing.
         *
         * [--unmapped=<n>]
         * : How many unmapped raw values to list.
         * ---
         * default: 40
         * ---
         */
        public function reindex($args, $assoc) {
            global $wpdb;
            $batch = max(1, (int) ($assoc['batch'] ?? 200));
            $dry = !empty($assoc['dry-run']);
            $ids = array_map('intval', $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status IN ('publish', 'private', 'draft', 'pending', 'future') ORDER BY ID"));
            $published = array_flip(array_map('intval', $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status = 'publish'")));

            $start = microtime(true);
            $unmapped = [];
            $pairs = array_fill_keys(MOS_SIZE_GROUPS, 0);
            $distinct = array_fill_keys(MOS_SIZE_GROUPS, []);
            $with = 0;
            $with_published = 0;
            $changed = 0;
            if (!$dry) { wp_defer_term_counting(true); }
            foreach (array_chunk($ids, $batch) as $chunk) {
                $computed = mos_size_compute($chunk, $unmapped);
                foreach ($computed as $id => $terms) {
                    if ($terms) {
                        $with++;
                        if (isset($published[$id])) { $with_published++; }
                    }
                    foreach ($terms as $term) {
                        $pairs[$term['group']]++;
                        $distinct[$term['group']][$term['slug']] = true;
                    }
                }
                if (!$dry) { $changed += mos_size_apply($computed); }
                if (function_exists('wp_cache_flush_runtime')) { wp_cache_flush_runtime(); }
            }
            $pruned = 0;
            if (!$dry) {
                wp_defer_term_counting(false);
                // Terms no product carries any more (sizes that sold out everywhere) are removed.
                foreach (get_terms(['taxonomy' => MOS_SIZE_TAXONOMY, 'hide_empty' => false]) as $term) {
                    $used = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$wpdb->term_relationships} WHERE term_taxonomy_id = %d", $term->term_taxonomy_id));
                    if ($used === 0) { wp_delete_term($term->term_id, MOS_SIZE_TAXONOMY); $pruned++; }
                }
                self::invalidate_caches();
            }

            WP_CLI::log(sprintf('%s %d products (%d published) in %.1fs', $dry ? 'Dry run over' : 'Indexed', count($ids), count($published), microtime(true) - $start));
            WP_CLI::log(sprintf('With ≥1 available size: %d (%d published = %.1f%% of published)', $with, $with_published, count($published) ? 100 * $with_published / count($published) : 0));
            foreach (MOS_SIZE_GROUPS as $group) {
                WP_CLI::log(sprintf('  %-6s %5d product-size pairs, %3d distinct sizes', $group, $pairs[$group], count($distinct[$group])));
            }
            if (!$dry) { WP_CLI::log(sprintf('Products whose sizes changed: %d; empty sizes removed: %d', $changed, $pruned)); }
            arsort($unmapped);
            WP_CLI::log(sprintf('Unmapped raw values: %d distinct, %d product-values', count($unmapped), array_sum($unmapped)));
            foreach (array_slice($unmapped, 0, max(0, (int) ($assoc['unmapped'] ?? 40)), true) as $raw => $n) {
                WP_CLI::log(sprintf('  %4d  "%s"', $n, $raw));
            }
            WP_CLI::success($dry ? 'Dry run done; nothing written.' : 'Size index rebuilt.');
        }

        /**
         * Delete every mos_size term and its product relationships (uninstall step 1).
         */
        public function purge($args, $assoc) {
            $terms = get_terms(['taxonomy' => MOS_SIZE_TAXONOMY, 'hide_empty' => false]);
            $n = 0;
            foreach (is_wp_error($terms) ? [] : $terms as $term) {
                if (wp_delete_term($term->term_id, MOS_SIZE_TAXONOMY) === true) { $n++; }
            }
            self::invalidate_caches();
            WP_CLI::success("Deleted $n mos_size terms and their relationships. Remove mos-size-index.php to finish uninstalling.");
        }
    }
    WP_CLI::add_command('mos-size', 'MOS_Size_CLI');
}
