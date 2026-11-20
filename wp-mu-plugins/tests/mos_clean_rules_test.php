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

// A jacket, vest or galli is filed two ways by staff: a describing word beside it decides nothing.
check('shirt jacket: no garment', mos_clean_garment_from_name(mos_clean_tokens('Nike Shirt Jacket Svartur')), []);
check('polo zip jacket: no garment', mos_clean_garment_from_name(mos_clean_tokens('Nike Polo Zip Jacket')), []);
check('tank vest: no garment', mos_clean_garment_from_name(mos_clean_tokens('Nike Tank Vest')), []);
check('a proper word still decides beside a jacket', mos_clean_garment_from_name(mos_clean_tokens('Adidas Jacket hlaupajakki')), ['yfirhafnir']);
check('a plain shirt is still a shirt', mos_clean_garment_from_name(mos_clean_tokens('Nike Golf Shirt')), ['bolir-efri-likami']);

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

// A colour term goes only when nothing uses it AND the fill is not about to use it (apply sets the fill's colours
// after the term hygiene, so a canonical colour with no products yet must survive until then).
check('unused colour: deleted', mos_clean_colour_deletable('navy-blue', false, false, ['brunn']), true);
check('colour with products: kept', mos_clean_colour_deletable('blar', true, false, []), false);
check('colour the fill will set: kept', mos_clean_colour_deletable('brunn', false, false, ['brunn', 'blar']), false);
check('colour the ops emptied: not counted twice', mos_clean_colour_deletable('dokkblatt', false, true, []), false);

