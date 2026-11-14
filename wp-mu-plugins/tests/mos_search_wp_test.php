<?php
/**
 * WordPress-level test for ../mos-search.php against the site's own catalogue, through the Store API route the
 * storefront reads (wc/store/v1/products?search=). Read-only apart from the index transient, which it rebuilds.
 * It asserts relations that hold for any catalogue with products, not particular products.
 * Run (local site): wpms eval-file wp-mu-plugins/tests/mos_search_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};
$search = static function (string $q, array $more = []): array {
    $req = new WP_REST_Request('GET', '/wc/store/v1/products');
    $req->set_query_params(['search' => $q, 'per_page' => 5] + $more);
    $res = rest_do_request($req);
    return ['total' => (int) ($res->get_headers()['X-WP-Total'] ?? -1), 'names' => array_map(static fn ($p) => mos_search_fold((string) $p['name']), (array) $res->get_data())];
};

delete_transient(MOS_SEARCH_INDEX_KEY);
$index = mos_search_index();
$check('index: built from the catalogue and stored', count($index['title']) > 0 && is_array(get_transient(MOS_SEARCH_INDEX_KEY)));

// The commonest title word that is long enough to be misspelt, and a second word that shares a product with it.
$by_count = array_map('count', $index['title']);
arsort($by_count);
$common = '';
foreach ($by_count as $word => $n) {
    if (strlen((string) $word) >= 6 && !preg_match('/\d/', (string) $word)) { $common = (string) $word; break; }
}
$check('found a common title word to test with', $common !== '', $common);
$one = $search($common);
$check("one word ($common): products found", $one['total'] > 0, "total {$one['total']}");
$check('the best matches lead: the word is in the first title', isset($one['names'][0]) && str_contains($one['names'][0], mos_search_stem($common)), $one['names'][0] ?? '');

$typo = substr($common, 0, 2) . substr($common, 3); // one letter dropped
if (!isset($index['vocab'][$typo])) {
    $fixed = $search($typo);
    $check("a misspelling ($typo) still finds products", $fixed['total'] > 0, "total {$fixed['total']}");
}

$partner = '';
$ids = $index['title'][$common];
foreach ($by_count as $word => $n) {
    $word = (string) $word;
    if ($word !== $common && strlen($word) >= 4 && !preg_match('/\d/', $word) && !str_contains($word, $common) && !str_contains($common, $word) && array_intersect($ids, $index['title'][$word]) !== []) { $partner = $word; break; }
}
if ($partner !== '') {
    $both = $search("$common $partner");
    $other = $search($partner);
    $check("two words ($common $partner): found, and no more than either alone", $both['total'] > 0 && $both['total'] <= $one['total'] && $both['total'] <= $other['total'], "{$both['total']} vs {$one['total']} / {$other['total']}");
    $swapped = $search("$partner $common");
    $check('word order does not matter', $swapped['total'] === $both['total']);
}

$check('nothing like it in the shop: no products', $search('qqqqqqqq zzzzzzzz')['total'] === 0);
$check('an explicit order is left alone (price)', $search($common, ['orderby' => 'price', 'order' => 'asc'])['total'] === $one['total']);
$plain = new WP_REST_Request('GET', '/wc/store/v1/products');
$plain->set_query_params(['per_page' => 1]);
$check('a query without a search is untouched', (int) (rest_do_request($plain)->get_headers()['X-WP-Total'] ?? 0) >= $one['total']);

echo $fail ? "FAILED: $fail\n" : "ALL PASS\n";
