<?php
/**
 * Unit test for mos_size_normalise() in ../mos-size-index.php (pure function, no WordPress needed).
 *
 * Run: php wp-mu-plugins/tests/mos_size_normalise_test.php   (exit code 0 = all pass)
 *
 * Every case is [raw, slug, label, group, sort] or [raw, null] for junk. Each mapped case is also
 * checked for idempotency: normalising the label must give back the same term (the plugin re-derives
 * a term's group and sort from its name).
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
function add_action(...$args): void {}
function add_filter(...$args): void {}

require __DIR__ . '/../mos-size-index.php';

$cases = [
    // Shoe: thirds in every spelling.
    ['38 2/3', '38-2-3', '38 2/3', 'shoe', 38.6667],
    ['382/3', '38-2-3', '38 2/3', 'shoe', 38.6667],
    ['38⅔', '38-2-3', '38 2/3', 'shoe', 38.6667],
    ['37 1/3', '37-1-3', '37 1/3', 'shoe', 37.3333],
    ['371/3', '37-1-3', '37 1/3', 'shoe', 37.3333],
    ['37/13', '37-1-3', '37 1/3', 'shoe', 37.3333],   // typo: the "1" ended up after the slash
    ['40/23', '40-2-3', '40 2/3', 'shoe', 40.6667],
    ['42/3', '42-2-3', '42 2/3', 'shoe', 42.6667],    // digit lost: even size → ⅔ (adidas step)
    ['41/3', '41-1-3', '41 1/3', 'shoe', 41.3333],    // odd size → ⅓
    // Shoe: halves and decimals.
    ['38.5', '38-5', '38,5', 'shoe', 38.5],
    ['38,5', '38-5', '38,5', 'shoe', 38.5],
    ['38 1/2', '38-5', '38,5', 'shoe', 38.5],
    ['35½', '35-5', '35,5', 'shoe', 35.5],
    ['37.6', '37-6', '37,6', 'shoe', 37.6],
    ['40.', '40', '40', 'shoe', 40.0],
    ['40', '40', '40', 'shoe', 40.0],
    [' 42 ', '42', '42', 'shoe', 42.0],
    ['16', '16', '16', 'shoe', 16.0],
    ['50', '50', '50', 'shoe', 50.0],
    // Shoe ranges (sock sizes, kids' boots).
    ['33/34', '33-34', '33/34', 'shoe', 33.001],
    ['33-34', '33-34', '33/34', 'shoe', 33.001],
    ['39-42', '39-42', '39/42', 'shoe', 39.003],
    ['23,5-27', '23-5-27', '23,5/27', 'shoe', 23.5035],
    ['38.5-40.5', '38-5-40-5', '38,5/40,5', 'shoe', 38.502],
    ['27-34 (kid)', '27-34', '27/34', 'shoe', 27.007],
    // Kids: heights in cm and their ranges, baby heights, ages, months.
    ['140', '140', '140', 'kids', 140.0],
    ['80', '80', '80', 'kids', 80.0],
    ['176', '176', '176', 'kids', 176.0],
    ['62', '62', '62', 'kids', 62.0],
    ['74', '74', '74', 'kids', 74.0],
    ['122/128', '122-128', '122/128', 'kids', 122.006],
    ['80-86', '80-86', '80/86', 'kids', 80.006],
    ['100/120 cm', '100-120', '100/120', 'kids', 100.02],
    ['50/56', '50-56', '50/56', 'kids', 50.006],     // baby heights step by 6 cm
    ['56-58', '56-58', '56/58', 'other', 56.002],     // head circumference
    ['7-8 ára', '7-8-ara', '7-8 ára', 'kids', 119.01],
    ['5 - 8 ára', '5-8-ara', '5-8 ára', 'kids', 107.03],
    ['3m', '3m', '3 mán.', 'kids', 56.0],
    ['6-9m', '6-9m', '6-9 mán.', 'kids', 62.03],
    ['12/18 mánaða', '12-18m', '12-18 mán.', 'kids', 74.06],
    ['3-6 man', '3-6m', '3-6 mán.', 'kids', 56.03],
    ['3T', '3t', '3T', 'kids', 95.5],
    ['newborn', 'nyfaett', 'Nýfætt', 'kids', 49.0],
    // Letters.
    ['S', 's', 'S', 'letter', 5.0],
    ['xs', 'xs', 'XS', 'letter', 4.0],
    ['XXL', 'xxl', 'XXL', 'letter', 9.0],
    ['2XL', 'xxl', 'XXL', 'letter', 9.0],
    ['XXXL', '3xl', '3XL', 'letter', 10.0],
    ['5XL', '5xl', '5XL', 'letter', 12.0],
    ['2XS', 'xxs', 'XXS', 'letter', 3.0],
    ['4XS', '4xs', '4XS', 'letter', 1.0],
    ['SX', 'xs', 'XS', 'letter', 4.0],             // transposed
    ['Small KVK', 's', 'S', 'letter', 5.0],
    ['L/Tall', 'l', 'L', 'letter', 7.0],
    ['XLT', 'xl', 'XL', 'letter', 8.0],
    ['XLshort', 'xl', 'XL', 'letter', 8.0],
    ['L C/D', 'l', 'L', 'letter', 7.0],
    ['MC-E', 'm', 'M', 'letter', 6.0],
    ['L-Dcup', 'l', 'L', 'letter', 7.0],
    ['M - D skál', 'm', 'M', 'letter', 6.0],
    ["L / 5''", 'l', 'L', 'letter', 7.0],
    ['S fulorðins', 's', 'S', 'letter', 5.0],
    ['S ( 36/39)', 's', 'S', 'letter', 5.0],
    ['AXS', 'xs', 'XS', 'letter', 4.0],
    ['XL herrastærð', 'xl', 'XL', 'letter', 8.0],
    // Letter ranges.
    ['S/M', 's-m', 'S/M', 'letter', 5.5],
    ['L-XL', 'l-xl', 'L/XL', 'letter', 7.5],
    ['XXS/XS', 'xxs-xs', 'XXS/XS', 'letter', 3.5],
    ['4XS/3XS', '4xs-3xs', '4XS/3XS', 'letter', 1.5],
    // Kids letters.
    ['CL', 'l-barna', 'L barna', 'kids', 152.5],
    ['YXS', 'xs-barna', 'XS barna', 'kids', 116.5],
    ['2YXS', 'xxs-barna', 'XXS barna', 'kids', 104.5],
    ['XL barnastærð', 'xl-barna', 'XL barna', 'kids', 164.5],
    // One size and the generic words.
    ['One size', 'ein-staerd', 'Ein stærð', 'other', -1.0],
    ['OS', 'ein-staerd', 'Ein stærð', 'other', -1.0],
    ['Ein stærð', 'ein-staerd', 'Ein stærð', 'other', -1.0],
    ['Barna', 'barna', 'Barna', 'other', 900.0],
    ['Barnast ( uppí st 37 )', 'barna', 'Barna', 'other', 900.0],
    ['Kids', 'barna', 'Barna', 'other', 900.0],
    ['Adult', 'fullordins', 'Fullorðins', 'other', 901.0],
    ['Fullorðinsst ( 38+)', 'fullordins', 'Fullorðins', 'other', 901.0],
    // Small numbers (balls, hats, gloves): other.
    ['5', '5', '5', 'other', 5.0],
    ['0', '0', '0', 'other', 0.0],
    ['8.5', '8-5', '8,5', 'other', 8.5],
    ['4.5', '4k5', '4,5', 'other', 4.5],           // must not collide with the range 4-5
    // Two decimal digits (F-14): "12,15" must not share the slug of the range "12/15"; one digit and shoe sizes keep theirs.
    ['12,15', '12-15d', '12,15', 'other', 12.15],
    ['12/15', '12-15', '12/15', 'other', 12.003],
    ['38,25', '38-25d', '38,25', 'shoe', 38.25],
    ['38,5', '38-5', '38,5', 'shoe', 38.5],
    ['3.25', '3k25', '3,25', 'other', 3.25],
    ['23,5-27', '23-5-27', '23,5/27', 'shoe', 23.5035],
    ['4/5', '4-5', '4/5', 'other', 4.001],
    ['0/2', '0-2', '0/2', 'other', 0.002],
    ['55-59', '55-59', '55/59', 'other', 55.004],   // head circumference
    ['00', '00', '00', 'other', -0.5],
    ['1X', '1x', '1X', 'other', 101.0],
    ['6X (7)', '6x', '6X', 'other', 106.0],
    ['6+', '6-plus', '6+', 'other', 6.6],
    ['T2', 't2', 'T2', 'other', 202.0],
    ['36D', '36d', '36D', 'other', 300.036],
    ['JR', 'barna', 'Barna', 'other', 900.0],
    ['SR', 'fullordins', 'Fullorðins', 'other', 901.0],
    // Trousers waist/length; an ascending pair stays a (shoe) range.
    ['32X32', 'w32-l32', 'W32/L32', 'other', 432.32],
    ['36/32', 'w36-l32', 'W36/L32', 'other', 436.32],
    ['33/30', 'w33-l30', 'W33/L30', 'other', 433.3],
    ['32/34', '32-34', '32/34', 'shoe', 32.002],
    // Letter + Short/Tall written with a slash (not a range: the second letter is smaller).
    ['M/S', 'm', 'M', 'letter', 6.0],
    ['S/S', 's', 'S', 'letter', 5.0],
    ['XL/T', 'xl', 'XL', 'letter', 8.0],
    ['XS/S', 'xs-s', 'XS/S', 'letter', 4.5],
    // Junk.
    ['', null],
    ['   ', null],
    ['-', null],
    ['N/A', null],
    ['Svartur', null],
    ['38SHORT', null],
    ['46/52', null],          // straddles the shoe and kids bands
    ['200', null],            // above every band
    ['62.5', null],           // a fraction outside the shoe band
    ['XXXXXXL', null],
    ['XM', null],
];

$fail = 0;
$pass = 0;
foreach ($cases as $case) {
    [$raw, $slug] = $case;
    $got = mos_size_normalise($raw);
    if ($slug === null) {
        if ($got === null) { $pass++; continue; }
        $fail++;
        printf("FAIL %-24s expected null, got %s\n", json_encode($raw, JSON_UNESCAPED_UNICODE), json_encode($got, JSON_UNESCAPED_UNICODE));
        continue;
    }
    [, , $label, $group, $sort] = $case;
    $ok = $got !== null && $got['slug'] === $slug && $got['label'] === $label && $got['group'] === $group && abs($got['sort'] - $sort) < 0.001;
    $again = $got === null ? null : mos_size_normalise($got['label']);
    $idempotent = $again !== null && $got !== null && $again === $got;
    if ($ok && $idempotent) { $pass++; continue; }
    $fail++;
    printf("FAIL %-24s expected %s|%s|%s|%s got %s%s\n", json_encode($raw, JSON_UNESCAPED_UNICODE), $slug, $label, $group, $sort,
        json_encode($got, JSON_UNESCAPED_UNICODE), $ok && !$idempotent ? ' (label does not normalise back: ' . json_encode($again, JSON_UNESCAPED_UNICODE) . ')' : '');
}
printf("%d passed, %d failed\n", $pass, $fail);
exit($fail === 0 ? 0 : 1);
