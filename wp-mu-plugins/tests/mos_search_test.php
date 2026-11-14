<?php
/**
 * Unit test for the pure parts of ../mos-search.php (no WordPress): folding, the Icelandic stem, which words
 * answer to a stem, the typo correction, the index and what a query resolves to.
 *
 * Run: php wp-mu-plugins/tests/mos_search_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
function add_filter(...$a): void {}
function add_action(...$a): void {}
function current_user_can(...$a): bool { return false; }

require __DIR__ . '/../mos-search.php';

$pass = 0;
$fail = 0;
function check(string $label, bool $ok, string $detail = ''): void {
    global $pass, $fail;
    if ($ok) { $pass++; return; }
    $fail++;
    echo "FAIL $label $detail\n";
}

// --- fold and words ---
check('fold: lower case, accents, Icelandic letters, entities', mos_search_fold('  Fótbolta-SKÓR Þór Æfing &amp; Ðð  ') === 'fotbolta-skor thor aefing & dd', mos_search_fold('  Fótbolta-SKÓR Þór Æfing &amp; Ðð  '));
check('words: split, folded, each once', mos_search_words('  Nike   SKÓR, nike/barna  ') === ['nike', 'skor', 'barna'], json_encode(mos_search_words('  Nike   SKÓR, nike/barna  ')));
check('words: one-letter noise dropped, digits kept', mos_search_words('a 42 í x') === ['42'], json_encode(mos_search_words('a 42 í x')));
check('words: at most ' . MOS_SEARCH_MAX_WORDS, count(mos_search_words('aa bb cc dd ee ff gg hh ii jj')) === MOS_SEARCH_MAX_WORDS);
check('words: empty query', mos_search_words('   ') === []);

// --- stem: the forms of one word meet in one stem ---
foreach ([['peysa', 'peysur', 'peysu'], ['sokkur', 'sokkar', 'sokka'], ['bolti', 'boltar', 'bolta'], ['hufur', 'hufum'], ['buxur', 'buxum']] as $forms) {
    $stems = array_unique(array_map('mos_search_stem', $forms));
    check('stem: ' . implode('/', $forms) . ' share a stem', count($stems) === 1, implode(',', $stems));
}
check('stem: short words are left alone', mos_search_stem('nike') === 'nike' && mos_search_stem('skor') === 'skor' && mos_search_stem('hufa') === 'hufa');
check('stem: never shorter than three letters', strlen(mos_search_stem('arnar')) >= 3 && strlen(mos_search_stem('ullar')) >= 3 && strlen(mos_search_stem('hufur')) >= 3);
check('stem: a code with digits is not cut', mos_search_stem('lpw002') === 'lpw002' && mos_search_stem('h24616s') === 'h24616s');
check('variants: a ↔ o in the last syllable of a stem that ends in a consonant', mos_search_variants('task') === ['task', 'tosk'] && mos_search_variants('tosk') === ['tosk', 'task']);
check('variants: none for a stem ending in a vowel, or without a/o', mos_search_variants('adida') === ['adida'] && mos_search_variants('nike') === ['nike'] && mos_search_variants('peys') === ['peys']);

// --- which words answer to a stem ---
$yes = [['peys', 'peysur'], ['peys', 'peysa'], ['peys', 'flispeysa'], ['peys', 'barnapeysur'], ['skor', 'fotboltaskor'], ['skor', 'skor'], ['sko', 'skor'], ['nik', 'nike'],
    ['fotbolt', 'fotboltaskor'], ['task', 'taska'], ['task', 'boltataska'], ['tosk', 'toskur'], ['sokk', 'fotboltasokkar'], ['bux', 'aefingabuxur'], ['adida', 'adidas'], ['barcelon', 'barcelona'], ['hlaupasko', 'hlaupaskor']];
foreach ($yes as [$stem, $word]) { check("matches: $stem → $word", mos_search_word_matches($stem, $word)); }
$no = [['task', 'fotboltaskor'], ['bolt', 'fotboltaskor'], ['ke', 'nike'], ['bol', 'fotbolti'], ['peys', 'nike'], ['all', 'handbolti']];
foreach ($no as [$stem, $word]) { check("no match: $stem ↛ $word", !mos_search_word_matches($stem, $word)); }

// --- correction ---
$counts = ['adidas' => 900, 'liverpool' => 80, 'barcelona' => 20, 'nike' => 700, 'peysa' => 60, 'aldas' => 1];
check('correct: one letter too many', mos_search_correct('addidas', $counts) === 'adidas', (string) mos_search_correct('addidas', $counts));
check('correct: one letter missing', mos_search_correct('liverpol', $counts) === 'liverpool');
check('correct: swapped letters in a long word', mos_search_correct('barcleona', $counts) === 'barcelona', (string) mos_search_correct('barcleona', $counts));
check('correct: a short word is never guessed', mos_search_correct('nik', $counts) === null && mos_search_correct('nikk', $counts) === null);
check('correct: nothing near enough', mos_search_correct('zzzzzzzz', $counts) === null);
check('correct: of two equally near words the common one', mos_search_correct('adias', ['adidas' => 900, 'aldas' => 1]) === 'adidas');

// --- the index and what a query finds ---
$index = mos_search_build_index(
    [1 => 'Adidas Tiro peysa', 2 => 'Nike Mercurial fótboltaskór', 3 => 'Liverpool trefill', 4 => 'Nike Brasilia taska', 5 => 'Nike sokkar 3 í pakka', 6 => 'F.C. Barcelona Strike Top'],
    ['LPW002' => 3, 'H24-616' => 1, 'ab' => 2],
    [['id' => 10, 'name' => 'Peysur'], ['id' => 11, 'name' => 'Töskur'], ['id' => 12, 'name' => 'Fótboltaskór'], ['id' => 13, 'name' => 'Nike'], ['id' => 14, 'name' => 'Sokkar &amp; nærfatnaður'], ['id' => 15, 'name' => 'Barcelona']]
);
check('index: title words point at their products', ($index['title']['nike'] ?? []) === [2, 4, 5] && ($index['title']['fotboltaskor'] ?? []) === [2]);
check('index: SKUs without punctuation, short ones left out', ($index['sku']['lpw002'] ?? []) === [3] && ($index['sku']['h24616'] ?? []) === [1] && !isset($index['sku']['ab']));
check('index: term words point at their terms, entities decoded', ($index['term']['peysur'] ?? []) === [10] && ($index['term']['naerfatnadur'] ?? []) === [14] && !isset($index['term']['amp']));
check('index: the vocabulary counts titles and terms', ($index['vocab']['nike'] ?? 0) === 4 && ($index['vocab']['peysur'] ?? 0) === 1);

$find = static fn (string $q) => mos_search_resolve($q, $index);
$r = $find('peysur');
check('resolve: a category name finds the term and the title form', $r['parts'] === [['products' => [1], 'terms' => [10]]], json_encode($r));
$r = $find('Nike skór');
check('resolve: two words, each with its own products and terms', $r['words'] === ['nike', 'skor'] && $r['parts'][0] === ['products' => [2, 4, 5], 'terms' => [13]] && $r['parts'][1] === ['products' => [2], 'terms' => [12]], json_encode($r));
$r = $find('taska');
check('resolve: u-umlaut twin finds Töskur, and not the shoes', $r['parts'] === [['products' => [4], 'terms' => [11]]], json_encode($r));
$r = $find('addidas');
check('resolve: a misspelling becomes the nearest word', $r['words'] === ['adidas'] && $r['parts'][0]['products'] === [1], json_encode($r));
$r = $find('barcelona xyzzyq');
check('resolve: a word nothing is near is left out', $r['words'] === ['barcelona'] && $r['parts'] === [['products' => [6], 'terms' => [15]]], json_encode($r));
check('resolve: nothing known at all finds nothing', $find('qqqqqq zzzzzz')['parts'] === []);
$r = $find('lpw002');
check('resolve: a SKU finds its product', $r['parts'] === [['products' => [3], 'terms' => []]], json_encode($r));
$r = $find('H24-616');
check('resolve: a SKU typed with its dash is looked up whole', $r['parts'] === [['products' => [1], 'terms' => []]] && $find('h24616')['parts'][0]['products'] === [1], json_encode($r));
$letters = mos_search_build_index([9 => 'Hlaupaskór'], ['ZOOMX' => 9], []);
check('resolve: a SKU of letters only is found too', mos_search_resolve('zoomx', $letters)['parts'] === [['products' => [9], 'terms' => []]], json_encode(mos_search_resolve('zoomx', $letters)));
check('resolve: words with a dash that are no SKU stay words', $find('nike-skór')['words'] === ['nike', 'skor']);
$with_gloves = mos_search_build_index([7 => 'Liverpool hanskar', 8 => 'Liverpool inniskór'], [], []);
check('resolve: a short word gets no u-umlaut twin (skor does not find hanskar)', mos_search_resolve('skor', $with_gloves)['parts'] === [['products' => [8], 'terms' => []]], json_encode(mos_search_resolve('skor', $with_gloves)));
$r = $find('sokkur');
check('resolve: another form of the word (sokkur → sokkar)', $r['parts'] === [['products' => [5], 'terms' => [14]]], json_encode($r));
$r = $find('sko');
check('resolve: an unfinished word while typing (sko → …skór)', $r['parts'] === [['products' => [2], 'terms' => [12]]], json_encode($r));
$r = $find('fotbolt');
check('resolve: typing the start of a compound', $r['parts'] === [['products' => [2], 'terms' => [12]]], json_encode($r));

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail ? 1 : 0);
