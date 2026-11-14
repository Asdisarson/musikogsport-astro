<?php
/**
 * Unit test for ../mos-newsletter.php against stand-ins for WordPress and for the Mailchimp for WooCommerce plugin's
 * three helper functions (no WordPress, no Mailchimp call):
 *  - the data centre comes from the key's suffix; the member URL hashes the trimmed, lower-cased address;
 *  - a bad address is a 400, a missing or half-configured Mailchimp connection a 503, both without a call;
 *  - a new address is one PUT with status_if_new following the plugin's double opt-in setting;
 *  - an unsubscribed / cleaned / archived member gets a second PUT asking for confirmation (pending);
 *  - new and already-subscribed addresses get the same answer;
 *  - Mailchimp failing (HTTP error, transport error) is a 502, logged without the key or the address; a failed
 *    re-subscribe is only logged (a different answer would tell that the address had been on the list);
 *  - the three caps (address, caller, store-wide) answer 429 without a call.
 *
 * Run: php wp-mu-plugins/tests/mos_newsletter_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
const HOUR_IN_SECONDS = 3600;

final class WP_Error {
    public function __construct(public string $code = '', public string $message = '', public array $data = []) {}
    public function get_error_message(): string { return $this->message; }
}
final class WP_REST_Request {
    public function __construct(private array $params) {}
    public function get_param(string $key) { return $this->params[$key] ?? null; }
}
final class WP_REST_Response {
    public function __construct(public array $data, public int $status = 200) {}
}

$GLOBALS['transients'] = [];
$GLOBALS['calls'] = [];          // every Mailchimp request: [method, url, args]
$GLOBALS['answers'] = [];        // queued answers: [status, body array] or a WP_Error
$GLOBALS['mc'] = ['key' => 'abc123secretkey-us21', 'list' => 'f00dlist', 'double' => true];
$GLOBALS['routes'] = [];

function add_action(string $hook, callable $fn): void { if ($hook === 'rest_api_init') { $fn(); } }
function register_rest_route(string $ns, string $route, array $args): void { $GLOBALS['routes']["$ns$route"] = $args; }
function is_wp_error($v): bool { return $v instanceof WP_Error; }
function sanitize_email(string $v): string { return preg_replace('/[^a-zA-Z0-9@._+\-]/', '', $v); }
function is_email(string $v): bool { return (bool) preg_match('/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i', $v); }
function get_transient(string $k) { return $GLOBALS['transients'][$k] ?? false; }
function set_transient(string $k, $v, int $ttl): void { $GLOBALS['transients'][$k] = $v; }
function wp_json_encode($v): string { return (string) json_encode($v); }
function wp_remote_request(string $url, array $args) {
    $GLOBALS['calls'][] = [$args['method'], $url, $args];
    return array_shift($GLOBALS['answers']) ?? [200, ['status' => 'pending']];
}
function wp_remote_retrieve_response_code($res): int { return $res[0]; }
function wp_remote_retrieve_body($res): string { return (string) json_encode($res[1]); }
function mailchimp_get_api_key() { return $GLOBALS['mc']['key']; }
function mailchimp_get_list_id() { return $GLOBALS['mc']['list']; }
function mailchimp_list_has_double_optin() { return $GLOBALS['mc']['double']; }

$log = tempnam(sys_get_temp_dir(), 'mosnl');
ini_set('error_log', $log);

require __DIR__ . '/../mos-newsletter.php';

$pass = 0;
$fail = 0;
function check(string $label, bool $ok, string $detail = ''): void {
    global $pass, $fail;
    if ($ok) { $pass++; return; }
    $fail++;
    echo "FAIL $label $detail\n";
}
/** Sign an address up from a fresh caller (no caps hit) unless $keep. @return WP_REST_Response|WP_Error */
function signup(string $email, bool $keep = false) {
    if (!$keep) { $GLOBALS['transients'] = []; }
    $GLOBALS['calls'] = [];
    $_SERVER['REMOTE_ADDR'] = '203.0.113.5';
    return mos_newsletter_rest(new WP_REST_Request(['email' => $email]));
}
$status = static fn ($r): int => $r instanceof WP_Error ? (int) ($r->data['status'] ?? 0) : $r->status;
$body = static fn (int $i = 0): array => json_decode($GLOBALS['calls'][$i][2]['body'], true);

