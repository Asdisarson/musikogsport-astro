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

// Pinned links: listed after the ranked ones, however few products; unknown slugs and empty terms are skipped.
$pin_terms = $terms;
$pin_terms['team'][61] = ['slug' => 'england', 'name' => 'England', 'parent' => 0];
$pin_terms['team'][62] = ['slug' => 'island-iceland', 'name' => 'Ísland', 'parent' => 0];
$pin_terms['team'][63] = ['slug' => 'spann', 'name' => 'Spánn', 'parent' => 0];   // no products
$pin_index = ['terms' => $pin_terms, 'products' => array_merge($products, [row([3, 21], [50], [61]), row([2, 12], [50], [62]), row([4, 12], [50], [62])])];   // 1 England, 2 Ísland
$team_href = static fn ($s) => "/verslun/?team=$s";
$ranked = mos_nav_ranked($pin_index, 'team', [], $team_href, 8);
check('thin teams are not ranked', array_column($ranked, 'title'), ['FH']);
$pinned = mos_nav_with_pinned($pin_index, 'team', $ranked, ['island-iceland', 'brasilia', 'spann', 'fh', 'england'], $team_href);
check('pinned follow the ranked, in the pinned order, once each, unknown and empty skipped', array_column($pinned, 'title'), ['FH', 'Ísland', 'England']);
check('pinned href and count', [$pinned[2]['href'], $pinned[2]['count'], $pinned[1]['count']], ['/verslun/?team=england', 1, 2]);
check('pinned push nothing out', array_column(mos_nav_with_pinned($pin_index, 'team', mos_nav_ranked($pin_index, 'team', [], $team_href, 1), ['england'], $team_href), 'title'), ['FH', 'England']);
$pin_tree = mos_nav_tree(['terms' => $pin_terms, 'products' => $pin_index['products']]);
// National teams get their own column under Íþróttir, out of Félagslið: Ísland first, then by product count; a
// pinned club (Barcelona) still joins the clubs however few products it has.
$pin_terms['team'][64] = ['slug' => 'barcelona', 'name' => 'Barcelona', 'parent' => 0];
$pin_terms['team'][65] = ['slug' => 'argentina', 'name' => 'Argentina', 'parent' => 0];
$nat_products = array_merge($pin_index['products'], [row([3, 21], [50], [64])], array_fill(0, 6, row([3, 21], [50], [65])));   // 1 Barcelona, 6 Argentina
$pin_tree = mos_nav_tree(['terms' => $pin_terms, 'products' => $nat_products]);
$sports_menu = $pin_tree[4]['children'];
check('Íþróttir has the columns Íþróttir, Félagslið, Landslið', array_column($sports_menu, 'title'), ['Íþróttir', 'Félagslið', 'Landslið']);
check('Íþróttir › Félagslið lists clubs only (the pinned club too), alphabetically', array_column($sports_menu[1]['children'], 'href'),
    ['/verslun/?team=barcelona', '/verslun/?team=fh']);
check('Íþróttir › Landslið: Ísland first, the rest alphabetical; a team with no products is left out', array_column($sports_menu[2]['children'], 'href'),
    ['/verslun/?team=island-iceland', '/verslun/?team=argentina', '/verslun/?team=england']);

// Featured teams lead their column in the order of the list; the rest follow alphabetically.
$marked = mos_nav_featured(
    [['title' => 'FH', 'href' => '/verslun/?team=fh', 'children' => [], 'count' => 7], ['title' => 'Arsenal', 'href' => '/verslun/?team=arsenal', 'children' => [], 'count' => 6]],
    ['manchester-united', 'arsenal'], $team_href);
check('featured: a listed link gets its place in the list, the others are untouched', $marked,
    [['title' => 'FH', 'href' => '/verslun/?team=fh', 'children' => [], 'count' => 7], ['title' => 'Arsenal', 'href' => '/verslun/?team=arsenal', 'children' => [], 'count' => 6, 'featured' => 1]]);
$feat_column = static fn (array $links) => array_column(mos_nav_alphabetical([['title' => 'X', 'href' => '#', 'children' => [['title' => 'Dálkur', 'href' => '#', 'children' => $links]]]])[0]['children'][0]['children'], 'title');
$link = static fn (string $t, ?int $featured = null) => ['title' => $t, 'href' => '#', 'children' => [], 'count' => 9] + ($featured === null ? [] : ['featured' => $featured]);
check('featured links come first in list order, then the alphabet', $feat_column([$link('Björk'), $link('Liverpool', 3), $link('Arsenal', 2), $link('Afturelding'), $link('Manchester United', 0)]),
    ['Manchester United', 'Arsenal', 'Liverpool', 'Afturelding', 'Björk']);
