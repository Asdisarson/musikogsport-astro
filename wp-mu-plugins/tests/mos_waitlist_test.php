<?php
/**
 * Unit test for ../mos-waitlist.php against stand-ins for WordPress, WooCommerce and the WooCommerce Waitlist
 * plugin's wcwl_add_user_to_waitlist() (no WordPress):
 *  - the route is a public POST with typed args;
 *  - what may be waited for: a published simple product or variation (of a published parent) that is not in stock;
 *    anything else is a 404, something that can be bought (backorders too) a 409;
 *  - a bad address or product id is a 400, without a call to the plugin (the plugin missing, a 503: the WordPress test);
 *  - a visitor's sign-up lists nobody yet: it mails the address a link (the storefront's /bidlisti/stadfesta/ with a
 *    one-time token, kept two days; neither the address nor the product is in the link) and answers confirm:true;
 *  - a signed-in customer signing up with the account's own address is listed at once (confirm:false, no mail);
 *    with any other address the customer is a visitor like any other;
 *  - confirming the token lists the address for the exact product id, once; no customer account is made (the
 *    plugin's create-account option reads 'no' during the call and only then); an unknown, malformed or used token
 *    is a 404, a product back in stock a 409;
 *  - a new address and one already on the list get the same answer; the plugin's own wording is not passed on;
 *  - no storefront address to link to is a 503, the mailer refusing a 502, both logged without the address;
 *  - the plugin failing is a 502, logged without the address;
 *  - the three caps (address, caller, store-wide) answer 429 without a call, and refusals cost no slot.
 *
 * Run: php wp-mu-plugins/tests/mos_waitlist_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
const HOUR_IN_SECONDS = 3600;

final class WP_Error {
    public function __construct(public string $code = '', public string $message = '', public array $data = []) {}
    public function get_error_message(): string { return $this->message; }
    public function get_error_code(): string { return $this->code; }
}
final class WP_REST_Request {
    public function __construct(private array $params) {}
    public function get_param(string $key) { return $this->params[$key] ?? null; }
}
final class WP_REST_Response {
    public function __construct(public array $data, public int $status = 200) {}
}
final class Fake_Product {
    public function __construct(private string $type, private string $status, private bool $in_stock, private int $parent = 0) {}
    public function get_name(): string { return 'Skór <41>'; }
    public function get_type(): string { return $this->type; }
    public function get_status(): string { return $this->status; }
    public function is_in_stock(): bool { return $this->in_stock; }
    public function get_parent_id(): int { return $this->parent; }
}

$GLOBALS['transients'] = [];
$GLOBALS['routes'] = [];
$GLOBALS['filters'] = [];
$GLOBALS['calls'] = [];          // every wcwl_add_user_to_waitlist call: [email, product id, the create-account option then]
$GLOBALS['answer'] = 'You have been added to the waitlist for this product.';
$GLOBALS['mails'] = [];          // every mail sent: [to, subject, message]
$GLOBALS['mail_ok'] = true;
$GLOBALS['base'] = 'https://shop.test';
$GLOBALS['user'] = ['ID' => 0, 'user_email' => ''];
$GLOBALS['products'] = [
    10 => new Fake_Product('simple', 'publish', false),
    11 => new Fake_Product('simple', 'publish', true),
    12 => new Fake_Product('simple', 'draft', false),
    20 => new Fake_Product('variable', 'publish', false),
    21 => new Fake_Product('variation', 'publish', false, 20),
    22 => new Fake_Product('variation', 'publish', true, 20),
    30 => new Fake_Product('variable', 'private', false),
    31 => new Fake_Product('variation', 'publish', false, 30),
    41 => new Fake_Product('variation', 'publish', false, 999),   // its parent is gone
    50 => new Fake_Product('grouped', 'publish', false),
];

function add_action(string $hook, callable $fn): void { if ($hook === 'rest_api_init') { $fn(); } }
function register_rest_route(string $ns, string $route, array $args): void { $GLOBALS['routes']["$ns$route"] = $args; }
function is_wp_error($v): bool { return $v instanceof WP_Error; }
function sanitize_email(string $v): string { return preg_replace('/[^a-zA-Z0-9@._+\-]/', '', $v); }
function is_email(string $v): bool { return (bool) preg_match('/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i', $v); }
function get_transient(string $k) { return $GLOBALS['transients'][$k] ?? false; }
function set_transient(string $k, $v, int $ttl): void { $GLOBALS['transients'][$k] = $v; }
function add_filter(string $hook, callable $fn): void { $GLOBALS['filters'][$hook][] = $fn; }
function remove_filter(string $hook, callable $fn): void {
    $GLOBALS['filters'][$hook] = array_values(array_filter($GLOBALS['filters'][$hook] ?? [], static fn ($f) => $f !== $fn));
}
/** The option as WordPress would answer it: a pre_option filter wins over the stored value ('yes', the plugin's default). */
function get_option(string $name) {
    foreach ($GLOBALS['filters']["pre_option_$name"] ?? [] as $fn) { return $fn(false); }
    return 'yes';
}
function delete_transient(string $k): void { unset($GLOBALS['transients'][$k]); }
function esc_html(string $v): string { return htmlspecialchars($v, ENT_QUOTES); }
function esc_url(string $v): string { return $v; }
function get_bloginfo(string $k): string { return 'Músík og Sport'; }
function wp_specialchars_decode(string $v, $flags = 0): string { return $v; }
function mos_headless_target_base(): string { return $GLOBALS['base']; }
function wp_get_current_user() { return (object) $GLOBALS['user']; }
final class Fake_Mailer {
    public function wrap_message(string $heading, string $body): string { return "[$heading]$body"; }
    public function send($to, $subject, $message): bool { $GLOBALS['mails'][] = [$to, $subject, $message]; return $GLOBALS['mail_ok']; }
}
function WC() { return new class { public function mailer() { return new Fake_Mailer(); } }; }
function wc_get_product($id) { return $GLOBALS['products'][(int) $id] ?? false; }
function wcwl_add_user_to_waitlist($email, $product_id, $lang = '') {
    $GLOBALS['calls'][] = [$email, $product_id, get_option('woocommerce_waitlist_create_account')];
    return $GLOBALS['answer'];
}