// --- the route ---
$route = $GLOBALS['routes']['mos/v1/newsletter'] ?? null;
check('route registered: POST, public, typed email', $route !== null && $route['methods'] === 'POST' && $route['permission_callback'] === '__return_true'
    && $route['args']['email']['type'] === 'string' && $route['callback'] === 'mos_newsletter_rest');

// --- pure helpers ---
check('datacenter from the key suffix', mos_newsletter_datacenter('abc123-us21') === 'us21');
check('datacenter: none without a suffix', mos_newsletter_datacenter('abc123') === null);
check('datacenter: a suffix that is not a data centre is refused', mos_newsletter_datacenter('abc-evil.example/x') === null && mos_newsletter_datacenter('abc-') === null);
check('member url hashes the trimmed lower-cased address', mos_newsletter_member_url('us21', 'f00dlist', ' Anna@B.is ')
    === 'https://us21.api.mailchimp.com/3.0/lists/f00dlist/members/' . md5('anna@b.is'));
check('next step: subscribed and pending are done', mos_newsletter_next_step('subscribed') === 'done' && mos_newsletter_next_step('pending') === 'done');
check('next step: unsubscribed, cleaned, archived ask again', mos_newsletter_next_step('unsubscribed') === 'resubscribe'
    && mos_newsletter_next_step('cleaned') === 'resubscribe' && mos_newsletter_next_step('archived') === 'resubscribe');

// --- refusals without a call ---
$r = signup('not an address');
check('bad address: 400, no call', $status($r) === 400 && $GLOBALS['calls'] === []);
foreach ([['key' => '', 'list' => 'f00dlist'], ['key' => 'abc-us21', 'list' => ''], ['key' => 'nodatacentre', 'list' => 'f00dlist'], ['key' => false, 'list' => false]] as $broken) {
    $saved = $GLOBALS['mc'];
    $GLOBALS['mc'] = $broken + ['double' => true];
    $r = signup('anna@b.is');
    check('not configured: 503, no call (' . json_encode($broken) . ')', $status($r) === 503 && $GLOBALS['calls'] === []);
    $GLOBALS['mc'] = $saved;
}

// --- a new address ---
$r = signup('jón@b.is');
check('an address sanitising would change is refused, not sent to someone else', $status($r) === 400 && $GLOBALS['calls'] === []);
$r = signup(' Anna@B.is ');
check('new: ok, confirm follows double opt-in', $status($r) === 200 && $r->data === ['ok' => true, 'confirm' => true]);
check('new: one PUT to the member url', count($GLOBALS['calls']) === 1 && $GLOBALS['calls'][0][0] === 'PUT'
    && $GLOBALS['calls'][0][1] === 'https://us21.api.mailchimp.com/3.0/lists/f00dlist/members/' . md5('anna@b.is'), json_encode($GLOBALS['calls'][0] ?? null));
check('new: double opt-in -> status_if_new pending, no status', $body() === ['email_address' => 'Anna@B.is', 'status_if_new' => 'pending'], json_encode($body()));
$auth = $GLOBALS['calls'][0][2]['headers']['Authorization'] ?? '';
check('new: basic auth with the plugin key, 10 s timeout', $auth === 'Basic ' . base64_encode('mos:abc123secretkey-us21') && $GLOBALS['calls'][0][2]['timeout'] === 10);
$GLOBALS['mc']['double'] = false;
$r = signup('anna@b.is');
check('new: single opt-in -> status_if_new subscribed, confirm false', $body()['status_if_new'] === 'subscribed' && $r->data === ['ok' => true, 'confirm' => false]);
$GLOBALS['mc']['double'] = true;