// ---- Garment (the product-type category) from the name --------------------------------------------------------
$g = static fn (string $name) => mos_clean_garment_from_name(mos_clean_tokens($name));
check('treyja in a compound → bolir', $g('HSÍ ADIDAS HANDBOLTATREYJA 2025 HERRASNIÐ'), ['bolir-efri-likami']);
check('jsy is a jersey', $g('ADIDAS REAL MADRID H JSY YL 25/26'), ['bolir-efri-likami']);
check('stuttermabolur → bolir', $g('Nike Embroid Futura Tee Baby Stuttermabolur'), ['bolir-efri-likami']);
check('sundbolur is swimwear, not bolir', $g('Speedo sundbolur barna'), ['sundfatnadur-fatnadur-2']);
check('fimleikabolur is gymnastics, not bolir', $g('GK fimleikabolur'), ['fimleikar']);
check('handboltaskór is a shoe', $g('ADIDAS HANDBALL SPEZIAL PRO GRÁR HANDBOLTASKÓR'), ['handboltaskor-ithrottaskor']);
check('gervigrasskór → fótboltaskór', $g('Adidas F50 League TF Barna gervigrasskór'), ['fotboltaskor-ithrottaskor']);
check('hlaupaskór', $g('Nike Pegasus 41 hlaupaskór'), ['hlaupa-aefingarskor-ithrottaskor']);
check('a compound húfa', $g('MANCHESTER UNITED JÓLAHÚFA'), ['hufur-treflar']);
check('buff', $g('FH Buff'), ['hufur-treflar']);
check('hettupeysa → peysur', $g('Puma Valur Hettupeysa Dömu'), ['peysur-efri-likami']);
check('stuttbuxur in a compound', $g('ADIDAS LIVERPOOL HOME 25/26 BARNASTUTTBUXUR'), ['buxur-leggings']);
check('pants', $g('Adidas Real Madrid Training Pants Barna'), ['buxur-leggings']);
check('leggings', $g('Nike Pro leggings - Fimleikafélagið Björk Barna'), ['buxur-leggings']);
check('tight (singular) → buxur', $g('NIKE PRO WARM TIGHT MENS'), ['buxur-leggings']);
check('nærbuxur are underwear, not buxur', $g('Nike Everyday Cotton Stretch nærbuxur'), ['sokkar-naerfatnadur']);
check('fótboltasokkar', $g('Nike fótboltasokkar - Hvítir'), ['sokkar-naerfatnadur']);
check('regnbuxur: no decision (staff file them as outerwear)', $g('Didriksons regnbuxur Dusk Kids'), []);
check('snjóbuxur: no decision', $g('Tenson snjóbuxur kvenna'), []);
check('markmannshanskar are filed with the balls, not hanskar & vettlingar', $g('Adidas Predator markmannshanskar'), ['boltar-aefingarvorur']);
check('vettlingar', $g('Kombi vettlingar barna'), ['hanskar-vettlingar']);
check('regnjakki → yfirhafnir', $g('Nike regnjakki fullordinsst'), ['yfirhafnir']);
check('a tight-fit top names two garments', $g('Nike Pro Mens Dri-FIT Tight Long-Sleeve Top'), ['buxur-leggings', 'bolir-efri-likami']);
check('swim shorts are swimwear', $g('Adidas 3-Stripes Swim Shorts 3-Inch Herra'), ['sundfatnadur-fatnadur-2']);
check('high-top boots are shoes, not a top', $g('Nike Jr. Tiempo High-Top Football Boots'), ['skor']);
check('no garment word', $g('Stanley Quencher 1.18L Fuchsia'), []);
check('each garment once', $g('Nike buxur - æfingabuxur'), ['buxur-leggings']);
// A describing word (tight, sleeve, bra) decides only when the name has no proper garment word.
check('a garment word beats "long-sleeve"', $g('Nike Sportswear Older Kids Long-Sleeve Fleece Peysa Hvítt'), ['peysur-efri-likami']);
check('sundbolur beats "long sleeve"', $g('Speedo PT Long Sleeve Bleikur/Grænn Sundbolur Stelpu'), ['sundfatnadur-fatnadur-2']);
check('sundbolur beats "bra"', $g('Speedo RCR ZIP SWM BRA AF Sundbolur KVK'), ['sundfatnadur-fatnadur-2']);
check('"long-sleeve" alone is a top', $g('Nike Dri-FIT Long-Sleeve Running'), ['bolir-efri-likami']);
check('"long sleeve" as two words too', $g('Nike Long Sleeve Tee'), ['bolir-efri-likami']);
check('an arm sleeve is not a top', $g('NIKE STRIKE SLEEVE HVÍTAR'), []);
check('a tight top is not tights: left for a person', $g('Nike Pro Dri-FIT Tight Top'), ['buxur-leggings', 'bolir-efri-likami']);
check('tight socks are socks', $g('Nike Pro Tight Socks'), ['sokkar-naerfatnadur']);
check('a swim word with a prefix: dömusundbolur', $g('SPEEDO DÖMUSUNDBOLUR Colorblock Racerback One Piece'), ['sundfatnadur-fatnadur-2']);
check('herrasundbuxur', $g('Speedo Prime herrasundbuxur 16"'), ['sundfatnadur-fatnadur-2']);
check('sundstuttbuxur', $g('Speedo Essential 13 stráka sundstuttbuxur'), ['sundfatnadur-fatnadur-2']);
check('SWM is swim', $g('RCR ZIP 1PC SWM BRA AF BLACK'), ['sundfatnadur-fatnadur-2']);
check('a rash top is swimwear', $g('Speedo Printed Long Sleeve Rash Top Blue'), ['sundfatnadur-fatnadur-2']);
check('"pants" next to weather trousers decides nothing', $g("Didriksons Grand Women's Pants vindbuxur / regnbuxur"), []);
check('ski pants named snjóbuxur decide nothing', $g('Tenson Grace Softshell Ski Pants snjóbuxur'), []);
check('a shoe word in English next to the Icelandic one', $g('ADIDAS HANDBOLTASKÓR CRAZYFLIGHT 6 INDOOR SHOES'), ['handboltaskor-ithrottaskor']);
check('ennisband', $g('Ennisband Stjarnan'), ['hufur-treflar']);
check('a low-top shoe is a shoe, not a top', $g('Nike Jr. Mercurial Vapor 16 Academy "Vini Jr." Big Kids Multi-Ground Low-Top Soccer Cleats'), ['skor']);
check('a high-top with no other shoe word is a shoe too', $g('Nike Court Vision High Top Hvítir'), ['skor']);
check('a football top is a top', $g('Nike Strike Mens Dri-FIT Football Drill Top Bleik'), ['bolir-efri-likami']);
check('a jersey-and-shorts kit names two garments', $g('Manchester United Home Jersey Shorts Mini Kit'), ['bolir-efri-likami', 'buxur-leggings']);
check('a sports bra alone is a toppur', $g('Nike Swoosh Medium Support Bra'), ['topp-ur']);

