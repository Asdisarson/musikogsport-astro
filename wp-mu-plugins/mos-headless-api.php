<?php
/**
 * Plugin Name: MOS Headless API
 * Description: Public read endpoints the Astro storefront needs from WordPress:
 *  - GET /wp-json/mos/v1/menu/location/<primary|topbar|footer>  menu assigned to a location
 *  - GET /wp-json/mos/v1/menu/<id>   nested nav-menu tree with storefront-relative paths
 *  - GET /wp-json/mos/v1/front-page  normalized "Forsíða" content (homepage + site chrome)
 *  - GET /wp-json/mos/v1/page/<slug>  raw content of a published page
 *  - POST /wp-json/mos/v1/contact  contact form (stored as a private post and e-mailed)
 *  - Store API `mos_and_cat=<ids>` on wc/store/v1/products and …/collection-data (an extra AND'ed category clause)
 *  Hides WordPress's user list from the public (REST users routes, ?author= archives, oEmbed author fields),
 *  because user slugs are login names.
 *  Registers the storefront's menu locations so editors assign menus under Appearance → Menus.
 *  Also registers the ACF "Forsíða" field group (fixed slots — ACF free has no repeater),
 *  and makes product permalinks follow the Yoast primary category, as live's
 *  Yoast WooCommerce SEO add-on does.
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_MENU_CACHE_TTL = 10 * MINUTE_IN_SECONDS;
const MOS_BANNER_SLOTS   = 8;
const MOS_PRODUCT_ROWS   = 2;
const MOS_HERO_SLIDES    = 3;
const MOS_MENU_LOCATIONS = [
    'primary' => 'Aðalvalmynd (mega-menu)',
    'topbar'  => 'Efsta lína',
    'footer'  => 'Fótur',
];

add_action('after_setup_theme', static function () {
    register_nav_menus(MOS_MENU_LOCATIONS);
}, 20);

/* ------------------------------------------------------------------------
 * 1. Product permalinks follow the Yoast primary category.
 *    Woo picks the deepest assigned category by default; live's
 *    /verslun/<cat path>/<slug>/ URLs use the primary one instead.
 *    Priority 20: free Yoast hooks this filter at 10 (restore_legacy_permalink_category)
 *    whenever the paid Yoast WooCommerce SEO add-on is absent, as it is locally.
 * --------------------------------------------------------------------- */

add_filter('wc_product_post_type_link_product_cat', static function ($term, $terms, $post) {
    if (!$post instanceof WP_Post) { return $term; }
    $primary = (int) get_post_meta($post->ID, '_yoast_wpseo_primary_product_cat', true);
    if ($primary <= 0) { return $term; }
    foreach ((array) $terms as $candidate) {
        if ($candidate instanceof WP_Term && (int) $candidate->term_id === $primary) {
            return $candidate;
        }
    }
    return $term;
}, 20, 3);

/* ------------------------------------------------------------------------
 * 1b. Store API: an extra AND'ed product_cat clause (`mos_and_cat=<ids>`).
 *     Live's `?kyn=konur` filter is itself a category (children of "Kyn"), so a
 *     page like /voruflokkur/fatnadur/?kyn=konur needs "fatnadur AND konur".
 *     The Store API allows ONE product_cat clause, and category_operator=and
 *     breaks on hierarchical terms (WP expands every child into the AND set,
 *     so the result is empty). This adds a second, independent clause — OR
 *     within its ids, AND with everything else — to every WP_Query the Store
 *     API builds for /products and /products/collection-data.
 * --------------------------------------------------------------------- */

const MOS_AND_CAT_MAX = 20; // the storefront sends the one or two "kyn" ids; the size filter has a cap too

/** `mos_and_cat` as positive term ids, de-duplicated, at most MOS_AND_CAT_MAX. */
function mos_and_cat_ids($raw): array {
    $ids = array_values(array_unique(array_filter(array_map('absint', is_array($raw) ? $raw : explode(',', (string) $raw)))));
    return array_slice($ids, 0, MOS_AND_CAT_MAX);
}

add_filter('rest_request_before_callbacks', static function ($response, $handler, $request) {
    if ($request instanceof WP_REST_Request && strpos($request->get_route(), '/wc/store/v1/products') === 0) {
        $GLOBALS['mos_and_cat'] = mos_and_cat_ids($request->get_param('mos_and_cat'));
    }
    return $response;
}, 10, 3);

