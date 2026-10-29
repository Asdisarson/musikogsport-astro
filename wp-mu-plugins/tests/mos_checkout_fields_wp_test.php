<?php
/**
 * WordPress-level test for ../mos-checkout-fields.php:
 *  - the Kennitala / gift-receipt fields are saved, and cleared again when the shopper clears or unticks them on a
 *    reused order (MU-03), but never touched by a request that doesn't send them;
 *  - the checkout attempt id is stored on the order (LM-01) and the WC REST orders collection can be filtered by it.
 *
 * Read-only: every order is an unsaved in-memory WC_Order (meta is set in memory, never saved), the requests are
 * in-memory WP_REST_Requests, and the REST query filter is called directly. No gateway code runs.
 * Run (local site): wpms eval-file wp-mu-plugins/tests/mos_checkout_fields_wp_test.php   (prints PASS/FAIL lines)
 */

if (!defined('ABSPATH')) { exit; } // wp eval-file only; never over HTTP

use Automattic\WooCommerce\StoreApi\Exceptions\RouteException;

$fail = 0;
$check = static function (string $name, bool $ok, string $detail = '') use (&$fail) {
    if (!$ok) { $fail++; }
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " $detail" : '') . "\n";
};

$check('plugin loaded', function_exists('mos_checkout_fields_apply') && function_exists('mos_checkout_attempt_query'));
if (!function_exists('mos_checkout_fields_apply')) { echo "1 FAILED\n"; return; }

/**
 * A Store API checkout request as WordPress hands it to the hook: `$raw` is the JSON body the client sent; the
 * `extensions` param is what the Store API's schema sanitizing leaves (every registered key present, null when the
 * client didn't send it).
 */
$request = static function (array $raw): WP_REST_Request {
    $r = new WP_REST_Request('POST', '/wc/store/v1/checkout');
    $r->set_header('content-type', 'application/json');
    $r->set_body((string) wp_json_encode($raw));
    $mos = $raw['extensions']['mos'] ?? [];
    $r->set_param('extensions', ['mos' => [
        'kennitala'  => $mos['kennitala'] ?? null,
        'skiptimidi' => $mos['skiptimidi'] ?? null,
        'attempt'    => $mos['attempt'] ?? null,
    ]]);
    return $r;
};
$order_with = static function (array $meta = []): WC_Order {
    $o = new WC_Order();
    foreach ($meta as $k => $v) { $o->update_meta_data($k, $v); }
    return $o;
};
$attempt = '0123456789abcdef0123456789abcdef';

// --- set ---
$o = $order_with();
mos_checkout_fields_apply($o, $request(['extensions' => ['mos' => ['kennitala' => '010203-2390', 'skiptimidi' => true, 'attempt' => $attempt]]]));
$check('kennitala saved as digits', $o->get_meta('_billing_ssn') === '0102032390', (string) $o->get_meta('_billing_ssn'));
$check('gift receipt saved', $o->get_meta('skiptimidi') === '1');
$check('attempt id saved (LM-01)', $o->get_meta('_mos_checkout_attempt') === $attempt);

// --- MU-03: cleared on a reused order ---
$o = $order_with(['_billing_ssn' => '0102032390', 'skiptimidi' => '1']);
mos_checkout_fields_apply($o, $request(['extensions' => ['mos' => ['kennitala' => null, 'skiptimidi' => false]]]));
$check('MU-03: cleared kennitala (null) removes _billing_ssn', $o->get_meta('_billing_ssn') === '');
$check('MU-03: unticked gift receipt removes skiptimidi', $o->get_meta('skiptimidi') === '');

$o = $order_with(['_billing_ssn' => '0102032390']);
mos_checkout_fields_apply($o, $request(['extensions' => ['mos' => ['kennitala' => '', 'skiptimidi' => false]]]));
$check('MU-03: empty kennitala removes _billing_ssn', $o->get_meta('_billing_ssn') === '');

$o = $order_with(['_billing_ssn' => '0102032390']);
mos_checkout_fields_apply($o, $request(['extensions' => ['mos' => ['kennitala' => '1111112222', 'skiptimidi' => false]]]));
$check('MU-03: a changed kennitala replaces the old one', $o->get_meta('_billing_ssn') === '1111112222');

