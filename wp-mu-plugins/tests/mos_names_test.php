<?php
/**
 * Unit test for the pure rules in ../mos-product-names.php (no WordPress needed).
 *
 * Run: php wp-mu-plugins/tests/mos_names_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
function add_action(...$args): void {}
function add_filter(...$args): void {}

require __DIR__ . '/../mos-product-names.php';

$pass = 0;
$fail = 0;
function check(string $label, $got, $want): void {
    global $pass, $fail;
    if ($got === $want) { $pass++; return; }
    $fail++;
    printf("FAIL %s\n  want %s\n  got  %s\n", $label, json_encode($want, JSON_UNESCAPED_UNICODE), json_encode($got, JSON_UNESCAPED_UNICODE));
}

// The words the shop itself writes in ordinary case somewhere: what an all-caps word is checked against.
$vocab = mos_names_vocab([
    'Nike Pro Warm Tight Mens', 'Adidas Real Madrid Home Jersey Kids', 'Speedo sundbolur blár', 'Black White Navy Beige Pink',
    'Carbon bolti', 'Exa Kids', 'One Mask', 'The Simpsons', 'Arena', 'Didriksons', 'NIKE AIR', 'Court', 'League', 'Sokkar',
    'Light', 'Training', 'Top', 'Shoes', 'Running', 'Trail', 'Neon', 'Rose', 'Womens', 'Gloves', "Children's", 'Midnight',
    'Fleece', 'Girls', 'Loose', 'Trousers', 'Sportswear', 'Club', 'buxur barna', 'Football', 'Low-Top', 'Phantom', 'Academy',
    'Blue', 'Void', 'Chrome', 'Stadium', 'Big', 'Soccer', 'Replica', 'Barcelona', 'Manoa', 'kuldaskór', 'brúnn', 'bikinibuxur',
    'Spjald', 'Socks', 'Grand', 'Go', 'Element', 'Swift', 'Zip', 'Stripes', 'Shorts', 'Run', 'Own', 'Jacket', 'hlaupajakki', 'Green', 'Hanskar', 'Mini', 'Bands',
]);
check('vocab: a word written in ordinary case is known', isset($vocab['warm']), true);
check('vocab: a word only ever in capitals is not', isset($vocab['air']), false);

$brands = ['adidas' => 'Adidas', 'nike' => 'Nike', 'speedo' => 'Speedo', 'arena' => 'Arena', 'didriksons' => 'Didriksons', 'sklz' => 'Sklz',
    'hoka' => 'Hoka', 'trofe' => 'Trofe', 'viking' => 'Viking', 'jordan' => 'Jordan'];
$s = static fn (string $name): string => mos_names_simplify($name, $vocab, $brands);

// Capitals.
check('an all-caps name becomes ordinary case', $s('NIKE PRO WARM TIGHT MENS'), 'Nike Pro Warm Tight Mens');
check('the owner\'s example keeps HSÍ and the year', $s('HSÍ ADIDAS HANDBOLTATREYJA 2025 HERRASNIÐ'), 'HSÍ Adidas Handboltatreyja 2025 Herrasnið');
check('a name already in ordinary case is left alone', $s('Nike Club Mens Full-Zip Fleece Hoodie'), 'Nike Club Mens Full-Zip Fleece Hoodie');
check('words in ordinary case stay as typed', $s('ADIDAS Manchester United regnjakki barna FJÓLUBLÁR'), 'Adidas Manchester United regnjakki barna Fjólublár');
check('abbreviations without a vowel stay', $s('ADIDAS F50 LEAGUE LL FG/MG'), 'Adidas F50 League LL FG/MG');
check('known abbreviations stay', $s('ADIDAS UEFA GTX BOA TOP'), 'Adidas UEFA GTX BOA Top');
check('a short word the shop never writes in ordinary case stays', $s('ADIDAS VL COURT 3.0 EL C'), 'Adidas VL Court 3.0 EL C');
check('a long ordinary word is a word', $s('KIVAT VETTLINGAR BOMULLARFODRADIR'), 'Kivat Vettlingar Bomullarfodradir');
check('an Icelandic letter marks a word', $s('LIVERPOOL FÁNI'), 'Liverpool Fáni');
check('numbers and what hangs on them stay', $s('ADIDAS GERMANY 24 HOME JERSEY KIDS EURO24'), 'Adidas Germany 24 Home Jersey Kids EURO24');
check('a season stays', $s('ADIDAS REAL MADRID KIDS HOME JERSEY 25/26'), 'Adidas Real Madrid Kids Home Jersey 25/26');
check('a word hyphened to a number is still a word', $s('NIKE SWIFT ELEMENT UV WOMENS 1/4-ZIP'), 'Nike Swift Element UV Womens 1/4-Zip');
check('3-STRIPES', $s('ADIDAS OWN THE RUN 3-STRIPES SHORTS'), 'Adidas Own The Run 3-Stripes Shorts');
check('an apostrophe does not start a new word', $s("JORDAN CHILDREN'S GLOVES"), "Jordan Children's Gloves");
check('Icelandic small words go lower case', $s('SKLZ SPJALD OG BOLTI FYRIR BARNA'), 'SKLZ Spjald og Bolti fyrir Barna');
check('English small words are capitalised like the rest', $s('ADIDAS THE SIMPSONS SOCKS KIDS'), 'Adidas The Simpsons Socks Kids');

check('an abbreviation stays even where the shop also writes it in lower case', mos_names_simplify('GK HOPFIMLEIKABUXUR KVK', mos_names_vocab(['gk bolur kvk']), $brands), 'GK Hopfimleikabuxur KVK');
check('a long compound is a word', $s('NIKE ZENVY LONGSLEEVED TOP'), 'Nike Zenvy Longsleeved Top');
check('a word of one vowel in five letters', $s('CASALL GLASS'), 'Casall Glass');

// Maker's colour codes: one unknown part keeps the whole group.
check('a colour-code group stays whole', $s('ADIDAS GRAND COURT PLATFORM WONBEI/FTWWHT/FTWWHT'), 'Adidas Grand Court Platform WONBEI/FTWWHT/FTWWHT');
check('a colour-code group with a known word stays whole too', $s('Adidas BREAKNET C FTWWHT/CARBON/CARBON'), 'Adidas Breaknet C FTWWHT/CARBON/CARBON');
check('a group of ordinary colours is cased', $s('SPEEDO JUNIOR BLACK/WHITE'), 'Speedo Junior Black/White');
check('a code that cannot be said stays', $s('ULTRABOOST LIGHT CBLACK'), 'Ultraboost Light CBLACK');

// Maker's own spellings.
check('Dri-FIT from capitals', $s('NIKE DRI-FIT VICTORY'), 'Nike Dri-FIT Victory');
check('Dri-FIT from Dri-Fit', $s('Nike Dri-Fit Strike barnabolur'), 'Nike Dri-FIT Strike barnabolur');
check('Dri-FIT from DRIFIT', $s('NIKE DRIFIT GO'), 'Nike Dri-FIT Go');
check('drifit typed small on another maker\'s product stays', $s('Adidas Lux bolur - drifit'), 'Adidas Lux bolur - drifit');
check('Therma-FIT as typed stays', $s('Nike Therma-FIT Swift Womens Running Vest'), 'Nike Therma-FIT Swift Womens Running Vest');
check('THERMA-FIT keeps FIT', $s('NIKE THERMA-FIT TOP'), 'Nike Therma-FIT Top');
check('T-shirt as typed stays', $s('Nike Sportswear T-shirt'), 'Nike Sportswear T-shirt');
check('GORE-TEX stays', $s('VIKING GORE-TEX kuldaskór'), 'Viking GORE-TEX kuldaskór');
check('GORE TEX stays', $s('VIKING GORE TEX kuldaskór'), 'Viking GORE TEX kuldaskór');
check('a brand the maker writes in capitals stays', $s('SKLZ Mini Bands'), 'SKLZ Mini Bands');
check('HOKA stays', $s('HOKA CLIFTON 10'), 'HOKA Clifton 10');
check('a lower-case brand at the start', $s('adidas Own the Run Jacket hlaupajakki - Green'), 'Adidas Own the Run Jacket hlaupajakki - Green');

// Spaces.
check('double spaces go', $s('Nike  Grip 3 markmannshanskar'), 'Nike Grip 3 markmannshanskar');
check('a space before the bracket is kept single', $s('Nike Erling Haaland bakpoki  (25L)'), 'Nike Erling Haaland bakpoki (25L)');
check('a trailing dash goes', $s('Nike Air -'), 'Nike Air');

// Repeats.
check('the same word twice in a row', $s('Trofe Trofe bikinibuxur knossos'), 'Trofe bikinibuxur knossos');
check('the brand a second time', $s('Nike FC Barcelona 2025/26 Stadium Home Big Kids Nike Dri-FIT Soccer Replica Jersey'),
    'Nike FC Barcelona 2025/26 Stadium Home Big Kids Dri-FIT Soccer Replica Jersey');
check('the brand a second time with the words it repeats', $s('Nike Sportswear Club Fleece Girls Loose Trousers - Black/White Nike Sportswear Club buxur barna'),
    'Nike Sportswear Club Fleece Girls Loose Trousers - Black/White buxur barna');
check('a cut-off repeat at the end', $s('Nike Phantom GX 2 Academy TF Low-Top Football Shoes - Blue Void/Chrome Nike Phanto'),
    'Nike Phantom GX 2 Academy TF Low-Top Football Shoes - Blue Void/Chrome');
check('who it is for, said twice', $s('NIKE MANOA BARNA BRÚNN KULDASKÓR BARNA'), 'Nike Manoa Barna Brúnn Kuldaskór');
check('Jr. twice is a name, not a repeat', $s('Nike Jr. Mercurial Vapor 16 "Vini Jr." Big Kids'), 'Nike Jr. Mercurial Vapor 16 "Vini Jr." Big Kids');
check('a colourway said twice stays', $s('HOKA Clifton 9 Herra Black / Black'), 'HOKA Clifton 9 Herra Black / Black');

// Found in review.
check('a short club abbreviation with an Icelandic letter stays', $s('NIKE ÍR TREYJA'), 'Nike ÍR Treyja');
check('ÍBV and UMFÍ stay', $s('ÍBV TREYJA UMFÍ'), 'ÍBV Treyja UMFÍ');
check('a short Icelandic word the shop writes in ordinary case is still a word', $s('SPEEDO SUNDBOLUR BLÁR'), 'Speedo Sundbolur Blár');
check('a short Icelandic word on the word list', $s('LIVERPOOL FÁNI'), 'Liverpool Fáni');
check('a leading minus on a number stays', $s('-10 NIKE JACKET'), '-10 Nike Jacket');
check('a leading decimal point stays', $s('.45 NIKE TEE'), '.45 Nike Tee');
check('a leading stray dash still goes', $s('- NIKE TEE'), 'Nike Tee');
check('a number at the end is never a cut-off repeat', $s('NIKE AIR 2025 NIKE AIR 202'), 'Nike Air 2025 Nike Air 202');
check('the link is frozen only when the tidied name would give another', mos_names_freeze_slug('nike-pro-nike-top', 'nike-pro-top'), true);
check('capitals alone never change a link: nothing to freeze', mos_names_freeze_slug('nike-pro-top', 'nike-pro-top'), false);

check('a second model after the brand is not a repeat', $s('Nike Air Max 90 Nike Air Max 95'), 'Nike Air Max 90 Nike Air Max 95');
check('nor a second year', $s('Adidas Samba 2024 Adidas Samba 2025'), 'Adidas Samba 2024 Adidas Samba 2025');

// Never.
check('a name that is only a code is left alone', $s('FD3287672'), 'FD3287672');
check('one word is left alone', $s('PÍLUR'), 'PÍLUR');
check('an empty name', $s(''), '');
foreach (['NIKE PRO WARM TIGHT MENS', 'Nike Sportswear Club Fleece Girls Loose Trousers - Black/White Nike Sportswear Club buxur barna', 'ADIDAS THE SIMPSONS SOCKS KIDS'] as $n) {
    check("simplifying twice changes nothing more: $n", $s($s($n)), $s($n));
}

// Once only: the first time a product gets a real name.
check('a new product with a name is due', mos_names_due('draft', 'NIKE AIR', false, true), true);
check('not before the shop has switched it on', mos_names_due('draft', 'NIKE AIR', false, false), false);
check('not a product that was handled before', mos_names_due('publish', 'NIKE AIR', true, true), false);
check('not the editor\'s placeholder', mos_names_due('auto-draft', 'AUTO-DRAFT', false, true), false);
check('not a product without a name yet', mos_names_due('draft', '', false, true), false);
check('not a product in the bin', mos_names_due('trash', 'NIKE AIR', false, true), false);

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail === 0 ? 0 : 1);