$log = tempnam(sys_get_temp_dir(), 'moswl');
ini_set('error_log', $log);

require __DIR__ . '/../mos-waitlist.php';

$pass = 0;
$fail = 0;
function check(string $label, bool $ok, string $detail = ''): void {
    global $pass, $fail;
    if ($ok) { $pass++; return; }
    $fail++;
    echo "FAIL $label $detail\n";
}
/** Sign an address up from a fresh caller (no caps hit) unless $keep. @return WP_REST_Response|WP_Error */
function signup(string $email, $product_id, bool $keep = false) {
    if (!$keep) { $GLOBALS['transients'] = []; }
    $GLOBALS['calls'] = [];
    $GLOBALS['mails'] = [];
    $_SERVER['REMOTE_ADDR'] = '203.0.113.5';
    return mos_waitlist_rest(new WP_REST_Request(['email' => $email, 'product_id' => $product_id]));
}
/** The token in the last mail's link. */
function mailed_token(): string {
    return preg_match('~https://shop\.test/bidlisti/stadfesta/\?t=([0-9a-f]{48})"~', end($GLOBALS['mails'])[2] ?? '', $m) ? $m[1] : '';
}
function confirm($token) {
    $GLOBALS['calls'] = [];
    return mos_waitlist_confirm_rest(new WP_REST_Request(['token' => $token]));
}
$status = static fn ($r): int => $r instanceof WP_Error ? (int) ($r->data['status'] ?? 0) : $r->status;

// --- the route ---
$route = $GLOBALS['routes']['mos/v1/waitlist'] ?? null;
check('route registered: POST, public, typed args', $route !== null && $route['methods'] === 'POST' && $route['permission_callback'] === '__return_true'
    && $route['args']['email']['type'] === 'string' && $route['args']['product_id']['type'] === 'integer' && $route['callback'] === 'mos_waitlist_rest');

$confirm_route = $GLOBALS['routes']['mos/v1/waitlist/confirm'] ?? null;
check('confirm route registered: POST, public, typed token', $confirm_route !== null && $confirm_route['methods'] === 'POST' && $confirm_route['permission_callback'] === '__return_true'
    && $confirm_route['args']['token']['type'] === 'string' && $confirm_route['callback'] === 'mos_waitlist_confirm_rest');

