<?php
/**
 * Plugin Name: MOS Newsletter
 * Description: `POST mos/v1/newsletter {email}` adds an address to the store's Mailchimp audience: the storefront
 *  footer's sign-up. It uses the connection the Mailchimp for WooCommerce plugin already holds (its API key, its
 *  audience and its double opt-in setting), so there is no second key to keep. Without that plugin, or before it is
 *  connected, the route answers 503 and the footer says the sign-up failed.
 *
 *  Only three of the plugin's functions are used, each checked for: mailchimp_get_api_key(), mailchimp_get_list_id()
 *  and mailchimp_list_has_double_optin(). The Mailchimp call is made here (one PUT on the member), not through the
 *  plugin's API class, whose methods rewrite the status and change between versions.
 *
 *  A new address is added as pending (Mailchimp mails a confirmation) when the audience has double opt-in, else as
 *  subscribed. An address already on the list is left as it is. One that left the list (unsubscribed, cleaned,
 *  archived) is set to pending: Mailchimp only takes such an address back after it confirms by mail. The answer is
 *  the same in all three cases (also when that last step fails: it is logged), so the route does not tell who is on
 *  the list; `confirm` in it is the audience's double opt-in setting.
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

// Per clock hour, like mos/v1/contact: requests come from the storefront server (which limits each visitor itself and
// forwards no visitor IP), so the per-caller cap is what real visitors share and the store-wide cap bounds callers
// that rotate addresses. Each confirmation mail goes to the address given, so the caps also bound mail to strangers.
const MOS_NEWSLETTER_ADDRESS_CAP   = 3;     // per caller and address, per hour
const MOS_NEWSLETTER_IP_HOURLY_CAP = 30;    // as mos/v1/contact
const MOS_NEWSLETTER_HOURLY_CAP    = 60;
const MOS_NEWSLETTER_FAILED = 'Ekki tókst að skrá netfangið. Reyndu aftur síðar.';

/* ------------------------------------------------------------------------
 * 1. Pure helpers (tests/mos_newsletter_test.php).
 * --------------------------------------------------------------------- */

/** The data centre a Mailchimp API key belongs to ("…-us21" → "us21"), or null when the key names none. */
function mos_newsletter_datacenter(string $key): ?string {
    return preg_match('/-([a-z]{2,4}\d{1,3})\z/', $key, $m) ? $m[1] : null;
}

/** The audience member an address is (Mailchimp keys members by the MD5 of the lower-cased address). */
function mos_newsletter_member_url(string $datacenter, string $list, string $email): string {
    return "https://$datacenter.api.mailchimp.com/3.0/lists/" . rawurlencode($list) . '/members/' . md5(strtolower(trim($email)));
}

/** What a member's status after the first PUT calls for: nothing, or asking a member who left to confirm again. */
function mos_newsletter_next_step(string $status): string {
    return in_array($status, ['unsubscribed', 'cleaned', 'archived'], true) ? 'resubscribe' : 'done';
}

/* ------------------------------------------------------------------------
 * 2. The Mailchimp connection and the call.
 * --------------------------------------------------------------------- */

/** @return array{key:string,datacenter:string,list:string,double:bool}|null null: no usable Mailchimp connection */
function mos_newsletter_connection(): ?array {
    if (!function_exists('mailchimp_get_api_key') || !function_exists('mailchimp_get_list_id')) { return null; }
    $key = (string) mailchimp_get_api_key();
    $list = (string) mailchimp_get_list_id();
    $datacenter = mos_newsletter_datacenter($key);
    if ($list === '' || $datacenter === null) { return null; }
    // Without the plugin's answer, ask for confirmation: the safe side of consent.
    $double = function_exists('mailchimp_list_has_double_optin') ? (bool) mailchimp_list_has_double_optin() : true;
    return ['key' => $key, 'datacenter' => $datacenter, 'list' => $list, 'double' => $double];
}

/**
 * PUT the member. @return array{code:int,status:string,title:string} code 0: the request itself failed (title says why)
 */
