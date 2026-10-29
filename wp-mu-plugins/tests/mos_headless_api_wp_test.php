<?php
/**
 * WordPress-level test for ../mos-headless-api.php: user enumeration is closed for the public and for signed-in
 * customers while users/me (the storefront's identity check) and admins keep working; author query vars, oEmbed
 * and feed authors; the contact route's typed args; the page route's `modified`; the `mos_and_cat` cap and reset;
 * and the Reply-To header as wp_mail itself parses it.
 *
 * Read-only: REST requests are internal GETs (or a POST that REST rejects before the callback runs), the current
 * user is switched in memory only, and the wp_mail check aborts inside phpmailer_init, before anything is sent.
 * Run (local site): wpms eval-file wp-mu-plugins/tests/mos_headless_api_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};
$get = static function (string $route, array $params = []) {
    $request = new WP_REST_Request('GET', $route);
    foreach ($params as $k => $v) { $request->set_param($k, $v); }
    return rest_do_request($request);
};
$first_id = static function (string $role): int {
    $users = get_users(['role' => $role, 'number' => 1, 'fields' => ['ID']]);
    return $users ? (int) $users[0]->ID : 0;
};
$admin_id = $first_id('administrator');
$customer_id = $first_id('customer');
$check('fixtures: an administrator and a customer exist', $admin_id > 0 && $customer_id > 0, "admin=$admin_id customer=$customer_id");
$before_user = get_current_user_id();

// --- MU-02: REST users routes ------------------------------------------------------------------------------
wp_set_current_user(0);
$check('public: /wp/v2/users is 404', $get('/wp/v2/users')->get_status() === 404);
$check('public: /wp/v2/USERS is 404 (case)', $get('/wp/v2/USERS')->get_status() === 404);
$check('public: /wp/v2/users/<id> is 404', $get('/wp/v2/users/' . $admin_id)->get_status() === 404);
$check('public: users/me still answers 401 (not 404)', $get('/wp/v2/users/me')->get_status() === 401);
$check('public: index lists no users route', !isset(rest_get_server()->get_routes()['/wp/v2/users']));

wp_set_current_user($customer_id);
$check('customer: /wp/v2/users is 404', $get('/wp/v2/users')->get_status() === 404);
$check('customer: /wp/v2/users/<admin> is 404', $get('/wp/v2/users/' . $admin_id)->get_status() === 404);
$me = $get('/wp/v2/users/me', ['context' => 'edit', '_fields' => 'id,name,email']);
$me_data = $me->get_data();
$check('customer: users/me?context=edit is 200 with their id (storefront sign-in path)',
    $me->get_status() === 200 && (int) ($me_data['id'] ?? 0) === $customer_id && isset($me_data['email']), (string) $me->get_status());

wp_set_current_user($admin_id);
$list = $get('/wp/v2/users', ['per_page' => 1]);
$check('admin: /wp/v2/users is 200', $list->get_status() === 200);
$check('admin: /wp/v2/users/<id> is 200', $get('/wp/v2/users/' . $customer_id)->get_status() === 200);

// --- MU-02: author archives, oEmbed, feed author ----------------------------------------------------------
wp_set_current_user(0);
$check('public: ?author= -> 404 query', apply_filters('request', ['author' => (string) $admin_id]) === ['error' => '404']);
$check('public: /author/<slug>/ -> 404 query', apply_filters('request', ['author_name' => 'x']) === ['error' => '404']);
$check('public: other queries untouched', apply_filters('request', ['pagename' => 'forsida']) === ['pagename' => 'forsida']);
wp_set_current_user($admin_id);
$check('admin: author query kept', apply_filters('request', ['author' => '2']) === ['author' => '2']);
wp_set_current_user(0);

$front = get_post((int) get_option('page_on_front'));
$embed = $front ? get_oembed_response_data($front, 600) : false;
$check('oEmbed data has no author fields', is_array($embed) && !isset($embed['author_name']) && !isset($embed['author_url']) && isset($embed['title']), json_encode(is_array($embed) ? array_keys($embed) : $embed));

global $wp_query;
$saved_query = $wp_query;
$wp_query = new WP_Query(['feed' => 'rss2', 'post_type' => 'product', 'posts_per_page' => 1]);
$check('feed author is the shop name', apply_filters('the_author', 'MSportAdmin') === get_bloginfo('name'));
$wp_query = new WP_Query(['post_type' => 'product', 'posts_per_page' => 1]);
$check('outside feeds the author name is untouched', apply_filters('the_author', 'MSportAdmin') === 'MSportAdmin');
$wp_query = $saved_query;

// --- MU-10: contact args are typed (REST answers 400 before the callback: no post, no mail, no rate slot) ---
$post = new WP_REST_Request('POST', '/mos/v1/contact');
$post->set_body_params(['name' => ['x'], 'email' => 'a@example.is', 'topic' => 'almenn-fyrirspurn', 'message' => 'hi']);
$res = rest_do_request($post);
$check('contact: array field is a 400 rest_invalid_param', $res->get_status() === 400 && ($res->get_data()['code'] ?? '') === 'rest_invalid_param', json_encode($res->get_data()));

// --- MU-13: page modified carries its offset ----------------------------------------------------------------
$page = $get('/mos/v1/page/cart');
$modified = (string) ($page->get_data()['modified'] ?? '');
$check('page: modified is ISO 8601 with an offset', $page->get_status() === 200 && (bool) preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/', $modified), $modified);

// --- MU-16: mos_and_cat is capped and reset after the request -----------------------------------------------
$seen = null;
$spy = static function () use (&$seen) { $seen = $GLOBALS['mos_and_cat'] ?? null; };
add_action('pre_get_posts', $spy, 999);
$products = $get('/wc/store/v1/products', ['mos_and_cat' => implode(',', range(1, 500)), 'per_page' => 1]);
remove_action('pre_get_posts', $spy, 999);
$check('and_cat: request answered', $products->get_status() === 200, (string) $products->get_status());
$check('and_cat: at most 20 ids reach the query', is_array($seen) && count($seen) === 20, json_encode(is_array($seen) ? count($seen) : $seen));
$check('and_cat: global reset after the request', ($GLOBALS['mos_and_cat'] ?? null) === []);

// --- MU-04: the Reply-To header reaches the mailer as one address (aborted before sending) -------------------
// Core wp_mail splits Reply-To on commas into addReplyTo() calls; the Disable Emails plugin (local) replaces wp_mail
// with a mock that passes Reply-To through as a custom header instead. Either way: one address, the sender's.
$captured = null;
$abort = static function ($phpmailer) use (&$captured) {
    $reply = array_values(array_map(static fn ($r) => $r[0], $phpmailer->getReplyToAddresses()));
    $custom = array_values(array_filter(array_map(static fn ($h) => strcasecmp((string) $h[0], 'Reply-To') === 0 ? trim((string) $h[1]) : null, $phpmailer->getCustomHeaders())));
    $captured = ['reply_to' => $reply, 'custom' => $custom];
    throw new RuntimeException('mos-test: abort before send');
};
add_action('phpmailer_init', $abort, PHP_INT_MAX);
try {
    wp_mail('nobody@example.invalid', 'test', 'test', [mos_contact_reply_to('x, victim@example.com <attacker@evil.example>', 'me@example.is')]);
} catch (RuntimeException $e) {
    // expected: nothing was sent
}
remove_action('phpmailer_init', $abort, PHP_INT_MAX);
$one_parsed = ($captured['reply_to'] ?? null) === ['me@example.is'];
$custom = $captured['custom'] ?? [];
$one_raw = ($captured['reply_to'] ?? null) === [] && count($custom) === 1 && strpos($custom[0], ',') === false
    && substr_count($custom[0], '@') === 1 && substr($custom[0], -strlen('<me@example.is>')) === '<me@example.is>';
$check('wp_mail: one Reply-To address, the sender', $one_parsed || $one_raw, json_encode($captured, JSON_UNESCAPED_UNICODE));

wp_set_current_user($before_user);
echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