// ---- Team keys and teams from the name ------------------------------------------------------------------------
$terms = ['island-iceland' => 'Ísland', 'hsi' => 'HSÍ', 'keflavik' => 'Keflavík', 'keflavik-2' => 'Keflavik', 'messi' => 'Messi',
    'manchester-united' => 'Manchester United', 'manchester-city' => 'Manchester City', 'real-madrid' => 'Real Madrid',
    'belgia' => 'Belgía', 'fh' => 'FH', 'valur' => 'Valur', 'chelsea' => 'Chelsea', 'liverpool' => 'Liverpool',
    'thor' => 'Þór', 'thor-2' => 'Thor', 'fotbolti' => 'Fótbolti'];
$tk = mos_clean_team_key_map($terms, mos_clean_team_rules());
check('team key from a name', $tk['manchesterunited'] ?? null, 'manchester-united');
check('team key from a slug', $tk['islandiceland'] ?? null, 'island-iceland');
check('federation alias beats the term of the same name', $tk['hsi'] ?? null, 'island-iceland');
check('ksi alias', $tk['ksi'] ?? null, 'island-iceland');
check('english country alias', $tk['belgium'] ?? null, 'belgia');
check('alias to a team the shop lacks is dropped', $tk['spain'] ?? null, null);
check('short-name alias', $tk['manutd'] ?? null, 'manchester-united');
check('two terms, one key: the alias decides', $tk['keflavik'] ?? null, 'keflavik');
check('two terms, one key, no alias: neither', $tk['thor'] ?? null, null);
check('never read from a name: messi', $tk['messi'] ?? null, null);
check('never read from a name: a sport filed as a team', $tk['fotbolti'] ?? null, null);
check('no key points at a skipped term', in_array('keflavik-2', $tk, true), false);

$deny = mos_clean_team_rules()['deny'];
$t = static fn (string $name) => mos_clean_team_from_name(mos_clean_tokens($name), $tk, $deny);
check('HSÍ → Ísland', $t('HSÍ ADIDAS HANDBOLTATREYJA 2025 HERRASNIÐ'), ['island-iceland']);
check('two-word team anywhere', $t('ADIDAS Manchester United Home Jersey Barnastærð 23/24'), ['manchester-united']);
check('Man. City', $t('Erling Haaland / Man. City Púsl 270 bitar'), ['manchester-city']);
check('real madrid', $t('ADIDAS REAL MADRID H JSY YL 25/26'), ['real-madrid']);
check('"real" alone is not Real Madrid', $t('REAL NECKWARMER'), []);
check('chelsea boots are not Chelsea FC', $t('Viking Rubber Boots - River Chelsea'), []);
check('Chelsea FC kit', $t('Nike Chelsea Home Jersey 25/26'), ['chelsea']);
check('short key only as a whole word', $t('Nike FH æfingapeysa'), ['fh']);
check('short key inside a word does not match', $t('Nike Fherra peysa'), []);
check('federation and club → both named', $t('KSÍ Valur treyja'), ['island-iceland', 'valur']);
check('a team named twice counts once', $t('Liverpool treyja - Liverpool FC'), ['liverpool']);
check('no team', $t('NIKE PRO WARM TIGHT MENS'), []);
check('the longest run of words wins over its first word', mos_clean_keys_in_name(mos_clean_tokens('Real Madrid treyja'), ['real' => 'real-other', 'realmadrid' => 'real-madrid']), ['real-madrid']);
check('a three-word name', mos_clean_keys_in_name(mos_clean_tokens('Nike Paris Saint Germain peysa'), ['parissaintgermain' => 'paris-saint-germain']), ['paris-saint-germain']);