// --- MU-03: a request that doesn't send the fields leaves them alone ---
$o = $order_with(['_billing_ssn' => '0102032390', 'skiptimidi' => '1', '_mos_checkout_attempt' => $attempt]);
mos_checkout_fields_apply($o, $request([]));
$check('no extensions sent: meta untouched', $o->get_meta('_billing_ssn') === '0102032390' && $o->get_meta('skiptimidi') === '1');
$o = $order_with(['_billing_ssn' => '0102032390', 'skiptimidi' => '1']);
mos_checkout_fields_apply($o, $request(['extensions' => ['other' => ['a' => 1]]]));
$check('another namespace only: meta untouched', $o->get_meta('_billing_ssn') === '0102032390' && $o->get_meta('skiptimidi') === '1');
$o = $order_with(['_billing_ssn' => '0102032390', 'skiptimidi' => '1']);
mos_checkout_fields_apply($o, $request(['extensions' => ['mos' => ['skiptimidi' => true]]]));
$check('kennitala not sent: _billing_ssn untouched', $o->get_meta('_billing_ssn') === '0102032390');
$o = $order_with(['_billing_ssn' => '0102032390', 'skiptimidi' => '1']);
mos_checkout_fields_apply($o, $request(['extensions' => ['mos' => ['kennitala' => '0102032390']]]));
$check('gift receipt not sent: skiptimidi untouched', $o->get_meta('skiptimidi') === '1');

// --- validation is unchanged ---
$o = $order_with(['_billing_ssn' => '0102032390']);
$threw = false;
try {
    mos_checkout_fields_apply($o, $request(['extensions' => ['mos' => ['kennitala' => '12345', 'skiptimidi' => false]]]));
} catch (RouteException $e) {
    $threw = $e->getErrorCode() === 'mos_invalid_kennitala' && $e->getCode() === 400;
}
$check('a kennitala of the wrong length is refused (400)', $threw);
$check('a refused kennitala leaves the old one', $o->get_meta('_billing_ssn') === '0102032390');

// --- attempt id ---
$o = $order_with(['_mos_checkout_attempt' => $attempt]);
mos_checkout_fields_apply($o, $request(['extensions' => ['mos' => ['kennitala' => null, 'skiptimidi' => false, 'attempt' => 'NOT-HEX']]]));
$check('a malformed attempt id is ignored', $o->get_meta('_mos_checkout_attempt') === $attempt);
$o = $order_with(['_mos_checkout_attempt' => $attempt]);
$next = 'ffffffffffffffffffffffffffffffff';
mos_checkout_fields_apply($o, $request(['extensions' => ['mos' => ['kennitala' => null, 'skiptimidi' => false, 'attempt' => $next]]]));
$check('a retry on the same order records its own attempt', $o->get_meta('_mos_checkout_attempt') === $next);

// --- schema: the attempt is declared (an undeclared key would be dropped by the Store API's sanitizing) ---
$schema = Automattic\WooCommerce\StoreApi\StoreApi::container()->get(Automattic\WooCommerce\StoreApi\Schemas\ExtendSchema::class)
    ->get_endpoint_schema(Automattic\WooCommerce\StoreApi\Schemas\V1\CheckoutSchema::IDENTIFIER);
$props = $schema->mos['properties'] ?? [];
$check('schema declares kennitala, skiptimidi, attempt', isset($props['kennitala'], $props['skiptimidi'], $props['attempt']), implode(',', array_keys($props)));

// --- REST orders collection filter (LM-01 lookup) ---
$q = static function (array $params): array {
    $r = new WP_REST_Request('GET', '/wc/v3/orders');
    foreach ($params as $k => $v) { $r->set_param($k, $v); }
    return (array) apply_filters('woocommerce_rest_orders_prepare_object_query', ['post_type' => 'shop_order'], $r);
};
$args = $q(['mos_attempt' => $attempt]);
$mq = $args['meta_query'] ?? [];
$check('mos_attempt adds an exact meta query', is_array($mq) && in_array(['key' => '_mos_checkout_attempt', 'value' => $attempt, 'compare' => '='], $mq, true), wp_json_encode($mq));
$args = $q(['mos_attempt' => "x' OR 1=1"]);
$check('a malformed mos_attempt matches nothing', in_array(['key' => '_mos_checkout_attempt', 'value' => '__no_such_attempt__', 'compare' => '='], (array) ($args['meta_query'] ?? []), true));
$args = $q([]);
$check('no mos_attempt: query untouched', $args === ['post_type' => 'shop_order']);

// --- the same filter through a real REST dispatch (read-only GETs, an in-memory admin user) ---
$saved_user = get_current_user_id();
$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
if ($admins) {
    wp_set_current_user((int) $admins[0]);
    $get = static function (array $params): WP_REST_Response {
        $r = new WP_REST_Request('GET', '/wc/v3/orders');
        foreach ($params as $k => $v) { $r->set_param($k, $v); }
        return rest_do_request($r);
    };
    $all = $get(['per_page' => 1, '_fields' => 'id']);
    $none = $get(['per_page' => 5, '_fields' => 'id', 'mos_attempt' => bin2hex(random_bytes(16))]);
    $check('REST: the unfiltered collection lists orders', $all->get_status() === 200 && count((array) $all->get_data()) === 1);
    $check('REST: an unknown attempt id lists none (the filter narrows the real query)', $none->get_status() === 200 && (array) $none->get_data() === [], (string) $none->get_status());
    wp_set_current_user($saved_user);
} else {
    $check('REST: an administrator to dispatch as', false);
}

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