function mos_newsletter_put(array $conn, string $email, array $fields): array {
    $res = wp_remote_request(mos_newsletter_member_url($conn['datacenter'], $conn['list'], $email), [
        'method'  => 'PUT',
        'timeout' => 10,
        'headers' => ['Authorization' => 'Basic ' . base64_encode('mos:' . $conn['key']), 'Content-Type' => 'application/json'],
        'body'    => wp_json_encode(['email_address' => $email] + $fields),
    ]);
    if (is_wp_error($res)) { return ['code' => 0, 'status' => '', 'title' => $res->get_error_message()]; }
    $data = json_decode(wp_remote_retrieve_body($res), true);
    $data = is_array($data) ? $data : [];
    return ['code' => (int) wp_remote_retrieve_response_code($res), 'status' => (string) ($data['status'] ?? ''), 'title' => (string) ($data['title'] ?? '')];
}

/** One line for the server log: Mailchimp's status and error title, never the key or the address. */
function mos_newsletter_log(string $step, array $answer): void {
    error_log(sprintf('[mos-newsletter] %s failed: %s %s', $step, $answer['code'] === 0 ? 'no answer:' : "HTTP {$answer['code']}", $answer['title']));
}

/* ------------------------------------------------------------------------
 * 3. REST: POST mos/v1/newsletter
 * --------------------------------------------------------------------- */

add_action('rest_api_init', static function (): void {
    register_rest_route('mos/v1', '/newsletter', [
        'methods'             => 'POST',
        'permission_callback' => '__return_true',
        'args'                => ['email' => ['type' => 'string']],   // typed: an array is a 400 from REST
        'callback'            => 'mos_newsletter_rest',
    ]);
});

/** @return WP_REST_Response|WP_Error */
function mos_newsletter_rest(WP_REST_Request $req) {
    $given = trim((string) $req->get_param('email'));
    $email = sanitize_email($given);
    // sanitize_email() drops characters it does not allow ("jón@x.is" → "jn@x.is"): that is someone else's address.
    if ($email === '' || $email !== $given || !is_email($email)) {
        return new WP_Error('mos_newsletter_email', 'Netfangið er ekki gilt.', ['status' => 400]);
    }
    $conn = mos_newsletter_connection();
    if ($conn === null) {
        return new WP_Error('mos_newsletter_not_configured', MOS_NEWSLETTER_FAILED, ['status' => 503]);
    }

    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $hour = intdiv(time(), HOUR_IN_SECONDS);
    $caps = [
        'mos_rl_news_' . md5($ip . '|' . strtolower($email)) . '_' . $hour => MOS_NEWSLETTER_ADDRESS_CAP,
        'mos_rl_news_ip_' . md5($ip) . '_' . $hour                         => MOS_NEWSLETTER_IP_HOURLY_CAP,
        'mos_rl_news_all_' . $hour                                         => MOS_NEWSLETTER_HOURLY_CAP,
    ];
    foreach ($caps as $key => $cap) {
        if ((int) get_transient($key) >= $cap) {
            return new WP_Error('mos_rate_limited', 'Of margar skráningar. Reyndu aftur síðar.', ['status' => 429]);
        }
    }
    foreach ($caps as $key => $cap) { set_transient($key, (int) get_transient($key) + 1, HOUR_IN_SECONDS); }

    $answer = mos_newsletter_put($conn, $email, ['status_if_new' => $conn['double'] ? 'pending' : 'subscribed']);
    if ($answer['code'] === 400) {
        // Mailchimp will not take this address (fake-looking, or permanently removed): the visitor's to fix.
        mos_newsletter_log('sign-up', $answer);
        return new WP_Error('mos_newsletter_refused', 'Ekki tókst að skrá þetta netfang.', ['status' => 400]);
    }
    if ($answer['code'] < 200 || $answer['code'] >= 300) {
        mos_newsletter_log('sign-up', $answer);
        return new WP_Error('mos_newsletter_upstream', MOS_NEWSLETTER_FAILED, ['status' => 502]);
    }
    if (mos_newsletter_next_step($answer['status']) === 'resubscribe') {
        // Logged, not answered: a failure here would tell the caller this address used to be on the list.
        $again = mos_newsletter_put($conn, $email, ['status' => 'pending']);
        if ($again['code'] < 200 || $again['code'] >= 300) { mos_newsletter_log('re-subscribe', $again); }
    }
    // `confirm` is the audience's setting, the same for every address: whether to tell the visitor to look for a mail.
    return new WP_REST_Response(['ok' => true, 'confirm' => $conn['double']], 200);
}