// The clause ends with the request, so no later product query in the same process is filtered. Late (1000), so
// mos-size-index.php's count fields (priority 10) still see it.
add_filter('rest_request_after_callbacks', static function ($response, $handler, $request) {
    if ($request instanceof WP_REST_Request && strpos($request->get_route(), '/wc/store/v1/products') === 0) {
        $GLOBALS['mos_and_cat'] = [];
    }
    return $response;
}, 1000, 3);

function mos_and_cat_clause(array $ids): array {
    return [
        'taxonomy'         => 'product_cat',
        'field'            => 'term_id',
        'terms'            => $ids,
        'operator'         => 'IN',
        'include_children' => true,
    ];
}

add_action('pre_get_posts', static function (WP_Query $query) {
    $ids = $GLOBALS['mos_and_cat'] ?? [];
    if (!$ids || !in_array('product', (array) $query->get('post_type'), true)) { return; }
    $tax_query = (array) ($query->get('tax_query') ?: []);
    $tax_query[] = mos_and_cat_clause($ids);
    $query->set('tax_query', $tax_query);
});

// collection-data counts go through Woo's FilterData, which caches results in a transient keyed
// by the query vars alone — our clause isn't in them, so a filtered request would read the
// unfiltered cache entry. Recompute with the clause folded into the query vars: the marker key
// gives it a distinct cache entry and stops this filter recursing.
add_filter('woocommerce_pre_product_filter_data', static function ($pre, $type, $query_vars, $extra) {
    $ids = $GLOBALS['mos_and_cat'] ?? [];
    if ($pre !== null || !$ids || !empty($query_vars['mos_and_cat']) || !function_exists('wc_get_container')) {
        return $pre;
    }
    $query_vars['mos_and_cat'] = $ids;
    $query_vars['tax_query'] = array_merge((array) ($query_vars['tax_query'] ?? []), [mos_and_cat_clause($ids)]);
    $data = wc_get_container()
        ->get(\Automattic\WooCommerce\Internal\ProductFilters\FilterDataProvider::class)
        ->with(new \Automattic\WooCommerce\StoreApi\Utilities\ProductQuery());
    $taxonomy = (string) ($extra['taxonomy'] ?? '');
    switch ($type) {
        case 'taxonomy':  return $data->get_taxonomy_counts($query_vars, $taxonomy);
        case 'attribute': return $data->get_attribute_counts($query_vars, $taxonomy);
        case 'price':     return $data->get_filtered_price($query_vars);
        case 'rating':    return $data->get_rating_counts($query_vars);
        default:          return $pre;
    }
}, 10, 4);

/* ------------------------------------------------------------------------
 * 2. URL helpers — menu/ACF links point at the WP origin; the storefront
 *    wants paths it can route itself.
 * --------------------------------------------------------------------- */

/**
 * @return array{href: string, external: bool}
 */
function mos_storefront_href(string $url): array {
    $url = trim($url);
    if ($url === '' || $url[0] === '#') {
        return ['href' => $url === '' ? '#' : $url, 'external' => false];
    }
    // Menu and ACF links are editor input: only http(s), mailto, tel or relative URLs leave WordPress.
    // The scheme is read the way browsers do (control characters and spaces ignored, so "java\tscript:"
    // counts); esc_url_raw isn't used because it turns a relative "skilmalar/" into "http://skilmalar/".
    // The storefront checks again (src/lib/safeUrl.ts).
    $probe = (string) preg_replace('/[\x00-\x20]+/', '', $url);
    if (preg_match('/^([a-z][a-z0-9+.\-]*):/i', $probe, $m) && !in_array(strtolower($m[1]), ['http', 'https', 'mailto', 'tel'], true)) {
        return ['href' => '#', 'external' => false];
    }
    // Browsers read "\" as "/": "/\evil.example", "\\evil.example" and "\/evil.example" are protocol-relative links
    // to another host that wp_parse_url takes for paths (and "\evil.example" would become "/\evil.example" below).
    if (preg_match('#^(\\\\|/\\\\)#', $probe)) {
        return ['href' => '#', 'external' => false];
    }
    $parts = wp_parse_url($url);
    if (!is_array($parts)) {
        return ['href' => '#', 'external' => false];
    }
    if (empty($parts['host'])) {
        // mailto:/tel: links have a scheme but no host: pass them through. Anything else is relative.
        if (!empty($parts['scheme'])) {
            return ['href' => $url, 'external' => false];
        }
        return ['href' => $url[0] === '/' ? $url : '/' . $url, 'external' => false];
    }
    $home = wp_parse_url(home_url('/'));
    $same = is_array($home)
        && strcasecmp((string) $parts['host'], (string) ($home['host'] ?? '')) === 0
        && (int) ($parts['port'] ?? 0) === (int) ($home['port'] ?? 0);
    if (!$same) {
        return ['href' => $url, 'external' => true];
    }
    // One leading slash: a path of "//evil.example" or "/\evil.example" would be a protocol-relative link off-site.
    $href = '/' . ltrim((string) ($parts['path'] ?? '/'), '/\\')
        . (isset($parts['query']) ? '?' . $parts['query'] : '')
        . (isset($parts['fragment']) ? '#' . $parts['fragment'] : '');
    return ['href' => $href, 'external' => false];
}

