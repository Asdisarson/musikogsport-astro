<?php
/**
 * WordPress-level test for POST mos/v1/account/from-order in ../mos-account-api.php (the checkout's "Stofna aðgang"
 * box): the pure order check, the refusals, and one real run on a throw-away guest order.
 *
 * LOCAL SITE ONLY. It writes: one order and one customer on a made-up address under example.invalid, both deleted at
 * the end (also after a failure). No mail leaves: WooCommerce's mail callback is replaced and the message captured.
 * Run (local site): wpms eval-file wp-mu-plugins/tests/mos_account_from_order_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP
if (wp_get_environment_type() === 'production') { echo "SKIP: writes test data; not for a production site\n"; return; }

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};
$call = static function (int $id, string $key) {
    $req = new WP_REST_Request('POST', '/mos/v1/account/from-order');
    $req->set_param('order_id', $id);
    $req->set_param('order_key', $key);
    return mos_account_from_order($req);
};
$status = static fn ($r): int => is_wp_error($r) ? (int) ($r->get_error_data()['status'] ?? 0) : 200;

// --- the pure check ---
$now = 1_800_000_000;
$check('order check: a fresh guest order with a free e-mail can get an account', mos_account_order_problem(0, $now - 60, $now, 'a@b.is', false) === null);
$check('order check: not an order that has a customer', mos_account_order_problem(7, $now - 60, $now, 'a@b.is', false) === 'has-customer');
$check('order check: not an old order', mos_account_order_problem(0, $now - MOS_ACCOUNT_ORDER_WINDOW - 1, $now, 'a@b.is', false) === 'too-old' && mos_account_order_problem(0, 0, $now, 'a@b.is', false) === 'too-old');
$check('order check: not without an e-mail', mos_account_order_problem(0, $now - 60, $now, '', false) === 'no-email');
$check('order check: not when the e-mail has an account', mos_account_order_problem(0, $now - 60, $now, 'a@b.is', true) === 'email-taken');

// --- one real run ---
$mails = [];
// WooCommerce's mailer calls whatever this filter names instead of wp_mail (which a local plugin may have replaced).
$catch = static function ($to, $subject, $message) use (&$mails) { $mails[] = ['to' => $to, 'subject' => $subject, 'message' => $message]; return true; };
$capture = static function () use ($catch) { return $catch; };
add_filter('woocommerce_mail_callback', $capture, 99);
delete_transient('mos_rl_fromorder_' . md5((string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown')));
$email = 'mos-test-' . wp_generate_password(10, false) . '@example.invalid';
$order = wc_create_order();
$user_id = 0;
try {
    $order->set_billing_first_name('Prufa');
    $order->set_billing_last_name('Prufudóttir');
    $order->set_billing_email($email);
    $order->set_billing_address_1('Prufugata 1');
    $order->set_billing_city('Hafnarfjörður');
    $order->set_billing_postcode('220');
    $order->set_shipping_address_1('Sendingargata 2');
    $order->save();
    $id = $order->get_id();
    $key = $order->get_order_key();

    $check('wrong key: 400, no account', $status($call($id, 'wc_order_wrong')) === 400 && !email_exists($email));
    $check('unknown order: 400', $status($call(999999999, $key)) === 400);

    $mails = [];
    $r = $call($id, $key);
    $user_id = (int) email_exists($email);
    $check('right key: ok and an account on the order e-mail', $status($r) === 200 && $r->get_data() === ['ok' => true] && $user_id > 0);
    $fresh = wc_get_order($id);
    $check('the order is on the new account', (int) $fresh->get_customer_id() === $user_id);
    $customer = new WC_Customer($user_id);
    $check('the account has the name and both addresses', $customer->get_first_name() === 'Prufa' && $customer->get_billing_address_1() === 'Prufugata 1'
        && $customer->get_billing_postcode() === '220' && $customer->get_shipping_address_1() === 'Sendingargata 2');
    $check('the account is a customer, nothing more', get_userdata($user_id)->roles === ['customer']);
    $check('exactly one mail, to the order e-mail', count($mails) === 1 && $mails[0]['to'] === $email, 'mails: ' . count($mails));
    $message = (string) ($mails[0]['message'] ?? '');
    $linked = preg_match('#href="([^"]*/min-sida/lost-password/\?[^"]*)"#', $message, $m) === 1;
    parse_str((string) wp_parse_url(html_entity_decode($m[1] ?? ''), PHP_URL_QUERY), $q);
    $check('the mail links to the storefront new-password page for this user', $linked && (int) ($q['id'] ?? 0) === $user_id && !empty($q['key']));
    $check('the link key is a valid reset key', $linked && !is_wp_error(check_password_reset_key((string) ($q['key'] ?? ''), get_userdata($user_id)->user_login)));
    $check('no password in the mail', !preg_match('/lykilorð(ið)? (þitt )?er/i', $message));

    $mails = [];
    $again = $call($id, $key);
    $check('asked again: same answer, no second mail', $status($again) === 200 && $again->get_data() === ['ok' => true] && $mails === []);

    // another guest order on the same (now taken) e-mail: same answer, the order stays a guest order
    $second = wc_create_order();
    $second->set_billing_email($email);
    $second->save();
    $mails = [];
    $r2 = $call($second->get_id(), $second->get_order_key());
    $check('e-mail with an account: same answer, no mail, order not attached', $status($r2) === 200 && $mails === [] && (int) wc_get_order($second->get_id())->get_customer_id() === 0);
    $second->delete(true);
} finally {
    remove_filter('woocommerce_mail_callback', $capture, 99);
    $order->delete(true);
    if ($user_id > 0) { require_once ABSPATH . 'wp-admin/includes/user.php'; wp_delete_user($user_id); }
}
$check('clean-up: the test account is gone', !email_exists($email));

echo $fail ? "FAILED: $fail\n" : "ALL PASS\n";