// --- what may be waited for ---
check('a sold-out simple product: yes', mos_waitlist_refusal(wc_get_product(10)) === null);
check('a sold-out variation of a published parent: yes', mos_waitlist_refusal(wc_get_product(21)) === null);
check('in stock: 409', mos_waitlist_refusal(wc_get_product(11)) === 409 && mos_waitlist_refusal(wc_get_product(22)) === 409);
check('no such product: 404', mos_waitlist_refusal(false) === 404 && mos_waitlist_refusal(null) === 404);
check('an unpublished product: 404', mos_waitlist_refusal(wc_get_product(12)) === 404);
check('a variation of an unpublished or missing parent: 404', mos_waitlist_refusal(wc_get_product(31)) === 404 && mos_waitlist_refusal(wc_get_product(41)) === 404);
check('a variable parent or a grouped product has no list of its own: 404', mos_waitlist_refusal(wc_get_product(20)) === 404 && mos_waitlist_refusal(wc_get_product(50)) === 404);

// --- refusals without a call ---
check('bad address: 400, no call', $status(signup('not an address', 10)) === 400 && $GLOBALS['calls'] === []);
check('an address sanitising would change is refused', $status(signup('jón@b.is', 10)) === 400 && $GLOBALS['calls'] === []);
check('bad product id: 400, no call', $status(signup('anna@b.is', 0)) === 400 && $status(signup('anna@b.is', -4)) === 400 && $GLOBALS['calls'] === []);
check('unknown product: 404, no call', $status(signup('anna@b.is', 777)) === 404 && $GLOBALS['calls'] === []);
check('in stock: 409, no call', $status(signup('anna@b.is', 11)) === 409 && $GLOBALS['calls'] === []);

// --- a visitor's sign-up: a mail to confirm, nobody listed yet ---
$r = signup(' Anna@B.is ', 21);
check('sign-up: 200 {ok, confirm:true}', $status($r) === 200 && $r->data === ['ok' => true, 'confirm' => true]);
check('sign-up: the plugin is not called yet', $GLOBALS['calls'] === []);
check('sign-up: one mail to the trimmed address, in Icelandic, naming the product (escaped)', count($GLOBALS['mails']) === 1 && $GLOBALS['mails'][0][0] === 'Anna@B.is'
    && $GLOBALS['mails'][0][1] === 'Staðfestu skráningu á biðlista' && str_contains($GLOBALS['mails'][0][2], 'Skór &lt;41&gt;'), json_encode($GLOBALS['mails']));
$token = mailed_token();
check('sign-up: the link is the storefront page with a token only', $token !== '' && !str_contains($GLOBALS['mails'][0][2], 'Anna%40') && !str_contains($GLOBALS['mails'][0][2], 'product_id'));
check('sign-up: the pending sign-up is kept under the token\'s hash, not the token', isset($GLOBALS['transients']['mos_wl_' . hash('sha256', $token)]) && !str_contains(json_encode(array_keys($GLOBALS['transients'])), $token));

// --- confirming ---
foreach (['', 'short', str_repeat('g', 48), str_repeat('a', 48), ['x']] as $bad) {
    check('confirm: an unknown or malformed token is a 404 without a call (' . json_encode($bad) . ')', $status(confirm($bad)) === 404 && $GLOBALS['calls'] === []);
}
$r = confirm($token);
check('confirm: 200 {ok:true}', $status($r) === 200 && $r->data === ['ok' => true]);
check('confirm: the address and the exact variation id reach the plugin', count($GLOBALS['calls']) === 1 && $GLOBALS['calls'][0][0] === 'Anna@B.is' && $GLOBALS['calls'][0][1] === 21);
check('confirm: no customer account is created (the option reads "no" during the call)', $GLOBALS['calls'][0][2] === 'no');
check('the option is the stored one again afterwards', get_option('woocommerce_waitlist_create_account') === 'yes');
check('confirm: a token works once', $status(confirm($token)) === 404 && $GLOBALS['calls'] === []);

$GLOBALS['answer'] = 'The email provided is already on the waitlist for this product.';
$again = signup('anna@b.is', 21);
check('already on the list: the same answer and a mail all the same', $status($again) === 200 && $again->data === ['ok' => true, 'confirm' => true] && count($GLOBALS['mails']) === 1);
check('already on the list: confirming answers the same', confirm(mailed_token())->data === ['ok' => true]);
$GLOBALS['answer'] = 'You have been added to the waitlist for this product.';