function mos_plain_text(string $s): string {
    return trim(html_entity_decode(wp_strip_all_tags($s), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
}

/**
 * Live's free-shipping progress bar (mini cart + cart). Its settings are Goya theme mods; Goya isn't
 * the active theme on the headless backend, so they're read from the child theme's mods option.
 */
function mos_shipping_bar(): ?array {
    $mods = get_option('theme_mods_goya-child');
    if (!is_array($mods) || empty($mods['progress_bar_enable'])) {
        return null;
    }
    $goal = (int) ($mods['progress_bar_goal'] ?? 0);
    if ($goal <= 0) {
        return null;
    }
    return [
        'goal'          => $goal,
        'message'       => wp_kses_post((string) ($mods['progress_bar_msg'] ?? '')),
        'success'       => wp_kses_post((string) ($mods['progress_bar_success_msg'] ?? '')),
        'color'         => sanitize_hex_color((string) ($mods['progress_bar_color'] ?? '')) ?: '#ec652d',
        'locations'     => array_values(array_map('sanitize_key', (array) ($mods['progress_bar_locations'] ?? []))),
        'include_taxes' => !empty($mods['progress_bar_subtotal_taxes']),
    ];
}

/**
 * @return array{url: string, width: int, height: int, alt: string}|null
 */
function mos_image($value): ?array {
    $id = is_array($value) ? (int) ($value['ID'] ?? $value['id'] ?? 0) : (int) $value;
    if ($id <= 0) { return null; }
    $src = wp_get_attachment_image_src($id, 'full');
    if (!$src) { return null; }
    return [
        'url'    => (string) $src[0],
        'width'  => (int) $src[1],
        'height' => (int) $src[2],
        'alt'    => mos_plain_text((string) get_post_meta($id, '_wp_attachment_image_alt', true)),
    ];
}

/* ------------------------------------------------------------------------
 * 3. REST routes
 * --------------------------------------------------------------------- */

add_action('rest_api_init', static function () {
    register_rest_route('mos/v1', '/menu/location/(?P<location>[a-z]+)', [
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => static function (WP_REST_Request $req) {
            $location = (string) $req['location'];
            $menu_id = (int) (get_nav_menu_locations()[$location] ?? 0);
            if (!isset(MOS_MENU_LOCATIONS[$location]) || $menu_id <= 0) {
                return new WP_Error('mos_menu_not_found', 'No menu assigned to this location', ['status' => 404]);
            }
            $req->set_param('id', $menu_id);
            return mos_rest_menu($req);
        },
    ]);
    register_rest_route('mos/v1', '/menu/(?P<id>\d+)', [
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => 'mos_rest_menu',
    ]);
    register_rest_route('mos/v1', '/front-page', [
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => 'mos_rest_front_page',
    ]);
    // Raw content of a published page: WPBakery isn't installed headlessly, so the storefront parses
    // the shortcodes itself (the_content output would mangle their quotes).
    register_rest_route('mos/v1', '/page/(?P<slug>[a-z0-9-]+)', [
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => static function (WP_REST_Request $req) {
            $page = get_page_by_path((string) $req['slug'], OBJECT, 'page');
            if (!$page instanceof WP_Post || $page->post_status !== 'publish' || post_password_required($page)) {
                return new WP_Error('mos_page_not_found', 'Page not found', ['status' => 404]);
            }
            $res = rest_ensure_response([
                'id'       => $page->ID,
                'slug'     => $page->post_name,
                'title'    => mos_plain_text(get_the_title($page)),
                'content'  => (string) $page->post_content,
                'modified' => (string) get_post_modified_time('c', true, $page), // GMT, with its offset
            ]);
            $res->header('Cache-Control', 'public, max-age=60');
            return $res;
        },
    ]);
    register_rest_route('mos/v1', '/contact', [
        'methods'             => 'POST',
        'permission_callback' => '__return_true',
        // Typed, so an array field is a 400 from REST instead of an "Array to string" warning. Presence and
        // content are checked in the callback.
        'args'                => [
            'name'    => ['type' => 'string'],
            'email'   => ['type' => 'string'],
            'topic'   => ['type' => 'string'],
            'message' => ['type' => 'string'],
        ],
        'callback'            => 'mos_rest_contact',
    ]);
});

/* ------------------------------------------------------------------------
 * Contact form (replaces live's Ninja Form "Contact Me"): stored as a private
 * `mos_contact` post and e-mailed to the site admin. Rate limited per IP + sender, per IP, and store-wide.
 * --------------------------------------------------------------------- */

add_action('init', static function () {
    register_post_type('mos_contact', [
        'label'        => 'Fyrirspurnir',
        'public'       => false,
        'show_ui'      => true,
        'show_in_menu' => true,
        'menu_icon'    => 'dashicons-email',
        'supports'     => ['title', 'editor', 'custom-fields'],
        'capability_type' => 'post',
        'map_meta_cap' => true,
    ]);
});

// Per clock hour. The storefront is one address for all its visitors (it limits each visitor itself and forwards no
// visitor IP: a forwarded header would be spoofable here), so the per-IP cap is what real visitors share, and a
// direct caller on another address uses up only its own. The store-wide cap bounds the admin mail from callers
// rotating addresses; the WAF rule in DEPLOY.md (step 8) is the real protection.
const MOS_CONTACT_IP_HOURLY_CAP = 30;
const MOS_CONTACT_HOURLY_CAP    = 60;

const MOS_CONTACT_TOPICS = [
    'vardandi-vefverslun' => 'Varðandi Vefverslun',
    'vardandi-poentun'    => 'Varðandi Pöntun',
    'vardandi-verslun'    => 'Varðandi Verslun',
    'almenn-fyrirspurn'   => 'Almenn Fyrirspurn',
];

function mos_rest_contact(WP_REST_Request $req) {
    $name    = sanitize_text_field((string) $req->get_param('name'));
    $email   = sanitize_email((string) $req->get_param('email'));
    // Keyed on IP + sender: requests arrive from the storefront server (which limits per visitor), so this key
    // separates its visitors by address; the per-IP and store-wide hourly caps below are coarser backstops.
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $rl = 'mos_rl_contact_' . md5($ip . '|' . strtolower($email));
    $hits = (int) get_transient($rl);
    // A direct caller can vary the sender on every request, so each address and the whole endpoint are capped as
    // well. Fixed windows (one key per clock hour), so steady genuine traffic can't keep extending a lockout.
    $hour = intdiv(time(), HOUR_IN_SECONDS);
    $by_ip = 'mos_rl_contact_ip_' . md5($ip) . '_' . $hour;
    $ip_hits = (int) get_transient($by_ip);
    $all = 'mos_rl_contact_all_' . $hour;
    $all_hits = (int) get_transient($all);
    if ($hits >= 5 || $ip_hits >= MOS_CONTACT_IP_HOURLY_CAP || $all_hits >= MOS_CONTACT_HOURLY_CAP) {
        return new WP_Error('mos_rate_limited', 'Of margar fyrirspurnir. Reyndu aftur síðar.', ['status' => 429]);
    }
    $topic   = sanitize_key((string) $req->get_param('topic'));
    $message = sanitize_textarea_field((string) $req->get_param('message'));
    if ($name === '' || !is_email($email) || !isset(MOS_CONTACT_TOPICS[$topic]) || $message === '' || mb_strlen($message) > 5000) {
        return new WP_Error('mos_contact_invalid', 'Vinsamlegast fylltu út alla reiti.', ['status' => 400]);
    }
    set_transient($rl, $hits + 1, 15 * MINUTE_IN_SECONDS);
    set_transient($by_ip, $ip_hits + 1, HOUR_IN_SECONDS);
    set_transient($all, $all_hits + 1, HOUR_IN_SECONDS);

    $topic_label = MOS_CONTACT_TOPICS[$topic];
    $post_id = wp_insert_post([
        'post_type'    => 'mos_contact',
        'post_status'  => 'private',
        'post_title'   => sprintf('%s — %s', $topic_label, $name),
        'post_content' => $message,
        'meta_input'   => ['email' => $email, 'topic' => $topic],
    ], true);
    if (is_wp_error($post_id)) {
        return new WP_Error('mos_contact_failed', 'Ekki tókst að senda fyrirspurnina.', ['status' => 500]);
    }
    wp_mail(
        (string) get_option('admin_email'),
        sprintf('[Músík og Sport] %s', $topic_label),
        "Nafn: {$name}\nNetfang: {$email}\nTegund: {$topic_label}\n\n{$message}",
        [mos_contact_reply_to($name, $email)]
    );
    return rest_ensure_response(['ok' => true]);
}

/**
 * The contact mail's Reply-To header. wp_mail splits a Reply-To value on commas before it reads "Name <address>",
 * so a caller-chosen name like `x, victim@example.com <attacker@evil.example>` would add recipients. RFC 5322
 * specials (dots excepted, for initials), quotes and control characters are removed from the name; PHPMailer quotes
 * what is left itself. An empty result, or a name that isn't valid UTF-8, leaves just the address.
 * `$email` is already sanitize_email()'d (no commas or brackets).
 */
function mos_contact_reply_to(string $name, string $email): string {
    $clean = preg_replace('/[\x00-\x1F\x7F,;:"<>()\[\]\\\\@]+/u', ' ', $name);
    $clean = trim((string) preg_replace('/\s+/u', ' ', (string) $clean));
    return $clean === '' ? 'Reply-To: ' . $email : 'Reply-To: ' . $clean . ' <' . $email . '>';
}

function mos_rest_menu(WP_REST_Request $req) {
    $id = absint($req['id']);
    $cache_key = 'mos_menu_' . $id;
    $tree = get_transient($cache_key);
    if (!is_array($tree)) {
        $items = wp_get_nav_menu_items($id, ['update_post_term_cache' => false]);
        if (!is_array($items)) {
            return new WP_Error('mos_menu_not_found', 'Menu not found', ['status' => 404]);
        }
        $tree = mos_build_menu_tree($items);
        set_transient($cache_key, $tree, MOS_MENU_CACHE_TTL);
    }
    $res = rest_ensure_response(['id' => $id, 'items' => $tree]);
    $res->header('Cache-Control', 'public, max-age=60');
    return $res;
}

/**
 * @param WP_Post[] $items menu items in menu order
 */
function mos_build_menu_tree(array $items): array {
    $nodes = [];
    foreach ($items as $item) {
        $link = mos_storefront_href((string) $item->url);
        $nodes[(int) $item->ID] = [
            'id'       => (int) $item->ID,
            'parent'   => (int) $item->menu_item_parent,
            'title'    => mos_plain_text((string) $item->title),
            'href'     => $link['href'],
            'external' => $link['external'],
            'target'   => (string) $item->target,
            'classes'  => array_values(array_filter(array_map('strval', (array) $item->classes))),
            'children' => [],
        ];
    }
    // Attach children bottom-up so nested references stay intact.
    $roots = [];
    foreach (array_reverse(array_keys($nodes)) as $id) {
        $parent = $nodes[$id]['parent'];
        if ($parent && isset($nodes[$parent])) {
            array_unshift($nodes[$parent]['children'], $nodes[$id]);
        }
    }
    foreach ($nodes as $node) {
        if (!$node['parent'] || !isset($nodes[$node['parent']])) {
            $roots[] = mos_strip_parent($node, $nodes);
        }
    }
    return $roots;
}

function mos_strip_parent(array $node, array $all): array {
    $children = array_map(static fn($c) => mos_strip_parent($all[$c['id']] ?? $c, $all), $node['children']);
    unset($node['parent']);
    $node['children'] = $children;
    return $node;
}

foreach (['wp_update_nav_menu', 'wp_delete_nav_menu', 'wp_update_nav_menu_item'] as $hook) {
    add_action($hook, static function ($menu_id) {
        delete_transient('mos_menu_' . absint($menu_id));
    });
}

function mos_rest_front_page() {
    $page_id = (int) get_option('page_on_front');
    if ($page_id <= 0 || !function_exists('get_field')) {
        return new WP_Error('mos_front_page_unavailable', 'Front page content unavailable', ['status' => 503]);
    }
    $f = static fn(string $name) => get_field($name, $page_id, false);
    $link = static fn($v) => mos_storefront_href((string) $v)['href'];

    $slides = [];
    for ($i = 1; $i <= MOS_HERO_SLIDES; $i++) {
        $slide = mos_hero_slide((int) $f("hero_slide_{$i}_product"), mos_image($f("hero_slide_{$i}_image")));
        if ($slide) { $slides[] = $slide; }
    }

    $buttons = [];
    for ($i = 1; $i <= 2; $i++) {
        $label = trim((string) $f("hero_button_{$i}_label"));
        if ($label !== '') {
            $buttons[] = ['label' => $label, 'href' => $link($f("hero_button_{$i}_link"))];
        }
    }

    $rows = [];
    for ($i = 1; $i <= MOS_PRODUCT_ROWS; $i++) {
        $cat_id = (int) $f("row_{$i}_category");
        $cat = $cat_id ? get_term($cat_id, 'product_cat') : null;
        $rows[] = [
            'title'    => (string) $f("row_{$i}_title"),
            'source'   => (string) ($f("row_{$i}_source") ?: 'newest'),
            'category' => $cat instanceof WP_Term ? ['id' => $cat->term_id, 'slug' => $cat->slug, 'name' => mos_plain_text($cat->name)] : null,
            'count'    => max(1, min(24, (int) ($f("row_{$i}_count") ?: 10))),
        ];
    }

    $banners = [];
    for ($i = 1; $i <= MOS_BANNER_SLOTS; $i++) {
        $image = mos_image($f("banner_{$i}_image"));
        $title = (string) $f("banner_{$i}_title");
        $banners[] = ($image || $title !== '')
            ? ['image' => $image, 'title' => $title, 'href' => $link($f("banner_{$i}_link"))]
            : null;
    }

    $data = [
        'campaign' => [
            'text'       => (string) $f('campaign_text'),
            'text_right' => (string) $f('campaign_text_right'),
            'notice'     => (string) $f('store_notice'),
        ],
        'logos' => [
            'header' => mos_image($f('site_logo')),
            'footer' => mos_image($f('footer_logo')),
        ],
        'hero' => [
            'slides'  => $slides,
            'heading' => (string) $f('hero_heading'),
            'text'    => (string) $f('hero_text'),
            'buttons' => $buttons,
        ],
        'rows'    => $rows,
        'banners' => $banners,
        'shipping_bar' => mos_shipping_bar(),
        'footer'  => [
            'address'          => (string) $f('footer_address'),
            'directions_label' => (string) $f('footer_directions_label'),
            // Editor input like every other link (mos_storefront_href); empty stays empty = no link.
            'directions_href'  => ($dir = trim((string) $f('footer_directions_link'))) === '' ? '' : mos_storefront_href($dir)['href'],
            'email'            => sanitize_email((string) $f('footer_email')),
            'phone'            => (string) $f('footer_phone'),
            'company_line'     => (string) $f('footer_company_line'),
        ],
    ];
    $res = rest_ensure_response($data);
    $res->header('Cache-Control', 'public, max-age=60');
    return $res;
}

/**
 * A hero slide is a product (live's Slider Revolution "dynamic" WooCommerce slider):
 * name, storefront path, prices and image — the image may be overridden per slide.
 */
function mos_hero_slide(int $product_id, ?array $image_override): ?array {
    if ($product_id <= 0 || !function_exists('wc_get_product')) { return null; }
    $product = wc_get_product($product_id);
    if (!$product || $product->get_status() !== 'publish') { return null; }
    return [
        'id'            => $product->get_id(),
        'name'          => mos_plain_text($product->get_name()),
        'href'          => mos_storefront_href((string) get_permalink($product->get_id()))['href'],
        'price'         => (string) $product->get_price(),
        'regular_price' => (string) $product->get_regular_price(),
        'sale_price'    => (string) $product->get_sale_price(),
        'on_sale'       => $product->is_on_sale(),
        'price_html'    => (string) $product->get_price_html(),
        'image'         => $image_override ?: mos_image($product->get_image_id()),
    ];
}

/* ------------------------------------------------------------------------
 * 4. ACF field group "Forsíða" on the static front page.
 * --------------------------------------------------------------------- */

add_action('acf/init', static function () {
    if (!function_exists('acf_add_local_field_group')) { return; }

    $field = static fn(string $name, string $label, string $type, array $extra = []) => array_merge([
        'key' => 'field_mos_' . $name, 'name' => $name, 'label' => $label, 'type' => $type,
    ], $extra);
    $tab = static fn(string $name, string $label) => $field('tab_' . $name, $label, 'tab', ['name' => '']);
    $image = static fn(string $name, string $label) => $field($name, $label, 'image', ['return_format' => 'id', 'preview_size' => 'medium']);

    $fields = [
        $tab('campaign', 'Efsta lína'),
        $field('campaign_text', 'Appelsínugula línan — vinstri', 'text', ['wrapper' => ['width' => 50]]),
        $field('campaign_text_right', 'Appelsínugula línan — hægri', 'text', ['wrapper' => ['width' => 50]]),
        $field('store_notice', 'Grá tilkynning neðst (hægt að loka)', 'text'),
        $image('site_logo', 'Merki í haus'),
        $image('footer_logo', 'Merki í fæti'),

        $tab('hero', 'Forsíðumynd'),
    ];
    for ($i = 1; $i <= MOS_HERO_SLIDES; $i++) {
        $fields[] = $field("hero_slide_{$i}_product", "Glæra {$i} — vara", 'post_object', [
            // Published only: mos_hero_slide() drops a slide whose product isn't.
            'post_type' => ['product'], 'post_status' => ['publish'], 'return_format' => 'id', 'allow_null' => 1, 'ui' => 1, 'wrapper' => ['width' => 50],
        ]);
        $fields[] = $image("hero_slide_{$i}_image", "Glæra {$i} — mynd (valfrjálst, annars vörumynd)");
    }
    array_push($fields,
        $field('hero_heading', 'Fyrirsögn', 'text'),
        $field('hero_text', 'Texti', 'textarea', ['rows' => 2, 'new_lines' => '']),
        $field('hero_button_1_label', 'Hnappur 1 — texti', 'text', ['wrapper' => ['width' => 50]]),
        $field('hero_button_1_link', 'Hnappur 1 — slóð', 'text', ['wrapper' => ['width' => 50]]),
        $field('hero_button_2_label', 'Hnappur 2 — texti', 'text', ['wrapper' => ['width' => 50]]),
        $field('hero_button_2_link', 'Hnappur 2 — slóð', 'text', ['wrapper' => ['width' => 50]]),

        $tab('rows', 'Vörulínur')
    );
    for ($i = 1; $i <= MOS_PRODUCT_ROWS; $i++) {
        $fields[] = $field("row_{$i}_title", "Lína {$i} — fyrirsögn", 'text', ['wrapper' => ['width' => 40]]);
        $fields[] = $field("row_{$i}_source", "Lína {$i} — vörur", 'select', [
            'choices' => ['newest' => 'Nýjustu', 'popular' => 'Vinsælustu', 'on_sale' => 'Á tilboði', 'category' => 'Úr vöruflokki'],
            'default_value' => 'newest', 'wrapper' => ['width' => 20],
        ]);
        $fields[] = $field("row_{$i}_category", "Lína {$i} — vöruflokkur", 'taxonomy', [
            'taxonomy' => 'product_cat', 'field_type' => 'select', 'return_format' => 'id', 'allow_null' => 1,
            'add_term' => 0, 'save_terms' => 0, 'load_terms' => 0, 'wrapper' => ['width' => 25],
        ]);
        $fields[] = $field("row_{$i}_count", "Lína {$i} — fjöldi", 'number', ['default_value' => 10, 'min' => 1, 'max' => 24, 'wrapper' => ['width' => 15]]);
    }

    $fields[] = $tab('banners', 'Borðar');
    // The storefront places them (src/lib/homeLayout.ts): the first with a picture on top, the rest in pairs.
    for ($i = 1; $i <= MOS_BANNER_SLOTS; $i++) {
        $fields[] = $image("banner_{$i}_image", "Borði {$i} — mynd");
        $fields[] = $field("banner_{$i}_title", "Borði {$i} — fyrirsögn", 'text', ['wrapper' => ['width' => 50]]);
        $fields[] = $field("banner_{$i}_link", "Borði {$i} — slóð", 'text', ['wrapper' => ['width' => 50]]);
    }

    $fields[] = $tab('footer', 'Fótur');
    $fields[] = $field('footer_address', 'Heimilisfang', 'textarea', ['rows' => 2, 'new_lines' => '']);
    $fields[] = $field('footer_directions_label', 'Leiðarvísir — texti', 'text', ['wrapper' => ['width' => 50]]);
    $fields[] = $field('footer_directions_link', 'Leiðarvísir — slóð', 'url', ['wrapper' => ['width' => 50]]);
    $fields[] = $field('footer_email', 'Tölvupóstfang', 'email', ['wrapper' => ['width' => 50]]);
    $fields[] = $field('footer_phone', 'Sími', 'text', ['wrapper' => ['width' => 50]]);
    $fields[] = $field('footer_company_line', 'Fyrirtækjalína neðst', 'textarea', ['rows' => 2, 'new_lines' => '']);

    acf_add_local_field_group([
        'key'          => 'group_mos_forsida',
        'title'        => 'Forsíða',
        'fields'       => $fields,
        'location'     => [[['param' => 'page_type', 'operator' => '==', 'value' => 'front_page']]],
        'position'     => 'acf_after_title',
        'style'        => 'default',
        'show_in_rest' => 1,
        'hide_on_screen' => ['the_content'],
    ]);
});

/* ------------------------------------------------------------------------
 * 5. No public user enumeration. User slugs are login names (user_nicename = user_login for every account
 *    probed), so the public user list hands out half of every sign-in.
 *    - Hidden from anyone who can't edit posts: the REST users list and single-user routes, and the
 *      ?author=<id> and /author/<slug>/ archives (404).
 *    - Hidden from everyone: the oEmbed author fields; feed items name the shop as the author (display
 *      names equal the login too).
 *    Kept: /wp/v2/users/me (the storefront's identity check, Bearer token) and the block editor's author
 *    picker (editors have edit_posts). Yoast's "author archives off" setting redirects those archives as
 *    well; this does not depend on it.
 * --------------------------------------------------------------------- */

const MOS_PUBLIC_HIDDEN_USER_ROUTES = ['/wp/v2/users', '/wp/v2/users/(?P<id>[\d]+)'];

/** The REST endpoint map without the users list and single-user routes, unless the caller may see them. */
function mos_hide_user_routes(array $endpoints, bool $allowed): array {
    if ($allowed) { return $endpoints; }
    foreach (MOS_PUBLIC_HIDDEN_USER_ROUTES as $route) { unset($endpoints[$route]); }
    return $endpoints;
}

/** Front-end query vars with an author archive turned into a 404, unless the visitor may see it. */
function mos_block_author_query(array $query_vars, bool $allowed): array {
    if ($allowed || (!isset($query_vars['author']) && !isset($query_vars['author_name']))) { return $query_vars; }
    unset($query_vars['author'], $query_vars['author_name']);
    $query_vars['error'] = '404';
    return $query_vars;
}

/** oEmbed data without the author's name and archive URL (the URL carries the login). */
function mos_oembed_without_author($data) {
    if (is_array($data)) { unset($data['author_name'], $data['author_url']); }
    return $data;
}

// Route matching is case-insensitive, so the routes are removed rather than compared by path (/wp/v2/USERS).
// Late, after core and plugins have registered theirs. Runs when the REST server matches a request, i.e. after
// authentication; an internal _embed of a post's author goes through it as well.
add_filter('rest_endpoints', static function ($endpoints) {
    return is_array($endpoints) ? mos_hide_user_routes($endpoints, current_user_can('edit_posts')) : $endpoints;
}, 99);

// Author vars first: this runs on every parsed request (REST ones too, before REST_REQUEST is defined), and only an
// author query needs the current user.
add_filter('request', static function ($query_vars) {
    if (!is_array($query_vars) || (!isset($query_vars['author']) && !isset($query_vars['author_name'])) || is_admin()) {
        return $query_vars;
    }
    return mos_block_author_query($query_vars, current_user_can('edit_posts'));
});

add_filter('oembed_response_data', 'mos_oembed_without_author', 99);

// Feeds name each item's author (<dc:creator>), and display names here equal the login (MSportAdmin). The shop is
// the author as far as readers are concerned.
add_filter('the_author', static function ($name) {
    return is_feed() ? (string) get_bloginfo('name') : $name;
}, 99);