// --- already on the list: the same answer, nothing more ---
$GLOBALS['answers'] = [[200, ['status' => 'subscribed']]];
$r = signup('anna@b.is');
check('already subscribed: same answer, one call', $status($r) === 200 && $r->data === ['ok' => true, 'confirm' => true] && count($GLOBALS['calls']) === 1);

// --- left the list earlier: asked to confirm again ---
foreach (['unsubscribed', 'cleaned', 'archived'] as $was) {
    $GLOBALS['answers'] = [[200, ['status' => $was]], [200, ['status' => 'pending']]];
    $r = signup('anna@b.is');
    check("$was: second PUT asks for confirmation", $status($r) === 200 && count($GLOBALS['calls']) === 2 && $body(1) === ['email_address' => 'anna@b.is', 'status' => 'pending'], json_encode($GLOBALS['calls'][1][2]['body'] ?? null));
}
$GLOBALS['mc']['double'] = false;
$GLOBALS['answers'] = [[200, ['status' => 'unsubscribed']], [200, ['status' => 'pending']]];
signup('anna@b.is');
check('unsubscribed with single opt-in: still pending (Mailchimp only re-adds with consent)', $body(1)['status'] === 'pending');
$GLOBALS['mc']['double'] = true;

// --- Mailchimp failing ---
file_put_contents($log, '');
$GLOBALS['answers'] = [[500, ['detail' => 'boom']]];
$r = signup('anna@b.is');
check('Mailchimp 500: 502', $status($r) === 502);
$GLOBALS['answers'] = [new WP_Error('http_request_failed', 'cURL error 28')];
$r = signup('anna@b.is');
check('transport error: 502', $status($r) === 502);
$GLOBALS['answers'] = [[200, ['status' => 'unsubscribed']], [400, ['title' => 'Forgotten Email Not Subscribed']]];
$r = signup('anna@b.is');
check('re-subscribe refused by Mailchimp: logged, answered like any other', $status($r) === 200 && $r->data === ['ok' => true, 'confirm' => true]);
$logged = (string) file_get_contents($log);
check('failures logged with the status', substr_count($logged, '[mos-newsletter]') === 3 && str_contains($logged, '500') && str_contains($logged, 'cURL error 28'), $logged);
check('log never holds the key or the address', !str_contains($logged, 'abc123secretkey') && !str_contains($logged, 'anna@b.is') && !str_contains($logged, base64_encode('mos:abc123secretkey-us21')), $logged);
$GLOBALS['answers'] = [[400, ['title' => 'Invalid Resource', 'detail' => 'looks fake']]];
$r = signup('anna@b.is');
check('Mailchimp refuses the address (400): 400 for the visitor, not a 502', $status($r) === 400);

// --- caps ---
$GLOBALS['transients'] = [];
for ($i = 0; $i < 3; $i++) { $r = signup('same@b.is', true); }
check('address cap: three tries pass', $status($r) === 200);
$r = signup('same@b.is', true);
check('address cap: the fourth is 429 without a call', $status($r) === 429 && $GLOBALS['calls'] === []);
$GLOBALS['transients'] = [];
for ($i = 0; $i < MOS_NEWSLETTER_IP_HOURLY_CAP; $i++) { $r = signup("a$i@b.is", true); }
check('caller cap: the last allowed one passes', $status($r) === 200);
$r = signup('one-more@b.is', true);
check('caller cap: the next is 429 without a call', $status($r) === 429 && $GLOBALS['calls'] === []);
$GLOBALS['transients'] = [];
$GLOBALS['mc']['key'] = '';
for ($i = 0; $i < 5; $i++) { signup('same@b.is', true); }
$GLOBALS['mc']['key'] = 'abc123secretkey-us21';
check('refusals (not configured) cost no slot', $status(signup('same@b.is', true)) === 200);

unlink($log);
printf("%d passed, %d failed\n", $pass, $fail);
exit($fail ? 1 : 0);