// ---- Brand anywhere in the name -------------------------------------------------------------------------------
$bk = ['nike' => 'nike', 'adidas' => 'adidas', 'puma' => 'puma', 'head' => 'head', 'select' => 'select', 'karitraa' => 'kari-traa'];
$b = static fn (string $name) => mos_clean_brands_in_name(mos_clean_tokens($name), $bk);
check('brand after the team', $b('HSÍ ADIDAS HANDBOLTATREYJA 2025 HERRASNIÐ'), ['adidas']);
check('two-word brand mid-name', $b('Ullarbolur Kari Traa Rose'), ['kari-traa']);
check('two brands named', $b('Nike x Adidas bolur'), ['nike', 'adidas']);
check('an ordinary word that is also a brand is not read mid-name', $b('Skíðagleraugu Solar Head Junior'), []);
check('no brand', $b('Fótboltaskór'), []);
// The brands a name names: the start of the name first; an ambiguous start stays ambiguous (it is not settled by
// reading the rest of the name).
$ak = ['adidas' => 'adidas', 'adidasoriginals' => 'adidas-originals', 'nike' => 'nike'];
check('one brand at the start', mos_clean_brands_named(mos_clean_tokens('Nike bolur frá Adidas'), $ak), ['nike']);
check('an ambiguous start names both', mos_clean_brands_named(mos_clean_tokens('Adidas Originals peysa'), $ak), ['adidas', 'adidas-originals']);
check('no brand at the start: anywhere', mos_clean_brands_named(mos_clean_tokens('HSÍ ADIDAS HANDBOLTATREYJA'), $ak), ['adidas']);
$r = mos_clean_decide(array_merge($base, ['name' => 'Adidas Originals peysa']), $ak);
check('an ambiguous start is left empty and reported', [$r['brand'], $r['conflicts']['brand'] ?? null], [null, ['adidas', 'adidas-originals']]);

// ---- Decide: the new fields -----------------------------------------------------------------------------------
$d2 = static fn (array $over) => mos_clean_decide(array_merge($base, $over), $bk, $tk);

$r = $d2(['name' => 'HSÍ ADIDAS HANDBOLTATREYJA 2025 HERRASNIÐ']);
check('owner example: brand', $r['brand'], 'adidas');
check('owner example: team', $r['team'], 'island-iceland');
check('owner example: sport', $r['sport'], 'handbolti');
check('owner example: garment', $r['garment'], 'bolir-efri-likami');
check('owner example: gender', $r['gender'], ['karlar']);
check('owner example: no conflicts', $r['conflicts'], []);

$r = $d2(['name' => 'NIKE PRO WARM TIGHT MENS']);
check('tight example', [$r['brand'], $r['gender'], $r['garment'], $r['sport'], $r['team']], ['nike', ['karlar'], 'buxur-leggings', null, null]);

$r = $d2(['name' => 'KSÍ Landsliðstreyja Puma 26/28 barnastærð']);
check('KSÍ kit', [$r['brand'], $r['team'], $r['garment'], $r['gender']], ['puma', 'island-iceland', 'bolir-efri-likami', ['born']]);

$r = $d2(['name' => 'Liverpool F.C. 2024/25 Strike Third Nike Football Knee-High']);
check('brand late in the name', [$r['brand'], $r['team']], ['nike', 'liverpool']);

$r = $d2(['name' => 'Nike x Adidas bolur']);
check('a brand at the start still wins', [$r['brand'], $r['conflicts']['brand'] ?? null], ['nike', null]);
$r = $d2(['name' => 'Bolur Nike x Adidas']);
check('two brands mid-name: left empty, reported', [$r['brand'], $r['conflicts']['brand'] ?? null], [null, ['nike', 'adidas']]);

$r = $d2(['name' => 'KSÍ Valur treyja']);
check('federation + club: left empty, reported', [$r['team'], $r['conflicts']['team'] ?? null], [null, ['island-iceland', 'valur']]);

$r = $d2(['name' => 'Nike Pro Mens Dri-FIT Tight Long-Sleeve Top']);
check('two garments: left empty, reported', [$r['garment'], $r['conflicts']['garment'] ?? null], [null, ['buxur-leggings', 'bolir-efri-likami']]);