$feat_terms = $pin_terms;
$feat_terms['team'][66] = ['slug' => 'arsenal', 'name' => 'Arsenal', 'parent' => 0];
$feat_terms['team'][67] = ['slug' => 'manchester-united', 'name' => 'Manchester United', 'parent' => 0];
$feat_terms['team'][68] = ['slug' => 'liverpool', 'name' => 'Liverpool', 'parent' => 0];   // no products
$feat_terms['team'][69] = ['slug' => 'afturelding', 'name' => 'Afturelding', 'parent' => 0];
$feat_products = array_merge($nat_products, array_fill(0, 6, row([3, 21], [50], [66])), [row([3, 21], [50], [67])], array_fill(0, 6, row([3, 21], [50], [69])));   // 6 Arsenal, 1 Manchester United, 6 Afturelding (men)
$feat_tree = mos_nav_tree(['terms' => $feat_terms, 'products' => $feat_products]);
check('Íþróttir › Félagslið: the featured clubs first in their order (a thin one too, an empty one not), then the alphabet', array_column($feat_tree[4]['children'][1]['children'], 'href'),
    ['/verslun/?team=manchester-united', '/verslun/?team=barcelona', '/verslun/?team=arsenal', '/verslun/?team=afturelding', '/verslun/?team=fh']);
check('Karlar › Félagslið: a featured club that made the column leads it; thin featured clubs are not added there', array_column(array_values(array_filter($feat_tree[1]['children'], static fn ($c) => $c['title'] === 'Félagslið'))[0]['children'], 'title'),
    ['Arsenal', 'Afturelding', 'Argentina', 'FH']);

// Alphabetical order, Icelandic: á after a, ð after d, í after i, þ æ ö last; case and punctuation do not matter.
$sorted = static function (array $titles): array {
    $tree = mos_nav_alphabetical([['title' => 'X', 'href' => '#', 'children' => [['title' => 'Dálkur', 'href' => '#', 'children' => array_map(static fn ($t) => ['title' => $t, 'href' => '#', 'children' => [], 'count' => 9], $titles)]]]]);
    return array_column($tree[0]['children'][0]['children'], 'title');
};
check('alphabet: Icelandic letters in their places', $sorted(['Öskjur', 'Æfingar', 'Þór', 'Ísland', 'Ítalía', 'Inter', 'Álftanes', 'Arsenal', 'Dalvík', 'Ðe', 'adidas', 'Úlfar', 'Umbro']),
    ['adidas', 'Arsenal', 'Álftanes', 'Dalvík', 'Ðe', 'Inter', 'Ísland', 'Ítalía', 'Umbro', 'Úlfar', 'Þór', 'Æfingar', 'Öskjur']);
check('alphabet: case, punctuation and entities do not decide', $sorted(['nike', 'New Balance', 'F.C. Bayern', 'FH', 'Bolir &amp; toppar', 'Bolir']), ['Bolir', 'Bolir &amp; toppar', 'F.C. Bayern', 'FH', 'New Balance', 'nike']);
check('alphabet: digits before letters', $sorted(['Adidas', '2XU', '66°Norður']), ['2XU', '66°Norður', 'Adidas']);
$hand = mos_nav_alphabetical([['title' => 'X', 'href' => '#', 'children' => [['title' => 'Úrval', 'href' => '#', 'children' => [['title' => 'Vinsælt núna', 'href' => '#', 'children' => []], ['title' => 'Nýjast', 'href' => '#', 'children' => []]]]]]]);
check('alphabet: a column written by hand keeps its order', array_column($hand[0]['children'][0]['children'], 'title'), ['Vinsælt núna', 'Nýjast']);
$whole = mos_nav_tree(['terms' => $pin_terms, 'products' => $nat_products]);
check('the menu itself and its columns keep their order', [array_column($whole, 'title'), array_column($whole[0]['children'], 'title') === array_column(mos_nav_gender_item(['terms' => $pin_terms, 'products' => $nat_products], 'konur', 'Konur')['children'], 'title')],
    [array_column($whole, 'title'), true]);
foreach ($whole as $top) {
    foreach ($top['children'] as $column) {
        $titles = array_column($column['children'], 'title');
        if ($titles === [] || !array_key_exists('count', $column['children'][0])) { continue; }
        $featured = array_column(array_filter($column['children'], static fn ($l) => isset($l['featured'])), 'title');
        $rest = array_column(array_filter($column['children'], static fn ($l) => !isset($l['featured'])), 'title');
        check("listed column {$top['title']} › {$column['title']}: featured first, the rest alphabetical", $titles, array_merge($featured, $sorted($rest)));
    }
}
check('national teams are told apart by slug', [mos_nav_is_national('/verslun/?team=england', static fn ($s) => "/verslun/?team=$s"), mos_nav_is_national('/verslun/?team=fh', static fn ($s) => "/verslun/?team=$s")], [true, false]);
$no_nationals = mos_nav_tree(['terms' => $terms, 'products' => $products]);
check('no Landslið column without national-team products', array_column($no_nationals[4]['children'], 'title'), array_values(array_diff(array_column($no_nationals[4]['children'], 'title'), ['Landslið'])));
check('Karlar › Félagslið stays ranked only (pinned and thin teams are not added there)', array_column(mos_nav_tree(['terms' => $pin_terms, 'products' => $pin_index['products']])[1]['children'][1]['children'], 'title'), ['FH']);

