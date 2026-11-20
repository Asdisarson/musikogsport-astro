<?php
/**
 * WordPress-level test for the team and garment fill in ../mos-catalog-clean.php, against the local catalog. It only
 * previews (a dry fill), so it writes nothing: the rule tables must point at categories and teams the shop has, a new
 * product must get what its name says, and an existing one only what it lacks. (The write path:
 * mos_clean_write_wp_test.php.)
 *
 * Run (local site): wpms eval-file wp-mu-plugins/tests/mos_clean_fill_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};

// A rule that names a category the shop lacks would silently set nothing: every target must exist.
$missing = [];
foreach (mos_clean_garment_rules() as [$slug]) {
    if (is_string($slug) && !get_term_by('slug', $slug, 'product_cat') instanceof WP_Term) { $missing[] = $slug; }
}
$check('every garment rule points at a category the shop has', $missing === [], implode(', ', $missing));
$missing = array_values(array_filter(mos_clean_garment_type_slugs(), static fn ($s) => !get_term_by('slug', $s, 'product_cat') instanceof WP_Term));
$check('every product-type category exists', $missing === [], implode(', ', $missing));

$team_keys = mos_clean_team_keys();
$check('a federation means the national team', ($team_keys['hsi'] ?? null) === 'island-iceland' && ($team_keys['ksi'] ?? null) === 'island-iceland');
$check('a club is known by its name', ($team_keys['liverpool'] ?? null) === 'liverpool' && ($team_keys['manchesterunited'] ?? null) === 'manchester-united');
$check('people and tournaments are not teams to read', !isset($team_keys['messi']) && !isset($team_keys['euro24']));
$check('every team key points at a team the shop has', array_filter(array_unique($team_keys), static fn ($s) => !get_term_by('slug', $s, 'pa_felag-lid') instanceof WP_Term) === []);

$brand_keys = mos_clean_brand_keys();
/** Everything a fill could touch on a product: its terms in every taxonomy the plugin writes, its attributes, its meta. */
$state = static function (int $id): array {
    $terms = [];
    foreach (['product_cat', 'product_brand', 'pa_felag-lid', 'pa_ithrott', 'pa_litur'] as $tax) {
        $slugs = wp_get_object_terms($id, $tax, ['fields' => 'slugs']);
        if (!is_array($slugs)) { $slugs = []; }   // a taxonomy this catalog does not have
        sort($slugs);
        $terms[$tax] = $slugs;
    }
    return ['terms' => $terms, 'attributes' => get_post_meta($id, '_product_attributes', true), 'filled' => get_post_meta($id, MOS_CLEAN_FILLED_META, true),
        'modified' => get_post_field('post_modified_gmt', $id)];
};
// Names on products that exist only in memory (nothing is saved): what a brand-new product would get.
$fresh = static function (string $name) use ($brand_keys, $team_keys): array {
    $p = new WC_Product_Simple();
    $p->set_name($name);
    $set = mos_clean_fill_product($p, $brand_keys, null, true, $team_keys)['set'];
    ksort($set);
    return $set;
};
$check('a new "HSÍ ADIDAS HANDBOLTATREYJA 2025 HERRASNIÐ" would get all five',
    $fresh('HSÍ ADIDAS HANDBOLTATREYJA 2025 HERRASNIÐ') === ['brand' => 'adidas', 'garment' => 'bolir-efri-likami', 'gender' => 'karlar', 'sport' => 'handbolti', 'team' => 'island-iceland'],
    wp_json_encode($fresh('HSÍ ADIDAS HANDBOLTATREYJA 2025 HERRASNIÐ')));
$check('a new "NIKE PRO WARM TIGHT MENS" would get brand, gender and garment, and no sport or team',
    $fresh('NIKE PRO WARM TIGHT MENS') === ['brand' => 'nike', 'garment' => 'buxur-leggings', 'gender' => 'karlar'], wp_json_encode($fresh('NIKE PRO WARM TIGHT MENS')));

// Products of the local catalog, whatever state the catalog is in (before or after an apply): the fill only ever adds
// what is missing.
$cases = [250674 => 'the HSÍ treyja (has a team; a garment only if it has none yet)', 218650 => 'the Nike tights (filed by garment, no team in the name)'];
$skipped = 0;
foreach ($cases as $id => $what) {
    $p = wc_get_product($id);
    if (!$p instanceof WC_Product) {
        $skipped++;
        echo "SKIP product $id ($what): not in this catalog\n";
        continue;
    }
    $before = $state($id);
    $typed = array_intersect($before['terms']['product_cat'], mos_clean_garment_type_slugs()) !== [];
    $teamed = $before['terms']['pa_felag-lid'] !== [];
    $set = mos_clean_fill_product($p, $brand_keys, null, true, $team_keys)['set'];
    $check("$id: no garment is proposed for a product already filed by one", !($typed && isset($set['garment'])), wp_json_encode($set));
    $check("$id: no team is proposed for a product that has one", !($teamed && isset($set['team'])), wp_json_encode($set));
    clean_post_cache($id);
    $check("$id: the preview wrote nothing", $state($id) === $before);
}

// A team attribute used for variations is never written, so a preview must not promise it either. (A product that
// exists only in memory: nothing is saved.)
$variable = new WC_Product_Variable();
$variable->set_name('Liverpool treyja');
$attr = new WC_Product_Attribute();
$attr->set_id((int) wc_attribute_taxonomy_id_by_name('pa_felag-lid'));
$attr->set_name('pa_felag-lid');
$attr->set_variation(true);
$variable->set_attributes(['pa_felag-lid' => $attr]);
$set = mos_clean_fill_product($variable, $brand_keys, null, true, $team_keys)['set'];
$check('a team attribute used for variations is not filled, in a preview either', !isset($set['team']), wp_json_encode($set));
$plain = new WC_Product_Simple();
$plain->set_name('Liverpool treyja');
$set = mos_clean_fill_product($plain, $brand_keys, null, true, $team_keys)['set'];
$check('the same name on a plain product gets the team', ($set['team'] ?? null) === 'liverpool', wp_json_encode($set));

echo $fail === 0 ? ($skipped === count($cases) ? "NOTHING TESTED: none of the products is in this catalog\n" : "ALL PASS" . ($skipped ? " ($skipped skipped)" : '') . "\n") : "$fail FAILED\n";