$r = $d2(['name' => 'Adidas Tiro League Training Jakki', 'cats' => ['peysur-efri-likami', 'karlar']]);
check('a product already filed by garment keeps the staff choice', [$r['garment'], $r['conflicts']['garment'] ?? null], [null, null]);
$r = $d2(['name' => 'Haukar - Keppnistreyja - 2025/2027', 'cats' => ['lidafatnadur-fatnadur-2']]);
check('a theme category (Liðafatnaður) is not a garment', $r['garment'], 'bolir-efri-likami');
$r = $d2(['name' => 'Nike hlaupabolur', 'cats' => ['hlaup', 'fatnadur']]);
check('a parent or theme category alone is not a garment', $r['garment'], 'bolir-efri-likami');

$r = $d2(['name' => 'Adidas Liverpool treyja', 'has_team' => true]);
check('an existing team is kept', [$r['team'], $r['conflicts']['team'] ?? null], [null, null]);
$r = $d(['name' => 'Adidas Liverpool treyja']);
check('without team keys no team is decided', $r['team'], null);

// The sport follows from the garment the same name just decided, in the same pass (not only on the next run).
$r = $d2(['name' => 'Adidas F50 League TF Barna gervigrasskór']);
check('gervigrasskór: football shoes, so football', [$r['garment'], $r['sport']], ['fotboltaskor-ithrottaskor', 'fotbolti']);
$r = $d2(['name' => 'Casall Bikiníbuxur Bláar']);
check('bikini: swimwear, so swimming', [$r['garment'], $r['sport']], ['sundfatnadur-fatnadur-2', 'sund']);
$r = $d2(['name' => 'Nike bolur', 'cats' => ['handboltaskor-ithrottaskor']]);
check('a category the product already has still decides the sport', $r['sport'], 'handbolti');
$r = $d2(['name' => 'Adidas handboltaskór', 'cats' => ['korfuboltaskor']]);
check('a product filed by garment gets no second one, and its sport from where it is filed', [$r['garment'], $r['sport']], [null, 'korfubolti']);


// ---- Suspects: what is filed disagrees with the name (reported for a person to look at, never changed) -----------
$sus = static fn (string $name, array $teams, array $brands) => mos_clean_suspect(mos_clean_tokens($name), $teams, $brands, $bk + ['smartwool' => 'smartwool', 'tenson' => 'tenson'], $tk, $deny);
check('filed under another team than the name says', $sus('Manchester City Rúmföt', ['manchester-united'], []),
    ['team' => ['name' => ['manchester-city'], 'filed' => ['manchester-united']]]);
check('filed under another brand than the name says', $sus('Smartwool skíðasokkar grænir', [], ['tenson']),
    ['brand' => ['name' => ['smartwool'], 'filed' => ['tenson']]]);
check('many teams, none of them in the name', $sus('Smell Well Þvottaefni', ['fh', 'valur', 'liverpool'], []),
    ['team' => ['name' => [], 'filed' => ['fh', 'valur', 'liverpool']]]);
check('club kit that does not name its club is normal', $sus('Nike Academy peysa', ['fh'], ['nike']), []);
check('the name agrees', $sus('Nike FH æfingapeysa', ['fh'], ['nike']), []);
check('the named team is one of several filed', $sus('Liverpool límmiðar', ['liverpool', 'chelsea', 'valur'], []), []);
check('a federation and its national team agree', $sus('HSÍ treyja', ['island-iceland'], []), []);
check('nothing filed is not a suspect (the fill handles it)', $sus('Manchester City Rúmföt', [], []), []);
check('a name with two teams says nothing certain', $sus('KSÍ Valur treyja', ['fh'], []), []);
check('filed under the federation the name means: not a suspect', $sus('HSÍ treyja', ['hsi'], []), []);
check('two teams, none named, is not a suspect', $sus('Nike Academy peysa', ['fh', 'valur'], []), []);
check('the brand a name starts with is what the name says', $sus('Smartwool Tenson skíðasokkar', [], ['tenson']),
    ['brand' => ['name' => ['smartwool'], 'filed' => ['tenson']]]);