// The tree.
$tree = mos_nav_tree($index);
check('top level', array_column($tree, 'title'), ['Konur', 'Karlar', 'Börn', 'Skór', 'Íþróttir', 'Æfingavörur', 'Vörumerki', 'Útsala']);
$womens = $tree[0];
check('Konur href', $womens['href'], '/verslun/?kyn=konur');
check('Konur columns (thin and empty columns dropped)', array_column($womens['children'], 'title'), ['Fatnaður', 'Íþróttir', 'Vörumerki', 'Úrval']);
check('Konur › Fatnaður links are leaf categories with the gender', array_column($womens['children'][0]['children'], 'href'),
    ['/voruflokkur/fatnadur/efri-likami/bolir/?kyn=konur', '/voruflokkur/fatnadur/efri-likami/peysur/?kyn=konur']);
check('Konur › Íþróttir', array_column($womens['children'][1]['children'], 'href'), ['/verslun/?kyn=konur&ithrott=hlaup']);
check('Úrval always has popular and newest', array_column($womens['children'][3]['children'], 'title'), ['Vinsælt núna', 'Nýjast']);
$mens = $tree[1];
check('Karlar has Félagslið and Útsala in Úrval', [array_column($mens['children'], 'title'), array_column(end($mens['children'])['children'], 'title')],
    [['Skór', 'Félagslið', 'Vörumerki', 'Úrval'], ['Vinsælt núna', 'Nýjast', 'Útsala']]);
check('Börn (no products) has only Úrval', array_column($tree[2]['children'], 'title'), ['Úrval']);
check('Útsala is a plain link', [$tree[7]['href'], $tree[7]['children']], ['/voruflokkur/sale/', []]);
check('Vörumerki is not a link', $tree[6]['href'], '#');

// The owner's hand edits. A menu's fingerprint is its items' titles, addresses, order and nesting, never their ids.
$rows = [
    ['id' => 10, 'parent' => 0, 'title' => 'Konur', 'url' => 'https://wp.test/verslun/?kyn=konur'],
    ['id' => 11, 'parent' => 10, 'title' => 'Bolir', 'url' => 'https://wp.test/voruflokkur/bolir/'],
    ['id' => 12, 'parent' => 0, 'title' => 'Skór', 'url' => '#'],
];
$hash = mos_nav_items_hash($rows);
$with = static function (array $rows, int $i, array $change): array { $rows[$i] = $change + $rows[$i]; return $rows; };
check('fingerprint: the same menu under other ids', mos_nav_items_hash([
    ['id' => 70, 'parent' => 0] + $rows[0], ['id' => 71, 'parent' => 70] + $rows[1], ['id' => 90, 'parent' => 0] + $rows[2],
]), $hash);
check('fingerprint: a renamed item', mos_nav_items_hash($with($rows, 1, ['title' => 'Toppar'])) === $hash, false);
check('fingerprint: a changed address', mos_nav_items_hash($with($rows, 2, ['url' => 'https://wp.test/voruflokkur/skor/'])) === $hash, false);
check('fingerprint: an item moved under another', mos_nav_items_hash($with($rows, 1, ['parent' => 0])) === $hash, false);
check('fingerprint: items in another order', mos_nav_items_hash([$rows[2], $rows[0], $rows[1]]) === $hash, false);
check('fingerprint: an item removed', mos_nav_items_hash([$rows[0], $rows[2]]) === $hash, false);
check('fingerprint: an empty menu has one', mos_nav_items_hash([]) !== '' && mos_nav_items_hash([]) !== $hash, true);

$built = ['menu_id' => 5, 'hash' => $hash];
check('hand edits: the build as it was written', mos_nav_is_hand_edited($built, 5, $hash), false);
check('hand edits: the build, changed', mos_nav_is_hand_edited($built, 5, 'other'), true);
check('hand edits: another menu is shown', mos_nav_is_hand_edited($built, 6, $hash), true);
check('hand edits: a menu no build is recorded for', mos_nav_is_hand_edited(null, 5, $hash), true);
check('hand edits: a record that is not one', mos_nav_is_hand_edited(['menu_id' => '5'], 5, $hash), true);
check('hand edits: no menu is shown, so there is nothing to lose', mos_nav_is_hand_edited(null, 0, ''), false);

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail ? 1 : 0);
