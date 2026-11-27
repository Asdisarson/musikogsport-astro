<?php
/**
 * Unit test for the pure helpers in ../mos-headless-api.php (no WordPress needed): the link guard
 * (mos_storefront_href), the contact form's Reply-To header, the `mos_and_cat` id parser, and the
 * user-enumeration guards (REST routes, author query vars, oEmbed author fields).
 *
 * Run: php wp-mu-plugins/tests/mos_headless_api_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
const MINUTE_IN_SECONDS = 60;
const HOUR_IN_SECONDS = 3600;
$GLOBALS['actions'] = [];
function add_action(...$args): void { $GLOBALS['actions'][] = $args[0]; }
function has_action(string $hook, $callback = false) { return in_array($hook, $GLOBALS['actions'], true); }
function add_filter(...$args): void {}
function wp_parse_url(string $url, int $component = -1) { return parse_url($url, $component); }
function home_url(string $path = ''): string { return 'https://wp.example.test' . $path; }
function absint($v): int { return abs((int) $v); }

require __DIR__ . '/../mos-headless-api.php';

$fail = 0;
$pass = 0;
function check(string $name, bool $ok, string $detail = ''): void {
    global $fail, $pass;
    if ($ok) { $pass++; return; }
    $fail++;
    echo "FAIL $name $detail\n";
}

// mos_storefront_href: what already worked keeps working.
$href = static fn (string $u): array => mos_storefront_href($u);
check('relative path kept', $href('/voruflokkur/skor/') === ['href' => '/voruflokkur/skor/', 'external' => false]);
check('slash-less relative gets a slash', $href('skilmalar/') === ['href' => '/skilmalar/', 'external' => false]);
check('fragment kept', $href('#top') === ['href' => '#top', 'external' => false]);
check('empty -> #', $href('') === ['href' => '#', 'external' => false]);
check('same host -> path', $href('https://wp.example.test/brand/hoka/?a=1#x') === ['href' => '/brand/hoka/?a=1#x', 'external' => false]);
check('other host -> external', $href('https://www.instagram.com/musikogsport/') === ['href' => 'https://www.instagram.com/musikogsport/', 'external' => true]);
check('protocol-relative other host -> external', $href('//maps.google.com/x') === ['href' => '//maps.google.com/x', 'external' => true]);
check('mailto kept', $href('mailto:verslun@musikogsport.is') === ['href' => 'mailto:verslun@musikogsport.is', 'external' => false]);
check('tel kept', $href('tel:+3545553110') === ['href' => 'tel:+3545553110', 'external' => false]);
foreach (['javascript:alert(1)', 'java' . "\t" . 'script:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x'] as $bad) {
    check('script scheme -> # ' . json_encode($bad), $href($bad) === ['href' => '#', 'external' => false]);
}

// MU-07: browsers read "\" as "/", so these are protocol-relative links to another host, not paths.
foreach (['/\\evil.example', '\\\\evil.example', '\\/evil.example', '\\evil.example', "/\t\\evil.example", " /\\evil.example/x", "/\n\\evil.example"] as $bad) {
    check('backslash host trick -> # ' . json_encode($bad), $href($bad) === ['href' => '#', 'external' => false], json_encode($href($bad)));
}
check('a backslash later in a path is still a path', $href('/a\\b/') === ['href' => '/a\\b/', 'external' => false]);
// A same-host URL whose path starts with "//" or "/\" would come out as a protocol-relative path: collapsed to one "/".
check('same host + //path -> one slash', $href('https://wp.example.test//evil.example/x?y=1') === ['href' => '/evil.example/x?y=1', 'external' => false], json_encode($href('https://wp.example.test//evil.example/x?y=1')));
check('same host + /\\path -> one slash', $href('https://wp.example.test/\\evil.example') === ['href' => '/evil.example', 'external' => false], json_encode($href('https://wp.example.test/\\evil.example')));
check('same host root stays /', $href('https://wp.example.test') === ['href' => '/', 'external' => false]);

// MU-04: the Reply-To header carries only the sender's name and address, never extra recipients.
check('plain name', mos_contact_reply_to('Jón Þór Ægisson', 'jon@example.is') === 'Reply-To: Jón Þór Ægisson <jon@example.is>');
check('initials keep their dots', mos_contact_reply_to('J. Jónsson', 'j@example.is') === 'Reply-To: J. Jónsson <j@example.is>');
$evil = mos_contact_reply_to('x, victim@example.com <attacker@evil.example>', 'me@example.is');
check('comma-split recipients removed', substr_count($evil, '<') === 1 && strpos($evil, ',') === false && str_ends_with($evil, ' <me@example.is>'), $evil);
check('quotes and semicolons removed', mos_contact_reply_to('"Ann" ; B', 'a@example.is') === 'Reply-To: Ann B <a@example.is>');
check('CR/LF removed', strpos(mos_contact_reply_to("Ann\r\nBcc: x@evil.example", 'a@example.is'), "\n") === false);
check('name of only specials -> address only', mos_contact_reply_to(' ,<>"; ', 'a@example.is') === 'Reply-To: a@example.is');
check('invalid UTF-8 -> address only', mos_contact_reply_to("\xC3\x28", 'a@example.is') === 'Reply-To: a@example.is');

// MU-16: mos_and_cat ids are positive ints, capped.
check('and_cat csv', mos_and_cat_ids('653,654') === [653, 654]);
check('and_cat array', mos_and_cat_ids(['653', '0', 'x', '654']) === [653, 654]);
check('and_cat empty', mos_and_cat_ids(null) === [] && mos_and_cat_ids('') === []);
check('and_cat duplicates once', mos_and_cat_ids('5,5,6') === [5, 6]);
check('and_cat capped', count(mos_and_cat_ids(implode(',', range(1, 500)))) === MOS_AND_CAT_MAX && MOS_AND_CAT_MAX === 20);

// MU-02: the users routes are hidden from anyone who can't edit posts; users/me and other routes stay.
$routes = ['/wp/v2/users' => 1, '/wp/v2/users/(?P<id>[\d]+)' => 2, '/wp/v2/users/me' => 3, '/wp/v2/posts' => 4,
    '/wp/v2/users/(?P<user_id>(?:[\d]+|me))/application-passwords' => 5];
$hidden = mos_hide_user_routes($routes, false);
check('users list hidden', !isset($hidden['/wp/v2/users']));
check('single user hidden', !isset($hidden['/wp/v2/users/(?P<id>[\d]+)']));
check('users/me kept (storefront identity)', ($hidden['/wp/v2/users/me'] ?? null) === 3);
check('other routes kept', ($hidden['/wp/v2/posts'] ?? null) === 4 && isset($hidden['/wp/v2/users/(?P<user_id>(?:[\d]+|me))/application-passwords']));
check('editors keep everything', mos_hide_user_routes($routes, true) === $routes);

check('?author= -> 404 for the public', mos_block_author_query(['author' => '2'], false) === ['error' => '404']);
check('/author/<slug>/ -> 404 for the public', mos_block_author_query(['author_name' => 'msportadmin', 'paged' => 2], false) === ['paged' => 2, 'error' => '404']);
check('author vars kept for editors', mos_block_author_query(['author' => '2'], true) === ['author' => '2']);
check('other queries untouched', mos_block_author_query(['pagename' => 'forsida'], false) === ['pagename' => 'forsida']);

$embed = mos_oembed_without_author(['title' => 'T', 'author_name' => 'larus_c8rnd913', 'author_url' => 'https://wp/author/larus/', 'type' => 'rich']);
check('oEmbed author fields dropped', $embed === ['title' => 'T', 'type' => 'rich'], json_encode($embed));
check('oEmbed non-array passes through', mos_oembed_without_author(false) === false);

// The owner's menu: a Félag/Lið or Íþrótt term picked in the menu editor links to the storefront's filter, the way
// the built menu does; every other item keeps its own address.
check('team term -> ?team=', mos_menu_item_href('taxonomy', 'pa_felag-lid', 'liverpool', 'https://wp.example.test/felag-lid/liverpool/') === ['href' => '/verslun/?team=liverpool', 'external' => false]);
check('sport term -> ?ithrott=', mos_menu_item_href('taxonomy', 'pa_ithrott', 'blak', 'https://wp.example.test/ithrott/blak/') === ['href' => '/verslun/?ithrott=blak', 'external' => false]);
check('category term keeps its path', mos_menu_item_href('taxonomy', 'product_cat', 'skor', 'https://wp.example.test/voruflokkur/skor/') === ['href' => '/voruflokkur/skor/', 'external' => false]);
check('brand term keeps its path', mos_menu_item_href('taxonomy', 'product_brand', 'hoka', 'https://wp.example.test/brand/hoka/') === ['href' => '/brand/hoka/', 'external' => false]);
check('a custom link to a team address is not rewritten', mos_menu_item_href('custom', 'custom', '', 'https://wp.example.test/verslun/?kyn=konur&team=liverpool') === ['href' => '/verslun/?kyn=konur&team=liverpool', 'external' => false]);
check('a team term whose slug is unknown falls back to its address', mos_menu_item_href('taxonomy', 'pa_felag-lid', '', 'https://wp.example.test/felag-lid/x/') === ['href' => '/felag-lid/x/', 'external' => false]);
check('a slug is encoded', mos_menu_item_href('taxonomy', 'pa_felag-lid', 'a&b=c', '') === ['href' => '/verslun/?team=a%26b%3Dc', 'external' => false]);

// The menu editor offers Félag/Lið and Íþrótt (WooCommerce registers attributes without it), and nothing else changes.
check('team taxonomy offered in the menu editor', mos_menu_taxonomy_args(['show_in_nav_menus' => false, 'public' => true], 'pa_felag-lid') === ['show_in_nav_menus' => true, 'public' => true]);
check('sport taxonomy offered in the menu editor', (mos_menu_taxonomy_args([], 'pa_ithrott')['show_in_nav_menus'] ?? null) === true);
check('other attributes untouched', mos_menu_taxonomy_args(['show_in_nav_menus' => false], 'pa_litur') === ['show_in_nav_menus' => false]);

// Their boxes, and the categories' and brands', are never among the hidden ones on the menu screen.
check('shop boxes shown', mos_menu_shown_boxes(['add-post-type-post', 'add-product_cat', 'add-pa_felag-lid', 'add-pa_ithrott', 'add-product_brand', 'add-post_tag']) === ['add-post-type-post', 'add-post_tag']);
check('no saved choice stays none', mos_menu_shown_boxes(false) === false);

// A menu save pokes the storefront once, however many items it saves (the editor saves each of ~250).
$GLOBALS['actions'] = [];
mos_menu_changed(); mos_menu_changed(); mos_menu_changed();
check('exactly one', (array_count_values($GLOBALS['actions'])['shutdown'] ?? 0) === 1, json_encode($GLOBALS['actions']));
check('the moved location pokes', mos_menu_locations_changed(['nav_menu_locations' => ['primary' => 1]], ['nav_menu_locations' => ['primary' => 2]]) === true);
check('another theme setting does not', mos_menu_locations_changed(['nav_menu_locations' => ['primary' => 1], 'x' => 1], ['nav_menu_locations' => ['primary' => 1], 'x' => 2]) === false);
check('theme mods that are not arrays do not', mos_menu_locations_changed(false, ['nav_menu_locations' => []]) === false);


echo ($fail === 0 ? "OK" : "FAILED") . " — $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