check('several teams, one of them a name the rules never read, but it is in the name', $sus('Adidas Messi Mini Fótbolti', ['argentina', 'inter-miami', 'messi'], []), []);

// ---- More words, each filed where staff already file products with that word (measured on the catalog).
check('T-Shirt', $g('Nike Sportswear Older Kids T-Shirt'), ['bolir-efri-likami']);
check('tank', $g('NIKE MENS TANK BLUE'), ['bolir-efri-likami']);
check('polo', $g('Nike Velocity Mens Dri-FIT Golf Polo'), ['bolir-efri-likami']);
check('trousers', $g('Nike Pro Training Mens Dri-FIT Trousers'), ['buxur-leggings']);
check('taska', $g('Nike Utility Power 2.0 taska'), ['toskur-aefingarvorur']);
check('skólataska', $g('NIKE SKÓLATASKA BLÁ M/ APPELSÍNUGULU PENNAVESKI'), ['toskur-aefingarvorur']);
check('backpack', $g('Nike Brasilia Kids Backpack (18L)'), ['toskur-aefingarvorur']);
check('sundpoki is a bag, as staff file it', $g('NIKE SUNDPOKI PRINT - BLÁR'), ['toskur-aefingarvorur']);
check('duffel', $g('adidas Essentials 3-Stripes Duffel Bag Medium - Black'), ['toskur-aefingarvorur']);
check('brúsi', $g('Camelbak Eddy+ Brúsi Charcoal 600ml'), ['brusar']);
check('bottle', $g('Liverpool FC SIX HOUR HOT COLD BOTTLE 500ML'), ['brusar']);
check('sundgleraugu', $g('ARENA SPIDER MASK BARNASUNDGLERAUGU BLÁ'), ['sundfatnadur-fatnadur-2']);
check('sundhetta', $g('Fashy Sundhetta Dökkblá'), ['sundfatnadur-fatnadur-2']);
check('a ball', $g('Adidas fótbolti blár STARLANCER'), ['boltar-aefingarvorur']);
check('a mini ball', $g('MESSI MINI BALL BLUE'), ['boltar-aefingarvorur']);
check('markmannshanskar are filed with the balls', $g('NIKE BARNA MARKMANNSHANSKAR - MATCH JR'), ['boltar-aefingarvorur']);
check('fótboltabuxur are trousers, not a ball', $g('Nike fótboltabuxur barna'), ['buxur-leggings']);
check('hárband', $g('NIKE HÁRBAND'), ['hufur-treflar']);
check('clogs', $g('Crocs Classic Clog Chunky Glitter Bleikir Kids'), ['inniskor']);
check('shoes, with no word for which kind: Skór', $g('Nike Flex Train Womens Workout Shoes'), ['skor']);
check('barnaskór: Skór', $g('Adidas Terrex Agravic BOA barnaskór'), ['skor']);
check('a jacket is filed two ways by staff: no decision', $g('Casall Soft Touch Zip Jacket Svartur'), []);
$r = $d2(['name' => 'Nike Flex Train Womens Workout Shoes', 'cats' => ['skor']]);
check('already under Skór: nothing to add', $r['garment'], null);
check('filed under Skór counts as filed: the default category goes', mos_clean_without_default([15, 653], 15, [672, 653]), [653]);

// ---- The default category ("Óflokkað") only ever meant "not filed yet": it goes once the product is filed by garment.
check('filed by garment: the default category goes', mos_clean_without_default([15, 672, 2617], 15, [672]), [672, 2617]);
check('not filed by any garment category: it stays', mos_clean_without_default([15, 2617], 15, [672]), [15, 2617]);
check('no default category on the product: nothing changes', mos_clean_without_default([672, 2617], 15, [672]), [672, 2617]);
check('the shop has no default category: nothing changes', mos_clean_without_default([15, 672], 0, [672]), [15, 672]);
check('the default category is itself the only one: it stays', mos_clean_without_default([15], 15, [15]), [15]);

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail === 0 ? 0 : 1);
