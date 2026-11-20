<?php
/**
 * WordPress-level test for ../mos-product-names.php against the local catalog: a new product's name is tidied once,
 * its link keeps the name as typed, its SKU is untouched, and a later rename by staff stands. It creates two
 * throwaway products and deletes them; the switch (MOS_NAMES_LIVE_OPTION) is put back as it was.
 *
 * Run (local site): wpms eval-file wp-mu-plugins/tests/mos_names_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

global $wpdb;
$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};
$title = static function (int $id): string { clean_post_cache($id); return (string) get_post_field('post_title', $id); };
$slug = static function (int $id): string { clean_post_cache($id); return (string) get_post_field('post_name', $id); };

$was_live = get_option(MOS_NAMES_LIVE_OPTION);
$made = [];
try {
    // Switched off: nothing happens.
    delete_option(MOS_NAMES_LIVE_OPTION);
    $p = new WC_Product_Simple();
    $p->set_name('NIKE MOSTEST AIR NIKE TOP');
    $p->set_status('publish');
    $off = $made[] = $p->save();
    $check('switched off: the name stays as typed', $title($off) === 'NIKE MOSTEST AIR NIKE TOP', $title($off));
    $check('switched off: the product is not marked', get_post_meta($off, MOS_NAMES_META, true) === '');

    // Switched on: a published product.
    update_option(MOS_NAMES_LIVE_OPTION, '1', false);
    $p = new WC_Product_Simple();
    $p->set_name('NIKE MOSTEST PRO NIKE TOP 2025');
    $p->set_sku('MOSTEST-SKU-1');
    $p->set_status('publish');
    $id = $made[] = $p->save();
    $check('a new product\'s name is tidied', $title($id) === 'Nike Mostest Pro Top 2025', $title($id));
    $check('its link keeps the full name as typed', $slug($id) === 'nike-mostest-pro-nike-top-2025', $slug($id));
    $check('its SKU is untouched', get_post_meta($id, '_sku', true) === 'MOSTEST-SKU-1', (string) get_post_meta($id, '_sku', true));
    $check('it is marked as handled', get_post_meta($id, MOS_NAMES_META, true) === '1');

    // Staff rename it afterwards: that stands.
    $p = wc_get_product($id);
    $p->set_name('NIKE MOSTEST PRO Í HÁSTÖFUM');
    $p->save();
    $check('a later name by staff stands', $title($id) === 'NIKE MOSTEST PRO Í HÁSTÖFUM', $title($id));
    $check('and the link is still the first one', $slug($id) === 'nike-mostest-pro-nike-top-2025', $slug($id));

    // A draft has no link yet: it gets it from the name as typed.
    $p = new WC_Product_Simple();
    $p->set_name('ADIDAS MOSTEST FRUMDRÖG ADIDAS BOLUR');
    $p->set_status('draft');
    $draft = $made[] = $p->save();
    $check('a draft\'s name is tidied', $title($draft) === 'Adidas Mostest Frumdrög Bolur', $title($draft));
    $check('a draft\'s link comes from the name as typed', $slug($draft) === sanitize_title('ADIDAS MOSTEST FRUMDRÖG ADIDAS BOLUR'), $slug($draft));
    wp_publish_post($draft);
    $check('publishing keeps that link', $slug($draft) === sanitize_title('ADIDAS MOSTEST FRUMDRÖG ADIDAS BOLUR'), $slug($draft));

    // A draft whose tidied name gives the same link is left without one, like any draft, until it is published.
    $p = new WC_Product_Simple();
    $p->set_name('NIKE MOSTEST HÁSTAFADRÖG');
    $p->set_status('draft');
    $caps = $made[] = $p->save();
    $check('a capitals-only draft is tidied', $title($caps) === 'Nike Mostest Hástafadrög', $title($caps));
    $check('and gets no link before it is published', $slug($caps) === '', $slug($caps));

    // The name changed between the reading and the write: the write is refused.
    $check('a name that is no longer the one read is not overwritten', mos_names_write($id, 'SOME OLDER NAME', 'Some Older Name') === false && $title($id) === 'NIKE MOSTEST PRO Í HÁSTÖFUM', $title($id));

    // A size's own title starts with the product's name (WooCommerce writes it so): it follows the product.
    $parent = new WC_Product_Variable();
    $parent->set_name('PUMA MOSTEST AFBRIGÐI');
    $parent->set_status('publish');
    update_post_meta($pid = $made[] = $parent->save(), MOS_NAMES_META, '');   // (made while switched on: already tidied)
    $wpdb->update($wpdb->posts, ['post_title' => 'PUMA MOSTEST AFBRIGÐI'], ['ID' => $pid]);
    $vid = $made[] = wp_insert_post(['post_type' => 'product_variation', 'post_parent' => $pid, 'post_status' => 'publish', 'post_title' => 'PUMA MOSTEST AFBRIGÐI - 128']);
    $wpdb->update($wpdb->posts, ['post_title' => 'PUMA MOSTEST AFBRIGÐI - 128'], ['ID' => $vid]);   // as WooCommerce names a size
    clean_post_cache($pid);
    $check('the product is renamed', mos_names_write($pid, 'PUMA MOSTEST AFBRIGÐI', 'Puma Mostest Afbrigði') && $title($pid) === 'Puma Mostest Afbrigði', $title($pid));
    $check('its size follows', $title($vid) === 'Puma Mostest Afbrigði - 128', $title($vid));
    mos_names_rename_variations($pid, 'Puma Mostest Afbrigði', 'PUMA MOSTEST AFBRIGÐI');
    $check('and follows it back on a restore', $title($vid) === 'PUMA MOSTEST AFBRIGÐI - 128', $title($vid));
} finally {
    foreach ($made as $m) { wp_delete_post((int) $m, true); }
    if ($was_live === false) { delete_option(MOS_NAMES_LIVE_OPTION); } else { update_option(MOS_NAMES_LIVE_OPTION, $was_live, false); }
    delete_transient(MOS_NAMES_VOCAB_TRANSIENT);
}
$left = array_filter($made, static fn ($m) => get_post((int) $m) instanceof WP_Post);
$check('the throwaway products are gone', $left === []);

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
