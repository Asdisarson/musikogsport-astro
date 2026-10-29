<?php
/**
 * Unit test for the pure rules in ../mos-catalog-clean.php (no WordPress needed).
 *
 * Run: php wp-mu-plugins/tests/mos_clean_rules_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
function add_action(...$args): void {}
function add_filter(...$args): void {}

require __DIR__ . '/../mos-catalog-clean.php';

$pass = 0;
$fail = 0;
function check(string $label, $got, $want): void {
    global $pass, $fail;
    if ($got === $want) { $pass++; return; }
    $fail++;
    printf("FAIL %s\n  want %s\n  got  %s\n", $label, json_encode($want, JSON_UNESCAPED_UNICODE), json_encode($got, JSON_UNESCAPED_UNICODE));
}

// Folding and keys.
check('fold', mos_clean_fold('Fótboltaskór ÞÓR Ægir'), 'fotboltaskor thor aegir');
check('tokens (apostrophe folded away)', mos_clean_tokens("Women's Hyperboom Jammer Black/Grey"), ['womens', 'hyperboom', 'jammer', 'black', 'grey']);
check('key chillys', mos_clean_key('Chilly´s'), mos_clean_key('Chilly&#8217;s'));
check('key gform', mos_clean_key('G-FORM'), 'gform');
check('key move active', mos_clean_key('Move Active'), mos_clean_key('MoveActive'));

// Gender from attributes.
check('aldur born wins', mos_clean_gender_from_attrs(['karl'], ['born']), ['born']);
check('kyn karl', mos_clean_gender_from_attrs(['karl'], ['fullordin-n']), ['karlar']);
check('kyn unisex adult', mos_clean_gender_from_attrs(['unisex'], []), ['karlar', 'konur']);
check('kyn none', mos_clean_gender_from_attrs([], ['fullordin-n']), []);

// Category fallback: only Kyn/sale (ignored) or nothing left → the product needs the fallback category.
check('fallback: nothing left', mos_clean_needs_fallback([], [5, 6]), true);
check('fallback: only ignored left', mos_clean_needs_fallback([5], [5, 6]), true);
check('fallback: a real category left', mos_clean_needs_fallback([5, 9], [5, 6]), false);

// Sports fold: category children → pa_ithrott slug (null = no sport term for it).
check('sport fold mapped', mos_clean_sport_for_category('hlaup-ithrott'), 'hlaup');
check('sport fold joga', mos_clean_sport_for_category('joga'), 'yoga');
check('sport fold unknown', mos_clean_sport_for_category('nope'), null);

// Brand from name.
$keys = ['speedo' => 'speedo', 'karitraa' => 'kari-traa', 'nike' => 'nike'];
check('brand first word', mos_clean_brand_from_name(mos_clean_tokens('SPEEDO BOYS DIVE - Sundskýla barna'), $keys), 'speedo');
check('brand two words', mos_clean_brand_from_name(mos_clean_tokens('Kari Traa ullarbolur'), $keys), 'kari-traa');
check('brand not at start', mos_clean_brand_from_name(mos_clean_tokens('Bolur frá Nike'), $keys), null);

// Decide: a fact sheet with nothing set.
$base = ['name' => '', 'cats' => [], 'has_brand' => false, 'vorumerki' => [], 'kyn' => [], 'aldur' => [], 'has_sport' => false, 'has_colour' => false];
$d = static fn (array $over) => mos_clean_decide(array_merge($base, $over), $keys + ['camelbak' => 'camelbak']);

$r = $d(['name' => 'Speedo sundskýla herra - Mens Hyperboom Jammer Black/Grey']);
check('speedo brand', $r['brand'], 'speedo');
check('speedo gender (herra + mens agree)', $r['gender'], ['karlar']);
check('speedo sport', $r['sport'], 'sund');
check('speedo colour = first named', $r['colour'], 'svartur');

$r = $d(['name' => 'Kombi Epic lúffur svartar dömur', 'vorumerki' => ['Kombi']]);
check('new brand from vorumerki', [$r['brand'], $r['brand_new']], [null, 'Kombi']);
check('dömur (women) → konur', $r['gender'], ['konur']);
check('svartar → svartur', $r['colour'], 'svartur');

$r = $d(['name' => 'Kombi Epic lúffur dömu']);
check('dömu → konur', $r['gender'], ['konur']);

$r = $d(['name' => 'Nike bolur Men and Women']);
check('gender conflict left empty', [$r['gender'], $r['conflicts']['gender'] ?? null], [[], ['karlar', 'konur']]);

$r = $d(['name' => 'Heelys Rezerve hjólaskór', 'cats' => []]);
check('hjólaskór is not cycling', $r['sport'], null);
$r = $d(['name' => 'Trek Solstice MIPS hjólahjálmur S/M nokkrir litir']);
check('hjólahjálmur → hjol', $r['sport'], 'hjol');
check('nokkrir litir → no colour', $r['colour'], null);

$r = $d(['name' => 'Fótboltaskór', 'cats' => ['fotboltaskor-ithrottaskor', 'handboltaskor-ithrottaskor']]);
check('sport conflict from categories', [$r['sport'], $r['conflicts']['sport'] ?? null], [null, ['fotbolti', 'handbolti']]);
$r = $d(['name' => 'Golfbolti', 'cats' => ['sundfatnadur-fatnadur-2']]);
check('category beats name', $r['sport'], 'sund');

$r = $d(['name' => 'Kivat print - bleikt']);
check('bleikt → bleikur', $r['colour'], 'bleikur');
$r = $d(['name' => 'Peysa dökkblá']);
check('dökkblá → blar', $r['colour'], 'blar');
$r = $d(['name' => 'Real Madrid treyja']);
check('no colour in team names', $r['colour'], null);

$r = $d(['name' => 'Nike England Older Kids Jersey', 'cats' => ['karlar']]);
check('existing gender category kept', $r['gender'], []);
$r = $d(['name' => 'Bolur', 'has_brand' => true, 'has_sport' => true, 'has_colour' => true, 'vorumerki' => ['Nike']]);
check('nothing overwritten', [$r['brand'], $r['brand_new'], $r['sport'], $r['colour']], [null, null, null, null]);

check('display name caps', mos_clean_brand_display_name('TABEDESIGN'), 'Tabedesign');
check('display name kept', mos_clean_brand_display_name('Cébé'), 'Cébé');

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail === 0 ? 0 : 1);