signup('anna@b.is', 21);
$token = mailed_token();
$GLOBALS['products'][21] = new Fake_Product('variation', 'publish', true, 20);
check('confirm: back in stock meanwhile is a 409 without a call', $status(confirm($token)) === 409 && $GLOBALS['calls'] === []);
$GLOBALS['products'][21] = new Fake_Product('variation', 'publish', false, 20);

// --- a signed-in customer ---
$GLOBALS['user'] = ['ID' => 7, 'user_email' => 'Anna@B.is'];
$r = signup('anna@b.is', 21);
check('signed in, own address: listed at once as the account\'s address, confirm:false, no mail', $status($r) === 200 && $r->data === ['ok' => true, 'confirm' => false]
    && $GLOBALS['mails'] === [] && count($GLOBALS['calls']) === 1 && $GLOBALS['calls'][0][0] === 'Anna@B.is' && $GLOBALS['calls'][0][1] === 21 && $GLOBALS['calls'][0][2] === 'no');
$r = signup('someone-else@b.is', 21);
check('signed in, another address: a visitor like any other', $r->data === ['ok' => true, 'confirm' => true] && $GLOBALS['calls'] === [] && count($GLOBALS['mails']) === 1 && $GLOBALS['mails'][0][0] === 'someone-else@b.is');
$GLOBALS['user'] = ['ID' => 0, 'user_email' => ''];

// --- failures ---
$GLOBALS['base'] = '';
check('no storefront address to link to: 503, no mail', $status(signup('anna@b.is', 21)) === 503 && $GLOBALS['mails'] === []);
$GLOBALS['base'] = 'https://shop.test';
$GLOBALS['mail_ok'] = false;
$r = signup('anna@b.is', 21);
check('the mailer refusing: 502 with our wording, nothing left pending', $status($r) === 502 && $r->message === MOS_WAITLIST_FAILED && $GLOBALS['transients'] === array_filter($GLOBALS['transients'], static fn ($k) => !str_starts_with($k, 'mos_wl_'), ARRAY_FILTER_USE_KEY));
for ($i = 0; $i < MOS_WAITLIST_ADDRESS_CAP + 2; $i++) { $r = signup('anna@b.is', 21, true); }
check('a mail that was not sent costs no slot', $status($r) === 502);
$GLOBALS['mail_ok'] = true;
signup('anna@b.is', 21);
$token = mailed_token();
$GLOBALS['answer'] = new WP_Error('woocommerce-waitlist', 'Something went wrong for anna@b.is');
$r = confirm($token);
check('plugin error on confirming: 502 with our wording, and the link still works afterwards', $status($r) === 502 && $r->message === MOS_WAITLIST_FAILED);
$GLOBALS['answer'] = 'You have been added to the waitlist for this product.';
check('…it does', $status(confirm($token)) === 200);
$logged = (string) file_get_contents($log);
check('failures are logged with the product id, without the address', str_contains($logged, 'product 21: woocommerce-waitlist') && str_contains($logged, 'confirmation mail for product 21') && !str_contains(strtolower($logged), 'anna@b.is'), $logged);
check('the option is restored after a failure too', get_option('woocommerce_waitlist_create_account') === 'yes');

// --- caps ---
$GLOBALS['transients'] = [];
for ($i = 0; $i < MOS_WAITLIST_ADDRESS_CAP; $i++) { $r = signup('same@b.is', 10, true); }
check('address cap: the last allowed one passes', $status($r) === 200);
check('address cap: the next is 429 without a call', $status(signup('same@b.is', 10, true)) === 429 && $GLOBALS['calls'] === []);
$GLOBALS['transients'] = [];
for ($i = 0; $i < MOS_WAITLIST_IP_HOURLY_CAP; $i++) { $r = signup("a$i@b.is", 10, true); }
check('caller cap: the last allowed one passes', $status($r) === 200);
check('caller cap: the next is 429 without a call', $status(signup('one-more@b.is', 10, true)) === 429 && $GLOBALS['calls'] === []);
$GLOBALS['transients'] = [];
for ($i = 0; $i < MOS_WAITLIST_ADDRESS_CAP + 3; $i++) { signup('same@b.is', 11, true); }
check('refusals (in stock) cost no slot', $status(signup('same@b.is', 10, true)) === 200);

unlink($log);
printf("%d passed, %d failed\n", $pass, $fail);
exit($fail ? 1 : 0);
