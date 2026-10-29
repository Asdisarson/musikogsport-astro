<?php
/**
 * Unit test for the pure menu builder in ../mos-nav.php (no WordPress needed).
 *
 * Run: php wp-mu-plugins/tests/mos_nav_rules_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
function add_action(...$args): void {}

require __DIR__ . '/../mos-nav.php';

$pass = 0;
$fail = 0;
function check(string $label, $got, $want): void {
    global $pass, $fail;
    if ($got === $want) { $pass++; return; }
    $fail++;
    printf("FAIL %s\n  want %s\n  got  %s\n", $label, json_encode($want, JSON_UNESCAPED_UNICODE), json_encode($got, JSON_UNESCAPED_UNICODE));
}

/** A product row: category, brand, team and sport term ids. */
function row(array $cat, array $brand = [], array $team = [], array $sport = []): array {
    return ['cat' => $cat, 'brand' => $brand, 'team' => $team, 'sport' => $sport];
}

// Categories: 1 kyn > 2 konur, 3 karlar, 4 born; 10 fatnadur > 11 efri-likami > 12 bolir, 13 peysur; 20 skor > 21 inniskor;
// 30 aefingarvorur > 31 brusar; 40 sale.
$terms = [
    'cat' => [
        1 => ['slug' => 'kyn', 'name' => 'Kyn', 'parent' => 0], 2 => ['slug' => 'konur', 'name' => 'Konur', 'parent' => 1],
        3 => ['slug' => 'karlar', 'name' => 'Karlar', 'parent' => 1], 4 => ['slug' => 'born', 'name' => 'Börn', 'parent' => 1],
        10 => ['slug' => 'fatnadur', 'name' => 'Fatnaður', 'parent' => 0], 11 => ['slug' => 'efri-likami', 'name' => 'Efri líkami', 'parent' => 10],
        12 => ['slug' => 'bolir', 'name' => 'Bolir', 'parent' => 11], 13 => ['slug' => 'peysur', 'name' => 'Peysur', 'parent' => 11],
        20 => ['slug' => 'skor', 'name' => 'Skór', 'parent' => 0], 21 => ['slug' => 'inniskor', 'name' => 'Inniskór', 'parent' => 20],
        30 => ['slug' => 'aefingarvorur', 'name' => 'Æfingavörur', 'parent' => 0], 31 => ['slug' => 'brusar', 'name' => 'Brúsar', 'parent' => 30],
        40 => ['slug' => 'sale', 'name' => 'NETTILBOD', 'parent' => 0],
    ],
    'brand' => [50 => ['slug' => 'nike', 'name' => 'Nike', 'parent' => 0], 51 => ['slug' => 'puma', 'name' => 'Puma', 'parent' => 0]],
    'team' => [60 => ['slug' => 'fh', 'name' => 'FH', 'parent' => 0]],
    'sport' => [70 => ['slug' => 'hlaup', 'name' => 'Hlaup', 'parent' => 0], 71 => ['slug' => 'golf', 'name' => 'Golf', 'parent' => 0]],
];
$products = [];
for ($i = 0; $i < 6; $i++) { $products[] = row([2, 12], [50], [], [70]); }   // 6 women's tops, Nike, running
for ($i = 0; $i < 5; $i++) { $products[] = row([2, 13], [51]); }             // 5 women's sweaters, Puma
for ($i = 0; $i < 2; $i++) { $products[] = row([2, 21], [50], [], [71]); }   // 2 women's slippers (below the minimum)
for ($i = 0; $i < 7; $i++) { $products[] = row([3, 21, 40], [50], [60]); }   // 7 men's slippers on sale, FH
$index = ['terms' => $terms, 'products' => $products];

// Paths and descendants.
check('category path', mos_nav_category_path($terms['cat'], 12), '/voruflokkur/fatnadur/efri-likami/bolir/');
check('descendants include self', mos_nav_descendants($terms['cat'], 11), [11, 12, 13]);

// Counting: products in a category subtree, optionally narrowed.
check('count women in fatnaður', mos_nav_count($index, ['cat' => mos_nav_descendants($terms['cat'], 10)], ['cat' => [2]]), 11);
check('count men', mos_nav_count($index, ['cat' => [3]]), 7);

// Ranked links: by count, at least MOS_NAV_MIN_PRODUCTS, at most $max.
$links = mos_nav_ranked($index, 'brand', ['cat' => [2]], static fn ($slug) => "/brand/$slug/?kyn=konur", 8);
check('ranked brands for women', array_column($links, 'title'), ['Nike', 'Puma']);
check('ranked brand href', $links[0]['href'], '/brand/nike/?kyn=konur');
check('ranked drops thin sports', array_column(mos_nav_ranked($index, 'sport', ['cat' => [2]], static fn ($s) => $s, 8), 'title'), ['Hlaup']);

// The tree.
$tree = mos_nav_tree($index);
check('top level', array_column($tree, 'title'), ['Konur', 'Karlar', 'Börn', 'Skór', 'Íþróttir', 'Æfingavörur', 'Vörumerki', 'Útsala']);
$konur = $tree[0];
check('Konur href', $konur['href'], '/verslun/?kyn=konur');
check('Konur columns (thin and empty columns dropped)', array_column($konur['children'], 'title'), ['Fatnaður', 'Íþróttir', 'Vörumerki', 'Úrval']);
check('Konur › Fatnaður links are leaf categories with the gender', array_column($konur['children'][0]['children'], 'href'),
    ['/voruflokkur/fatnadur/efri-likami/bolir/?kyn=konur', '/voruflokkur/fatnadur/efri-likami/peysur/?kyn=konur']);
check('Konur › Íþróttir', array_column($konur['children'][1]['children'], 'href'), ['/verslun/?kyn=konur&ithrott=hlaup']);
check('Úrval always has popular and newest', array_column($konur['children'][3]['children'], 'title'), ['Vinsælt núna', 'Nýjast']);
$karlar = $tree[1];
check('Karlar has Félagslið and Útsala in Úrval', [array_column($karlar['children'], 'title'), array_column(end($karlar['children'])['children'], 'title')],
    [['Skór', 'Félagslið', 'Vörumerki', 'Úrval'], ['Vinsælt núna', 'Nýjast', 'Útsala']]);
check('Börn (no products) has only Úrval', array_column($tree[2]['children'], 'title'), ['Úrval']);
check('Útsala is a plain link', [$tree[7]['href'], $tree[7]['children']], ['/voruflokkur/sale/', []]);
check('Vörumerki is not a link', $tree[6]['href'], '#');

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail ? 1 : 0);
