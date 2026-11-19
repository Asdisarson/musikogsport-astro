<?php
/**
 * Unit test for the pure rules in ../mos-shell-poke.php (no WordPress needed).
 *
 * Run: php wp-mu-plugins/tests/mos_shell_poke_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
function add_action(...$args): void {}
function wp_json_encode($v) { return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }

require __DIR__ . '/../mos-shell-poke.php';

$pass = 0;
$fail = 0;
function check(string $label, $got, $want): void {
    global $pass, $fail;
    if ($got === $want) { $pass++; return; }
    $fail++;
    printf("FAIL %s\n  want %s\n  got  %s\n", $label, json_encode($want), json_encode($got));
}

// Storefront paths are taken from the permalink's path.
check('product', mos_shell_poke_path('https://musikogsport.is/verslun/skor/vara-1/'), '/verslun/skor/vara-1/');
check('product with a query is the bare path', mos_shell_poke_path('https://musikogsport.is/vara/treyja/?x=1'), '/vara/treyja/');
check('icelandic slug', mos_shell_poke_path('https://musikogsport.is/verslun/íþróttir/þrúgu-æði/'), '/verslun/íþróttir/þrúgu-æði/');
check('home is not a product', mos_shell_poke_path('https://musikogsport.is/'), null);
check('karfa is not', mos_shell_poke_path('https://musikogsport.is/karfa/'), null);
check('traversal refused', mos_shell_poke_path('https://musikogsport.is/verslun/../karfa/'), null);
check('no trailing slash refused', mos_shell_poke_path('https://musikogsport.is/verslun/skor/vara-1'), null);
check('empty', mos_shell_poke_path(''), null);

// The body: de-duplicated, capped, and nothing at all when there is nothing to say.
check('nothing to say', mos_shell_poke_body([], [], false), null);
check('stale and listings', mos_shell_poke_body(['/verslun/a/'], [], true), '{"stale":["/verslun/a/"],"drop":[],"listings":true}');
check('dedupe', mos_shell_poke_body(['/vara/a/', '/vara/a/'], [], false), '{"stale":["/vara/a/"],"drop":[],"listings":false}');
check('drop', mos_shell_poke_body([], ['/vara/b/'], false), '{"stale":[],"drop":["/vara/b/"],"listings":false}');
$many = [];
for ($i = 0; $i < 80; $i++) { $many[] = "/vara/p$i/"; }
$decoded = json_decode((string) mos_shell_poke_body($many, [], false), true);
check('capped at 50', count($decoded['stale']), MOS_SHELL_POKE_MAX);

// Only a catalog editor's saves poke: WP-CLI, or a user who may edit products. A checkout's stock change is neither.
check('editor', mos_shell_poke_is_editor(false, true), true);
check('wp-cli', mos_shell_poke_is_editor(true, false), true);
check('customer or guest', mos_shell_poke_is_editor(false, false), false);

// A bulk change past the cap is a "products" mark (with the key), or batches of 50 (without it). Never a silent cut.
$decoded = json_decode((string) mos_shell_poke_body($many, [], false), true);
check('bulk over the cap sends the products mark', $decoded['products'] ?? null, true);
check('a small poke has no products key (the storefront reads a missing key as false)', array_key_exists('products', json_decode((string) mos_shell_poke_body(['/vara/a/'], [], false), true)), false);
check('over the cap in drops, too', json_decode((string) mos_shell_poke_body([], $many, false), true)['products'] ?? null, true);
check('an explicit products mark alone is a poke', mos_shell_poke_body([], [], false, true), '{"stale":[],"drop":[],"listings":false,"products":true}');

$hundred = [];
for ($i = 0; $i < 120; $i++) { $hundred[] = "/vara/p$i/"; }
$batches = mos_shell_poke_bodies($hundred, [], true, false);
check('without the key: 120 paths are three batches of 50, 50, 20', array_map(fn ($b) => count(json_decode($b, true)['stale']), $batches), [50, 50, 20]);
check('without the key: listings only in the first batch', array_map(fn ($b) => json_decode($b, true)['listings'], $batches), [true, false, false]);
check('without the key: no products mark is ever sent', array_filter(array_map(fn ($b) => json_decode($b, true)['products'] ?? false, $batches)), []);
check('with the key: one body, the products mark for the overflow', count(mos_shell_poke_bodies($many, [], false, true)), 1);
check('with the key: the products mark for the overflow', json_decode(mos_shell_poke_bodies($many, [], false, true)[0], true)['products'] ?? null, true);
check('nothing to send, no body', mos_shell_poke_bodies([], [], false, false), []);
$huge = [];
for ($i = 0; $i < 1100; $i++) { $huge[] = "/vara/h$i/"; }
check('batches stop at 20 (the rest is logged, not sent)', count(mos_shell_poke_bodies($huge, [], false, false)), 20);

// A product that moved (new slug or category) drops the path it had; one that did not move drops nothing (review 7).
check('moved: the old path goes', mos_shell_poke_moved('/verslun/a/vara-1/', '/verslun/b/vara-1/'), ['/verslun/a/vara-1/']);
check('not moved: nothing', mos_shell_poke_moved('/verslun/a/vara-1/', '/verslun/a/vara-1/'), []);
check('unpublished: the new path is gone (null), the old one goes', mos_shell_poke_moved('/vara/x/', null), ['/vara/x/']);
check('nothing captured: nothing', mos_shell_poke_moved(null, '/vara/x/'), []);


// A path the storefront cannot take (over 200 characters) is skipped with a log line; the rest are still sent (review 6).
$long = '/verslun/' . str_repeat('a', 250) . '/';
check('an over-long path is not sent, the others are', json_decode((string) mos_shell_poke_body(['/vara/a/', $long], [], false), true)['stale'], ['/vara/a/']);
check('the cap counts characters, not bytes (an Icelandic slug of 150 characters is kept)', count(mos_shell_poke_fit(['/verslun/' . str_repeat('þ', 150) . '/'])), 1);
check('a keyed poke skips an over-long path too', json_decode(mos_shell_poke_bodies(['/vara/a/', $long], [], false, true)[0], true)['stale'], ['/vara/a/']);

// A scheduled save (WP-Cron: WooCommerce's sale start and end) pokes unless it changed only stock (review 7). Order
// stock changes are stock-only and never poke; a checkout's request is neither an editor nor a scheduled save.
check('scheduled sale price change pokes', mos_shell_poke_is_editor(false, false, true, ['price', '_price']), true);
check('scheduled save with no tracked change still pokes', mos_shell_poke_is_editor(false, false, true, []), true);
check('scheduled stock-only change does not poke', mos_shell_poke_is_editor(false, false, true, ['stock_quantity', 'stock_status']), false);
check('a checkout (not scheduled, not an editor) does not poke, whatever changed', mos_shell_poke_is_editor(false, false, false, ['price']), false);
check('stock-only: one stock prop', mos_shell_poke_stock_only(['stock_quantity']), true);
check('stock-only: a price is not', mos_shell_poke_stock_only(['stock_quantity', 'price']), false);
check('stock-only: nothing is not', mos_shell_poke_stock_only([]), false);

// The pre-save capture is used once: whichever hook takes it first. A stale capture cannot reach a later hook (review 8).
$GLOBALS['mos_shell_poke_before'] = [7 => '/vara/a/'];
check('first take gives the captured path', mos_shell_poke_take_before(7), '/vara/a/');
check('the capture is gone after the take', mos_shell_poke_take_before(7), null);
mos_shell_poke_capture_props(9, ['price']);
check('captured props are taken once', mos_shell_poke_take_props(9), ['price']);
check('and then gone', mos_shell_poke_take_props(9), []);

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail === 0 ? 0 : 1);
