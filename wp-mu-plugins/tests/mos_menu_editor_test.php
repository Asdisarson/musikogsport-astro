<?php
/**
 * Unit test for the pure helpers in ../mos-menu.php (no WordPress needed): what the menu editor's save accepts
 * (mos_menu_editor_clean_tree, mos_menu_editor_clean_href).
 *
 * Run: php wp-mu-plugins/tests/mos_menu_editor_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
function add_action(...$args): void {}

require __DIR__ . '/../mos-menu.php';

$pass = 0;
$fail = 0;
function check(string $label, $got, $want): void {
    global $pass, $fail;
    if ($got === $want) { $pass++; return; }
    $fail++;
    printf("FAIL %s\n  want %s\n  got  %s\n", $label, json_encode($want, JSON_UNESCAPED_UNICODE), json_encode($got, JSON_UNESCAPED_UNICODE));
}
$n = static fn (string $t, string $h = '#', array $c = []): array => ['t' => $t, 'h' => $h, 'c' => $c];

// Addresses: a place in the shop, a heading, or a full address; never a script.
check('href: a shop path', mos_menu_editor_clean_href('/voruflokkur/skor/?kyn=konur'), '/voruflokkur/skor/?kyn=konur');
check('href: no slash gets one', mos_menu_editor_clean_href('skilmalar/'), '/skilmalar/');
check('href: empty is a heading', mos_menu_editor_clean_href('  '), '#');
check('href: # is a heading', mos_menu_editor_clean_href('#'), '#');
check('href: a full address', mos_menu_editor_clean_href('https://www.instagram.com/musikogsport/'), 'https://www.instagram.com/musikogsport/');
check('href: mailto and tel', [mos_menu_editor_clean_href('mailto:a@b.is'), mos_menu_editor_clean_href('tel:+3545553110')], ['mailto:a@b.is', 'tel:+3545553110']);
foreach (['javascript:alert(1)', "java\tscript:alert(1)", ' JavaScript:x', 'data:text/html,x', 'vbscript:x', '//evil.example/x', '/\\evil.example', '\\\\evil.example', "/a\nb"] as $bad) {
    check('href: refused ' . json_encode($bad), mos_menu_editor_clean_href($bad), null);
}
check('href: too long refused', mos_menu_editor_clean_href('/' . str_repeat('a', 2001)), null);

// A good tree comes back in mos-nav's shape, trimmed and without markup.
$r = mos_menu_editor_clean_tree([$n(' Konur ', '/verslun/?kyn=konur', [$n('Fatnaður', '/voruflokkur/fatnadur/', [$n('<b>Bolir</b>', 'voruflokkur/bolir/')])]), $n('Útsala', '/voruflokkur/sale/')]);
check('tree: no errors', $r['errors'], []);
check('tree: shape', $r['tree'], [
    ['title' => 'Konur', 'href' => '/verslun/?kyn=konur', 'children' => [
        ['title' => 'Fatnaður', 'href' => '/voruflokkur/fatnadur/', 'children' => [['title' => 'Bolir', 'href' => '/voruflokkur/bolir/', 'children' => []]]],
    ]],
    ['title' => 'Útsala', 'href' => '/voruflokkur/sale/', 'children' => []],
]);
check('tree: counted', $r['items'], 4);

// What is refused, and that nothing is returned to write then.
$bad = static fn ($input): array => mos_menu_editor_clean_tree($input);
check('tree: not a list', [$bad('x')['tree'], count($bad('x')['errors'])], [[], 1]);
check('tree: an empty menu is refused (it would clear the shop\'s menu)', [$bad([])['tree'], count($bad([])['errors'])], [[], 1]);
check('tree: an item without a name', count($bad([$n('  ')])['errors']), 1);
check('tree: an item that is not an item', count($bad(['Konur'])['errors']), 1);
check('tree: a bad address names the item', (bool) preg_match('/Hættulegt/', implode(' ', $bad([$n('Hættulegt', 'javascript:alert(1)')])['errors'])), true);
check('tree: a bad address writes nothing', $bad([$n('Gott', '/a/'), $n('Hættulegt', 'javascript:alert(1)')])['tree'], []);
check('tree: four levels refused', count($bad([$n('1', '#', [$n('2', '#', [$n('3', '#', [$n('4')])])])])['errors']), 1);
check('tree: three levels fine', $bad([$n('1', '#', [$n('2', '#', [$n('3')])])])['errors'], []);
check('tree: too many items refused', count($bad(array_map(static fn ($i) => $n("A$i"), range(1, MOS_MENU_EDITOR_MAX_ITEMS + 1)))['errors']), 1);
check('tree: a long name refused', count($bad([$n(str_repeat('á', MOS_MENU_EDITOR_MAX_TITLE + 1))])['errors']), 1);
check('tree: a name of the longest length', $bad([$n(str_repeat('á', MOS_MENU_EDITOR_MAX_TITLE))])['errors'], []);
check('tree: children that are not a list count as none', $bad([['t' => 'Konur', 'h' => '#', 'c' => 'x']])['tree'], [['title' => 'Konur', 'href' => '#', 'children' => []]]);

// The notice after a save promises a backup only when mos_nav_write warned about none.
check('save notice: no warning promises the backup', mos_menu_editor_saved_notice([]), 'saved');
check('save notice: a warning does not promise one', mos_menu_editor_saved_notice(['the earlier menu 5 was not kept as the backup: x']), 'saved_nobackup');
check('notices: the failed restore and the unkept backup have notices', [isset(MOS_MENU_EDITOR_NOTICES['restore_failed']), isset(MOS_MENU_EDITOR_NOTICES['saved_nobackup'])], [true, true]);
check('notices: the unkept-backup notice does not promise a backup', str_contains(MOS_MENU_EDITOR_NOTICES['saved_nobackup'][1], 'ekki örugglega geymd'), true);
check('notices: only known kinds', array_diff(array_column(MOS_MENU_EDITOR_NOTICES, 0), ['success', 'error', 'warning']), []);

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail ? 1 : 0);
