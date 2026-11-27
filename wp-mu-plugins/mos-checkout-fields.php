<?php
/**
 * Plugin Name: MOS Checkout Fields
 * Description: Live's extra checkout fields for the headless checkout — "Kennitala" and "Viltu
 *  skiptimiða?" — sent through the Store API as `extensions.mos` and saved under the order meta keys
 *  live's Checkout Field Editor uses (`_billing_ssn`, `skiptimidi`), so accounting and admin read them
 *  exactly as before. Also stores the storefront's checkout attempt id (`_mos_checkout_attempt`) and lets the
 *  WC REST orders collection find an order by it, so an order placed after the storefront lost WooCommerce's
 *  answer can be found again (the storefront's lib/checkoutRecovery.ts).
 * Author: Músík og Sport
 * Version: 1.1.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

use Automattic\WooCommerce\StoreApi\Exceptions\RouteException;
use Automattic\WooCommerce\StoreApi\Schemas\V1\CheckoutSchema;

/** A checkout attempt id: 128 random bits as lowercase hex (the storefront's lib/attemptId.ts). */
const MOS_CHECKOUT_ATTEMPT_PATTERN = '/^[0-9a-f]{32}$/';
const MOS_CHECKOUT_ATTEMPT_META = '_mos_checkout_attempt';

add_action('woocommerce_blocks_loaded', static function (): void {
    if (!function_exists('woocommerce_store_api_register_endpoint_data')) {
        return;
    }
    woocommerce_store_api_register_endpoint_data([
        'endpoint'        => CheckoutSchema::IDENTIFIER,
        'namespace'       => 'mos',
        'schema_callback' => static fn (): array => [
            'kennitala'  => [
                'description' => 'Kennitala (optional, 10 digits).',
                'type'        => ['string', 'null'],
                'context'     => ['view', 'edit'],
            ],
            'skiptimidi' => [
                'description' => 'Gift receipt requested.',
                'type'        => ['boolean', 'null'],
                'context'     => ['view', 'edit'],
            ],
            // Validated in mos_checkout_fields_apply (a malformed id is ignored, never a refused order).
            'attempt'    => [
                'description' => 'The storefront checkout attempt id (32 hex characters).',
                'type'        => ['string', 'null'],
                'context'     => ['view', 'edit'],
            ],
        ],
    ]);
});

/**
 * The `extensions.mos` keys the client actually sent. The Store API's schema sanitizing fills every registered key
 * (null when absent), so presence is read from the raw JSON body: a request without a field never clears it.
 */
function mos_checkout_fields_sent(WP_REST_Request $request): array {
    $raw = json_decode((string) $request->get_body(), true);
    $mos = is_array($raw) && isset($raw['extensions']) && is_array($raw['extensions']) ? ($raw['extensions']['mos'] ?? null) : null;
    return is_array($mos) ? $mos : [];
}

/**
 * Save the extra fields on the order being placed (the Store API reuses the session's pending order on a retry).
 * A field the shopper cleared or unticked is removed again (MU-03), so a retry never keeps an earlier kennitala or
 * gift-receipt flag; a field the request doesn't send is left as it is.
 */
function mos_checkout_fields_apply($order, $request): void {
    $data = $request['extensions']['mos'] ?? [];
    if (!is_array($data) || !$order instanceof WC_Order || !$request instanceof WP_REST_Request) {
        return;
    }
    $sent = mos_checkout_fields_sent($request);

    $national_id = preg_replace('/\D/', '', (string) ($data['kennitala'] ?? ''));
    if ($national_id !== '') {
        if (strlen($national_id) !== 10) {
            throw new RouteException('mos_invalid_kennitala', 'Kennitala á að vera 10 tölustafir.', 400);
        }
        $order->update_meta_data('_billing_ssn', $national_id);
    } elseif (array_key_exists('kennitala', $sent)) {
        $order->delete_meta_data('_billing_ssn');
    }

    if (!empty($data['skiptimidi'])) {
        $order->update_meta_data('skiptimidi', '1');
    } elseif (array_key_exists('skiptimidi', $sent)) {
        $order->delete_meta_data('skiptimidi');
    }

    $attempt = $data['attempt'] ?? null;
    if (is_string($attempt) && preg_match(MOS_CHECKOUT_ATTEMPT_PATTERN, $attempt)) {
        $order->update_meta_data(MOS_CHECKOUT_ATTEMPT_META, $attempt);
    }
}
add_action('woocommerce_store_api_checkout_update_order_from_request', 'mos_checkout_fields_apply', 10, 2);

/**
 * `GET /wc/v3/orders?mos_attempt=<id>` (authenticated REST, read permission on orders): only the order that carries
 * this attempt id. A malformed id matches nothing. Every other orders request is untouched.
 */
function mos_checkout_attempt_query($args, $request) {
    if (!is_array($args) || !$request instanceof WP_REST_Request) {
        return $args;
    }
    $attempt = $request->get_param('mos_attempt');
    if ($attempt === null || $attempt === '') {
        return $args;
    }
    $value = is_string($attempt) && preg_match(MOS_CHECKOUT_ATTEMPT_PATTERN, $attempt) ? $attempt : '__no_such_attempt__';
    $meta_query = isset($args['meta_query']) && is_array($args['meta_query']) ? $args['meta_query'] : []; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
    $meta_query[] = ['key' => MOS_CHECKOUT_ATTEMPT_META, 'value' => $value, 'compare' => '='];
    $args['meta_query'] = $meta_query; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
    return $args;
}
add_filter('woocommerce_rest_orders_prepare_object_query', 'mos_checkout_attempt_query', 10, 2);
