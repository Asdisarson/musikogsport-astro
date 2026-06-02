<?php
/**
 * Plugin Name: MOS Pósturinn Droppoints (headless bridge)
 * Description: Public read-only REST endpoint listing Pósturinn parcel lockers
 *  (postboxes / DPO) and post offices (parcelpoints / DPP) for a postcode, so the
 *  headless Astro storefront can render a pickup-point selector. The plugin's own
 *  list endpoints are nonce/session-locked to its block checkout. Also saves the
 *  chosen parcelpoint to order meta on Store API checkout (the plugin saves only
 *  the postbox there).
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

add_action('rest_api_init', static function () {
    register_rest_route('mos/v1', '/droppoints', [
        'methods'             => 'GET',
        'permission_callback' => '__return_true', // public, read-only
        'args'                => [
            'postcode' => ['required' => true, 'sanitize_callback' => 'sanitize_text_field'],
            'type'     => ['required' => true, 'sanitize_callback' => 'sanitize_text_field'],
        ],
        'callback'            => 'mos_posturinn_droppoints',
    ]);
});

function mos_posturinn_droppoints(WP_REST_Request $req) {
    $postcode = preg_replace('/\D/', '', (string) $req->get_param('postcode'));
    $type     = $req->get_param('type') === 'parcelpoint' ? 'parcelpoint' : 'postbox';

    if (strlen((string) $postcode) !== 3) {
        return new WP_REST_Response(['ok' => false, 'code' => 'bad_postcode', 'items' => []], 400);
    }
    if (!class_exists('POSTIS_API')) {
        return new WP_REST_Response(['ok' => false, 'code' => 'plugin_unavailable', 'items' => []], 503);
    }

    $cache_key = "mos_dp_{$type}_{$postcode}";
    $cached = get_transient($cache_key);
    if (is_array($cached)) {
        return new WP_REST_Response(['ok' => true, 'cached' => true, 'items' => $cached], 200);
    }

    $api   = new POSTIS_API();
    $items = [];

    if ($type === 'postbox') {
        // Individual DPO/DNO lockers near the postcode come from the shipping-calc response
        // (same source the plugin's block checkout filters into the session).
        $resp = $api->calculate_shipping_api_request(['postCode' => $postcode, 'countryCode' => 'IS']);
        if (!is_wp_error($resp) && (int) wp_remote_retrieve_response_code($resp) === 200) {
            $decoded  = json_decode(wp_remote_retrieve_body($resp), true);
            $services = is_array($decoded) && isset($decoded['deliveryServicesAndPrices'])
                ? $decoded['deliveryServicesAndPrices'] : [];
            foreach ($services as $s) {
                $id   = (string) ($s['deliveryServiceId'] ?? '');
                $base = substr($id, 0, 3);
                if ($base === 'DPO' || $base === 'DNO') {
                    $items[] = ['id' => $id, 'name' => (string) ($s['nameLong'] ?? $id)];
                }
            }
        }
    } else {
        // Post offices: global list, sorted by proximity to the postcode (like the plugin).
        $resp = $api->parcelpoints_api_request();
        if (!is_wp_error($resp) && (int) wp_remote_retrieve_response_code($resp) === 200) {
            $decoded = json_decode(wp_remote_retrieve_body($resp), true);
            $points  = is_array($decoded) && isset($decoded['parcelPoints']) ? $decoded['parcelPoints'] : [];
            $pc = (int) $postcode;
            usort($points, static function ($a, $b) use ($pc) {
                return abs($pc - (int) ($a['postcode'] ?? 0)) - abs($pc - (int) ($b['postcode'] ?? 0));
            });
            foreach ($points as $p) {
                $name = (string) ($p['name'] ?? '');
                if ($name === '') { continue; }
                // Saved value must be the name (matches the plugin's postis_dpt_parcelpoints field).
                $label = !empty($p['postcode']) ? $name . ' · ' . $p['postcode'] : $name;
                $items[] = ['id' => $name, 'name' => $label];
            }
        }
    }

    // Cache successes for an hour; also cache empties briefly so a public caller
    // iterating invalid postcodes can't amplify uncached hits against Iceland Post's API.
    set_transient($cache_key, $items, empty($items) ? 5 * MINUTE_IN_SECONDS : HOUR_IN_SECONDS);

    return new WP_REST_Response(['ok' => true, 'items' => $items], 200);
}

// NOTE: only the POSTBOX (DPO) method exposes a chooser in this store; its chosen
// value (postis_dpo_postbox) is already persisted by the Pósturinn plugin's own
// Store-API hook. The "Afhent á pósthúsi" (DPP) method auto-resolves the nearest
// post office by postcode (no selection), and the plugin's parcelpoint selector
// only triggers for a 'DPT' method, which this store does not offer — so no extra
// order-path save hook is needed here. (The parcelpoint listing above stays
// available read-only in case a DPT method is enabled later.)
