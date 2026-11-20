<?php
/**
 * WordPress-level test for the WRITE path of ../mos-catalog-clean.php: a fill really files the product, records what it
 * filled, never fills a field twice, leaves variation attributes alone, a journal puts everything back, and a save's
 * fill reaches the storefront poke.
 *
 * It writes, but only to products it creates itself (private or hidden from the catalog, so in no listing) and deletes
 * for good in the finally block. No existing product is touched. Nothing is sent: outgoing HTTP is captured with
 * 'pre_http_request'.
 *
 * Run (local site): wp.sh eval-file wp-mu-plugins/tests/mos_clean_write_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};
$slugs = static function (int $id, string $tax): array {
    clean_object_term_cache($id, 'product');
    $s = wp_get_object_terms($id, $tax, ['fields' => 'slugs']);
    $s = is_array($s) ? $s : [];
    sort($s);
    return $s;
};
/** The slugs of a global attribute as the product itself holds it (what the product page and the lookup read). */
$attribute_slugs = static function (int $id, string $tax): array {
    $attr = wc_get_product($id)->get_attributes()[$tax] ?? null;
    if (!$attr instanceof WC_Product_Attribute) { return []; }
    return array_values(array_map(static fn ($term_id) => (string) get_term((int) $term_id, $tax)->slug, $attr->get_options()));
};

$sent = [];
$capture = static function ($pre, $args, $url) use (&$sent) {
    $sent[] = ['url' => (string) $url, 'body' => (string) ($args['body'] ?? '')];
    return ['headers' => [], 'body' => '', 'response' => ['code' => 204, 'message' => 'No Content'], 'cookies' => [], 'filename' => null];
};
add_filter('pre_http_request', $capture, 10, 3);
if (!function_exists('mos_headless_target_base') || mos_headless_target_base() === '') {
    if (!defined('MOS_DEV_ASTRO_URL')) { define('MOS_DEV_ASTRO_URL', 'http://127.0.0.1:10026'); }
}

$made = [];
$journal_file = null;
/** A product of this test's own: private, so it has a storefront path but is in no listing. */
$make = static function (WC_Product $p, string $name) use (&$made): int {
    $p->set_name($name);
    $p->set_status('private');
    $p->set_catalog_visibility('hidden');
    $GLOBALS['mos_clean_running'] = true;    // made bare: the save hook's own fill is not what is under test here
    try { $id = $p->save(); } finally { $GLOBALS['mos_clean_running'] = false; }
    $made[] = $id;
    return $id;
};

