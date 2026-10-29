<?php
/**
 * Unit test for the small pure helpers in ../mos-size-index.php (no WordPress needed): the failure guard around
 * Woo-internal calls, which REST routes flush the sync queue before answering, the chunked flush, the
 * `mos_price_ranges` parser and stock-count sum behind `mos_extra_counts`, and the `mos_size` param parser.
 *
 * Run: php wp-mu-plugins/tests/mos_size_helpers_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
function add_action(...$args): void {}
function add_filter(...$args): void {}
// sanitize_title() for mos_size_param_slugs: WordPress lower-cases and keeps [a-z0-9-] for these inputs.
function sanitize_title($s): string { return trim((string) preg_replace('/[^a-z0-9-]+/', '-', strtolower((string) $s)), '-'); }

require __DIR__ . '/../mos-size-index.php';

$fail = 0;
$pass = 0;
function check(string $name, bool $ok, string $detail = ''): void {
    global $fail, $pass;
    if ($ok) { $pass++; return; }
    $fail++;
    echo "FAIL $name $detail\n";
}

// F-1: a throwing call is logged and answered with the fallback; a working one passes its value through.
$log = tempnam(sys_get_temp_dir(), 'mos-size-log');
ini_set('error_log', $log);
$response = ['unchanged' => true];
$got = mos_size_guarded('size counts', static function () { throw new Error('Call to undefined method FilterDataProvider::with()'); }, $response);
check('guard returns the fallback on a Throwable', $got === $response);
$logged = (string) file_get_contents($log);
check('guard logs what failed', strpos($logged, 'mos-size-index: size counts failed: Call to undefined method') !== false, $logged);
check('guard passes a value through', mos_size_guarded('x', static fn () => 42, null) === 42);
check('guard catches exceptions too', mos_size_guarded('x', static function () { throw new RuntimeException('db'); }, 'fb') === 'fb');
unlink($log);

// F-1: the Woo internals the filters rely on are checked before use (absent here: no WooCommerce loaded).
check('filter-data internals absent without WooCommerce', mos_size_filter_data_available() === false);
check('collection-data internals absent without WooCommerce', mos_size_query_filters_available() === false);

// F-2: only product writes flush before the REST response; everything else waits for shutdown.
$routes = [
    ['POST', '/wc/v3/products', true],
    ['PUT', '/wc/v3/products/123', true],
    ['PATCH', '/wc/v3/products/123', true],
    ['DELETE', '/wc/v3/products/123', true],
    ['POST', '/wc/v3/products/batch', true],
    ['POST', '/wc/v3/products/123/variations', true],
    ['PUT', '/wc/v3/products/123/variations/456', true],
    ['POST', '/wc/v3/products/123/variations/batch', true],
    ['POST', '/wc/v2/products/123', true],
    ['GET', '/wc/v3/products/123', false],
    ['GET', '/wc/v3/products', false],
    ['POST', '/wc/v3/products/categories', false],
    ['POST', '/wc/v3/products/attributes/5/terms', false],
    ['POST', '/wc/v3/products/reviews', false],
    ['POST', '/wc/v3/orders', false],
    ['POST', '/wc/store/v1/checkout', false],
    ['POST', '/wc/store/v1/cart/add-item', false],
    ['GET', '/wc/store/v1/products', false],
];
foreach ($routes as [$method, $route, $want]) {
    check("product write $method $route", mos_size_is_product_write($method, $route) === $want);
}

// F-2: the dirty set is processed in chunks of 200, and one failing chunk does not stop the rest.
$ids = range(1, 450);
$seen = [];
$n = mos_size_process_in_chunks($ids, static function (array $chunk) use (&$seen) {
    $seen[] = count($chunk);
    if ($chunk[0] === 201) { throw new RuntimeException('chunk 2 failed'); }
}, 200);
check('chunks of 200', $seen === [200, 200, 50], json_encode($seen));
check('failed chunks are counted', $n === 1, (string) $n);
$seen = [];
mos_size_process_in_chunks([5, 5, 7], static function (array $chunk) use (&$seen) { $seen[] = $chunk; }, 200);
check('duplicate ids processed once', $seen === [[5, 7]], json_encode($seen));
$seen = [];
mos_size_process_in_chunks([], static function (array $chunk) use (&$seen) { $seen[] = $chunk; }, 200);
check('nothing to do, no call', $seen === []);

// F-3: `mos_price_ranges` = "min:max,…" (inclusive, minor units, either side open).
check('ranges parse', mos_size_parse_price_ranges(':4999,5000:9999,20000:') === [[null, 4999], [5000, 9999], [20000, null]],
    json_encode(mos_size_parse_price_ranges(':4999,5000:9999,20000:')));
check('array form parses too', mos_size_parse_price_ranges(['1:2']) === [[1, 2]]);
check('junk ranges are skipped, not guessed', mos_size_parse_price_ranges('a:b,5:,-3:4,::,7') === [[5, null]],
    json_encode(mos_size_parse_price_ranges('a:b,5:,-3:4,::,7')));
check('an inverted range is skipped', mos_size_parse_price_ranges('10:5') === []);
check('at most 8 ranges', count(mos_size_parse_price_ranges(implode(',', array_fill(0, 20, '1:2')))) === 8);
check('empty', mos_size_parse_price_ranges('') === [] && mos_size_parse_price_ranges(null) === []);

// F-3: the match count from stock-status counts, as the storefront sums them (facets.matchCountFromStock).
$stock = ['instock' => '10', 'outofstock' => '2', 'onbackorder' => 1];
check('sum of every status', mos_size_sum_stock($stock, []) === 13);
check('only the statuses the query is limited to', mos_size_sum_stock($stock, ['instock']) === 10);
check('several statuses', mos_size_sum_stock($stock, ['instock', 'onbackorder']) === 11);

// F-15: non-scalar parts of `mos_size` are skipped instead of cast.
check('array parts skipped', mos_size_param_slugs(['42', ['x'], null, 43, 'M']) === ['42', '43', 'm'],
    json_encode(mos_size_param_slugs(['42', ['x'], null, 43, 'M'])));
check('string form unchanged', mos_size_param_slugs('42,43,42') === ['42', '43']);

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail === 0 ? 0 : 1);
