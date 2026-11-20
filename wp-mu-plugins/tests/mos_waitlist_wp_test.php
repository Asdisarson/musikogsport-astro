<?php
/**
 * WordPress-level test for ../mos-waitlist.php with the real WooCommerce Waitlist plugin: the route's typed args and
 * refusals, and one real sign-up: a visitor's address is mailed a link and listed nowhere until the link's token is
 * confirmed; then it lands in the product's own `woocommerce_waitlist` meta, no customer account is made for it, and
 * the token works once. A signed-in customer's own address is listed at once. A product in stock is a 409.
 *
 * Writes, then cleans up: it makes one sold-out simple product (a draft would be refused, so it is published for the
 * length of the test) and deletes it for good at the end, with its waitlist. The address is under example.invalid
 * and no mail leaves: the confirmation mail is read and stopped in woocommerce_mail_callback. The current user is switched in
 * memory only. The route's hourly caps are counted in transients as for any caller (a handful of sign-ups here).
 * Run (local site only): wpms eval-file wp-mu-plugins/tests/mos_waitlist_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};
$post = static function (array $params, string $route = '/mos/v1/waitlist') {
    $request = new WP_REST_Request('POST', $route);
    $request->set_header('Content-Type', 'application/json');
    $request->set_body((string) wp_json_encode($params));
    return rest_do_request($request);
};

$check('the WooCommerce Waitlist plugin is active', function_exists('wcwl_add_user_to_waitlist'));
$check('routes registered', isset(rest_get_server()->get_routes()['/mos/v1/waitlist'], rest_get_server()->get_routes()['/mos/v1/waitlist/confirm']));
$check('a storefront address to link to is configured', function_exists('mos_headless_target_base') && mos_headless_target_base() !== '');
if ($fail) { echo "$fail failed\n"; return; }

$check('an array for the address is a 400 from REST', $post(['email' => ['a@b.is'], 'product_id' => 1])->get_status() === 400);
$check('a product id that is no number is a 400 from REST', $post(['email' => 'a@example.invalid', 'product_id' => 'abc'])->get_status() === 400);
$check('a bad address is a 400', $post(['email' => 'not an address', 'product_id' => 1])->get_status() === 400);
$check('an unknown product is a 404', $post(['email' => 'a@example.invalid', 'product_id' => 2147483000])->get_status() === 404);

$product = new WC_Product_Simple();
$product->set_name('MOS waitlist test ' . wp_generate_password(6, false));
$product->set_status('publish');
$product->set_catalog_visibility('hidden');
$product->set_regular_price('1000');
$product->set_stock_status('outofstock');
$id = $product->save();
$email = 'mos-waitlist-' . strtolower(wp_generate_password(8, false)) . '@example.invalid';
$mails = [];
// WooCommerce's mailer hands each mail to this instead of wp_mail: read, never sent (whatever replaces wp_mail here).
$record_mail = static function ($to, $subject, $message) use (&$mails): bool {
    $mails[] = ['to' => $to, 'subject' => $subject, 'message' => $message];
    return true;
};
$catch_mail = static fn () => $record_mail;
add_filter('woocommerce_mail_callback', $catch_mail, 99);
$before_user = get_current_user_id();
try {
    wp_set_current_user(0);
    $users_before = (int) count_users()['total_users'];
    $option_before = get_option('woocommerce_waitlist_create_account');
    $res = $post(['email' => $email, 'product_id' => $id]);
    $check('a visitor\'s sign-up is 200 {ok, confirm:true}', $res->get_status() === 200 && $res->get_data() === ['ok' => true, 'confirm' => true], (string) wp_json_encode($res->get_data()));
    $check('nobody is listed yet', !is_array(get_post_meta($id, 'woocommerce_waitlist', true)) || get_post_meta($id, 'woocommerce_waitlist', true) === []);
    $check('one mail went to the address', count($mails) === 1 && $mails[0]['to'] === $email && $mails[0]['subject'] === 'Staðfestu skráningu á biðlista', (string) wp_json_encode(array_column($mails, 'subject')));
    $token = preg_match('~/bidlisti/stadfesta/\?t=([0-9a-f]{48})~', (string) ($mails[0]['message'] ?? ''), $m) ? $m[1] : '';
    $check('the mail links to the storefront page with a token', $token !== '' && str_contains((string) $mails[0]['message'], mos_headless_target_base() . '/bidlisti/stadfesta/?t='));
    $check('an unknown token is a 404', $post(['token' => str_repeat('0', 48)], '/mos/v1/waitlist/confirm')->get_status() === 404);

    $res = $post(['token' => $token], '/mos/v1/waitlist/confirm');
    $check('confirming is 200 {ok:true}', $res->get_status() === 200 && $res->get_data() === ['ok' => true], (string) wp_json_encode($res->get_data()));
    $list = get_post_meta($id, 'woocommerce_waitlist', true);
    $check('the address is on that product\'s waitlist', is_array($list) && array_key_exists($email, $list), (string) wp_json_encode(is_array($list) ? array_keys($list) : $list));
    $check('no account was made for the address', email_exists($email) === false && (int) count_users()['total_users'] === $users_before);
    $check('the token works once', $post(['token' => $token], '/mos/v1/waitlist/confirm')->get_status() === 404);
    $check('the stored create-account option is untouched', get_option('woocommerce_waitlist_create_account') === $option_before);

    $customers = get_users(['role' => 'customer', 'number' => 1]);
    if ($customers) {
        wp_set_current_user($customers[0]->ID);
        $mails = [];
        $res = $post(['email' => strtoupper($customers[0]->user_email), 'product_id' => $id]);
        $list = (array) get_post_meta($id, 'woocommerce_waitlist', true);
        $check('a signed-in customer\'s own address is listed at once, without a confirmation mail', $res->get_data() === ['ok' => true, 'confirm' => false] && array_key_exists($customers[0]->ID, $list)
            && array_filter($mails, static fn ($mail) => $mail['subject'] === 'Staðfestu skráningu á biðlista') === [], (string) wp_json_encode($res->get_data()));
        wp_set_current_user(0);
    } else {
        echo "SKIP signed-in sign-up: no customer account on this site\n";
    }

    remove_all_actions('woocommerce_product_set_stock_status');   // no back-in-stock mail-out for the test addresses
    $product->set_stock_status('instock');
    $product->save();
    $check('once it is in stock again: 409', $post(['email' => $email, 'product_id' => $id])->get_status() === 409);
} finally {
    remove_filter('woocommerce_mail_callback', $catch_mail, 99);
    wp_set_current_user($before_user);
    wp_delete_post($id, true);
    $check('the test product is gone', get_post($id) === null);
}
echo $fail ? "$fail failed\n" : "all passed\n";