try {
    $brand_keys = mos_clean_brand_keys();
    $team_keys = mos_clean_team_keys();
    $fill = static fn (int $id, ?MOS_Clean_Journal $journal = null) => mos_clean_fill_product(wc_get_product($id), $brand_keys, $journal, false, $team_keys)['set'];

    // 1. The owner's example, as a brand-new product with nothing filled in. WooCommerce files a product with no
    // category under its default one ("Óflokkað"); the fill adds to that, it does not take it away.
    $default_cat = (string) get_term((int) get_option('default_product_cat'), 'product_cat')->slug;
    $with_default = static function (array $cats) use ($default_cat): array { $cats[] = $default_cat; sort($cats); return $cats; };
    $id = $make(new WC_Product_Simple(), 'HSÍ ADIDAS HANDBOLTATREYJA 2025 HERRASNIÐ');
    $check('(a new product starts in the default category only)', $slugs($id, 'product_cat') === [$default_cat], implode(',', $slugs($id, 'product_cat')));
    $journal_file = tempnam(sys_get_temp_dir(), 'mos-clean-test-journal');
    $journal = new MOS_Clean_Journal($journal_file);
    $set = $fill($id, $journal);
    $journal->save();
    ksort($set);
    $check('the example reports every field it set', $set === ['brand' => 'adidas', 'garment' => 'bolir-efri-likami', 'gender' => 'karlar', 'sport' => 'handbolti', 'team' => 'island-iceland'], wp_json_encode($set));
    $check('brand: Adidas', $slugs($id, 'product_brand') === ['adidas'], implode(',', $slugs($id, 'product_brand')));
    $check('categories: the garment and the gender, both, next to what it had', $slugs($id, 'product_cat') === $with_default(['bolir-efri-likami', 'karlar']), implode(',', $slugs($id, 'product_cat')));
    $check('team: Ísland, as a term and on the product itself', $slugs($id, 'pa_felag-lid') === ['island-iceland'] && $attribute_slugs($id, 'pa_felag-lid') === ['island-iceland'],
        implode(',', $slugs($id, 'pa_felag-lid')) . ' / ' . implode(',', $attribute_slugs($id, 'pa_felag-lid')));
    $check('sport: Handbolti', $slugs($id, 'pa_ithrott') === ['handbolti'] && $attribute_slugs($id, 'pa_ithrott') === ['handbolti']);
    $team_attr = wc_get_product($id)->get_attributes()['pa_felag-lid'] ?? null;
    $check('the team attribute is hidden from the product page and not for variations',
        $team_attr instanceof WC_Product_Attribute && !$team_attr->get_visible() && !$team_attr->get_variation());
    $filled = mos_clean_filled($id);
    sort($filled);
    $check('it remembers exactly what it filled', $filled === ['brand', 'garment', 'gender', 'sport', 'team'], implode(',', $filled));

    // 2. Filling again changes nothing.
    $check('a second fill sets nothing', $fill($id) === []);
    $check('and the product no longer needs filling for those fields', array_diff(['brand', 'gender', 'sport', 'team', 'garment'], mos_clean_filled($id)) === []);

    // 3. What the owner clears stays cleared.
    $bolir = get_term_by('slug', 'bolir-efri-likami', 'product_cat');
    wp_remove_object_terms($id, [(int) $bolir->term_id], 'product_cat');
    $p = wc_get_product($id);
    $attrs = $p->get_attributes();
    unset($attrs['pa_felag-lid']);
    $p->set_attributes($attrs);
    $GLOBALS['mos_clean_running'] = true;
    try { $p->save(); } finally { $GLOBALS['mos_clean_running'] = false; }
    $check('(the owner cleared the garment category and the team)', $slugs($id, 'product_cat') === $with_default(['karlar']) && $slugs($id, 'pa_felag-lid') === []);
    $check('a cleared garment and team are not filled again', $fill($id) === [] && $slugs($id, 'product_cat') === $with_default(['karlar']) && $slugs($id, 'pa_felag-lid') === [],
        implode(',', $slugs($id, 'product_cat')) . ' / ' . implode(',', $slugs($id, 'pa_felag-lid')));

    // 4. The journal puts the product back as it was before the first fill.
    $cli = new MOS_Clean_CLI();
    ob_start();
    $cli->restore([$journal_file], []);
    ob_end_clean();
    $check('restore: no brand, team or sport left, and only the category it started in', $slugs($id, 'product_brand') === [] && $slugs($id, 'product_cat') === [$default_cat]
        && $slugs($id, 'pa_felag-lid') === [] && $slugs($id, 'pa_ithrott') === [],
        wp_json_encode([$slugs($id, 'product_brand'), $slugs($id, 'product_cat'), $slugs($id, 'pa_felag-lid'), $slugs($id, 'pa_ithrott')]));
    $check('restore: the "filled" memory is gone too, so the product can be filled afresh', mos_clean_filled($id) === []);
    $check('restore: the product holds no team or sport attribute', $attribute_slugs($id, 'pa_felag-lid') === [] && $attribute_slugs($id, 'pa_ithrott') === []);

    // 5. A product already filed by garment keeps the staff's choice; a team it lacks is still added.
    $id2 = $make(new WC_Product_Simple(), 'Adidas Liverpool Tiro Training Jakki');
    $peysur = get_term_by('slug', 'peysur-efri-likami', 'product_cat');
    wp_set_object_terms($id2, [(int) $peysur->term_id], 'product_cat');
    $set = $fill($id2);
    $check('filed under Peysur by staff: no Yfirhafnir from "Jakki"', !isset($set['garment']) && $slugs($id2, 'product_cat') === ['peysur-efri-likami'], wp_json_encode($set));
    $check('but the team in its name is filled', ($set['team'] ?? null) === 'liverpool' && $slugs($id2, 'pa_felag-lid') === ['liverpool']);

    // 6. A team attribute used for variations is never written.
    $variable = new WC_Product_Variable();
    $attr = new WC_Product_Attribute();
    $attr->set_id((int) wc_attribute_taxonomy_id_by_name('pa_felag-lid'));
    $attr->set_name('pa_felag-lid');
    $attr->set_variation(true);
    $variable->set_attributes(['pa_felag-lid' => $attr]);
    $id3 = $make($variable, 'Arsenal treyja');
    $set = $fill($id3);
    $check('a team attribute used for variations is left alone', !isset($set['team']) && $slugs($id3, 'pa_felag-lid') === [], wp_json_encode($set));
    $check('while the garment is still filled', ($set['garment'] ?? null) === 'bolir-efri-likami');

    // 7. A catalog editor's save: the fill runs first, and the poke that follows names the filled product. Published,
    // because only a published product has a storefront path to name; hidden from the catalog, so no listing shows it
    // in the moment it exists.
    foreach (['mos_clean_dirty', 'mos_shell_poke', 'mos_size_dirty'] as $g) { $GLOBALS[$g] = null; }
    $GLOBALS['mos_shell_poke_flushed'] = false;
    $sent = [];
    $p4 = new WC_Product_Simple();
    $p4->set_name('KSÍ Landsliðstreyja Puma 26/28 prufa');
    $p4->set_status('publish');
    $p4->set_catalog_visibility('hidden');
    $id4 = $p4->save();                                 // woocommerce_new_product: the real hooks queue it
    $made[] = $id4;
    $check('the save queued the product for filling', isset($GLOBALS['mos_clean_dirty'][$id4]));
    mos_clean_flush();                                  // what 'shutdown' runs first
    $check('the save-time fill filed it: Ísland and Bolir', $slugs($id4, 'pa_felag-lid') === ['island-iceland'] && in_array('bolir-efri-likami', $slugs($id4, 'product_cat'), true),
        implode(',', $slugs($id4, 'pa_felag-lid')) . ' / ' . implode(',', $slugs($id4, 'product_cat')));
    $path = mos_shell_poke_path_of($id4);
    mos_shell_poke_flush();                             // then the poke
    // Only what went to the storefront: publishing a product also makes WooCommerce send its own usage ping.
    $sent = array_values(array_filter($sent, static fn ($s) => str_ends_with($s['url'], '/api/shell-refresh')));
    $bodies = array_map(static fn ($s) => json_decode($s['body'], true), $sent);
    $named = array_merge(...array_map(static fn ($b) => is_array($b) ? ($b['stale'] ?? []) : [], $bodies ?: [[]]));
    $check('the poke sent after the fill names the product and the listings', $path !== null && in_array($path, $named, true)
        && array_filter($bodies, static fn ($b) => is_array($b) && !empty($b['listings'])) !== [], 'path ' . var_export($path, true) . ', named ' . wp_json_encode($named));
    $check('one poke, not one per save', count($sent) === 1, (string) count($sent));

    // 8. Merging one team into another (as "HSÍ" into "Ísland"): every product moves, a product with both ends with the
    // one, the old team goes, and the journal brings all of it back.
    $old_t = wp_insert_term('Mos Prufa Gamalt', 'pa_felag-lid', ['slug' => 'mos-prufa-gamalt']);
    $new_t = wp_insert_term('Mos Prufa Nytt', 'pa_felag-lid', ['slug' => 'mos-prufa-nytt']);
    if (is_wp_error($old_t) || is_wp_error($new_t)) {
        $check('(the two test teams could be created)', false);
    } else {
        $made_terms = [(int) $old_t['term_id'], (int) $new_t['term_id']];
        $with_teams = static function (string $name, array $term_ids) use ($make): int {
            $id = $make(new WC_Product_Simple(), $name);
            $p = wc_get_product($id);
            mos_clean_set_attribute($p, 'pa_felag-lid', $term_ids);
            $GLOBALS['mos_clean_running'] = true;
            try { $p->save(); } finally { $GLOBALS['mos_clean_running'] = false; }
            return $id;
        };
        $a = $with_teams('Prufuvara með gamla liðinu', [$made_terms[0]]);
        $b = $with_teams('Prufuvara með báðum liðum', $made_terms);
        $merge_file = tempnam(sys_get_temp_dir(), 'mos-clean-test-merge');
        $merge_journal = new MOS_Clean_Journal($merge_file);
        $op = ['op' => 'merge', 'tax' => 'pa_felag-lid', 'from' => 'mos-prufa-gamalt', 'to' => 'mos-prufa-nytt'];
        $GLOBALS['mos_clean_running'] = true;
        try {
            $moved = mos_clean_move_products($op, get_term($made_terms[0], 'pa_felag-lid'), $merge_journal);
            $emptied = get_objects_in_term($made_terms[0], 'pa_felag-lid') === [];
            if ($emptied) { mos_clean_delete_term(get_term($made_terms[0], 'pa_felag-lid'), $merge_journal); }
        } finally { $GLOBALS['mos_clean_running'] = false; }
        $merge_journal->save();
        sort($moved['changed']);
        $check('merge: both products moved, none skipped', $moved['changed'] === [$a, $b] && $moved['skipped'] === [], wp_json_encode($moved));
        $check('merge: the product with the old team has the new one', $slugs($a, 'pa_felag-lid') === ['mos-prufa-nytt'] && $attribute_slugs($a, 'pa_felag-lid') === ['mos-prufa-nytt']);
        $check('merge: the product with both has the new one, once', $slugs($b, 'pa_felag-lid') === ['mos-prufa-nytt'] && $attribute_slugs($b, 'pa_felag-lid') === ['mos-prufa-nytt'],
            implode(',', $attribute_slugs($b, 'pa_felag-lid')));
        $check('merge: the old team is gone', $emptied && !get_term_by('slug', 'mos-prufa-gamalt', 'pa_felag-lid') instanceof WP_Term);
        ob_start();
        $cli->restore([$merge_file], []);
        ob_end_clean();
        $back = get_term_by('slug', 'mos-prufa-gamalt', 'pa_felag-lid');
        $check('restore: the old team is back, by its slug and name', $back instanceof WP_Term && $back->name === 'Mos Prufa Gamalt');
        $check('restore: each product has the teams it had', $slugs($a, 'pa_felag-lid') === ['mos-prufa-gamalt'] && $slugs($b, 'pa_felag-lid') === ['mos-prufa-gamalt', 'mos-prufa-nytt'],
            implode(',', $slugs($a, 'pa_felag-lid')) . ' / ' . implode(',', $slugs($b, 'pa_felag-lid')));
        if (is_file($merge_file)) { unlink($merge_file); }
    }
} finally {
    foreach (['mos-prufa-gamalt', 'mos-prufa-nytt'] as $slug) {
        $t = get_term_by('slug', $slug, 'pa_felag-lid');
        if ($t instanceof WP_Term) { $made_terms_left[] = (int) $t->term_id; }
    }
    $GLOBALS['mos_clean_running'] = true;   // deleting is not a catalog edit to fill
    foreach ($made as $id) { wp_delete_post((int) $id, true); }
    $GLOBALS['mos_clean_running'] = false;
    foreach ($made as $id) {
        if (get_post((int) $id) !== null) { echo "WARNING test product $id was not deleted\n"; }
    }
    foreach ($made_terms_left ?? [] as $term_id) { wp_delete_term($term_id, 'pa_felag-lid'); }
    foreach (['mos-prufa-gamalt', 'mos-prufa-nytt'] as $slug) {
        if (get_term_by('slug', $slug, 'pa_felag-lid') instanceof WP_Term) { echo "WARNING test team $slug was not deleted\n"; }
    }
    if ($journal_file !== null && is_file($journal_file)) { unlink($journal_file); }
    // Nothing of this test's may be sent when the process exits: the deletes above queued pokes for products that never
    // were in the shop.
    foreach (['mos_clean_dirty', 'mos_shell_poke', 'mos_size_dirty'] as $g) { $GLOBALS[$g] = null; }
    remove_filter('pre_http_request', $capture, 10);
}

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
