<?php
/**
 * Unit test for the menu writer, the rebuild and the Stillingar "Valmynd" box in ../mos-nav.php, against in-memory
 * stand-ins for WordPress's menu functions (no WordPress needed):
 *  - a rebuild writes "Aðalvalmynd 2026" into the primary location and keeps the menu it replaces as one backup;
 *  - a second rebuild leaves exactly one backup (the older one goes);
 *  - when the owner has switched back to the backup, a rebuild keeps that one (the menu they chose) as the backup;
 *  - an empty catalog writes nothing; a failure halfway leaves the shown menu and no half-built one;
 *  - the button: refused without manage_options and without a valid nonce (nothing written), a good submit redirects
 *    with the item count; the box is not shown without manage_options.
 *
 * Run: php wp-mu-plugins/tests/mos_nav_write_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');

final class FakeDie extends Exception {}
final class FakeRedirect extends Exception {}
final class WP_Error {
    public function __construct(private string $message) {}
    public function get_error_message(): string { return $this->message; }
}

// --- the fake WordPress: menus, the primary location, the catalog, the signed-in user ---
$GLOBALS['menus'] = [];        // id => ['name' => string, 'items' => list<array>]
$GLOBALS['next_id'] = 100;
$GLOBALS['locations'] = [];
$GLOBALS['fail_item'] = '';    // a menu item title that cannot be added
$GLOBALS['can'] = true;        // manage_options
$GLOBALS['catalog'] = ['terms' => [], 'rows' => []];   // taxonomy => list<object>, taxonomy => list<object{id,term}>

function add_action(...$args): void {}
function is_wp_error($v): bool { return $v instanceof WP_Error; }
function home_url(string $path = ''): string { return 'https://wp.example.test' . $path; }
function admin_url(string $path = ''): string { return 'https://wp.example.test/wp-admin/' . $path; }
function add_query_arg(array $args, string $url): string { return $url . '?' . http_build_query($args); }
function esc_url(string $v): string { return $v; }
function esc_html(string $v): string { return htmlspecialchars($v, ENT_QUOTES); }
function esc_attr(string $v): string { return htmlspecialchars($v, ENT_QUOTES); }
function esc_js(string $v): string { return addslashes($v); }
function sanitize_key($v): string { return preg_replace('/[^a-z0-9_\-]/', '', strtolower((string) $v)); }
function wp_unslash($v) { return $v; }
function absint($v): int { return abs((int) $v); }
function wp_nonce_field(string $action): void { echo '<input type="hidden" name="_wpnonce" value="nonce-' . $action . '">'; }
function current_user_can(string $cap): bool { return $cap === 'manage_options' && $GLOBALS['can']; }
function wp_die($message = '', $title = '', $args = []): void { throw new FakeDie((string) ($args['response'] ?? '')); }
function check_admin_referer(string $action): void {
    if (($_REQUEST['_wpnonce'] ?? '') !== "nonce-$action") { throw new FakeDie('nonce'); }
}
function wp_safe_redirect(string $location): void { throw new FakeRedirect($location); }
function delete_transient(string $key): void {}
function get_current_user_id(): int { return 7; }
function get_nav_menu_locations(): array { return $GLOBALS['locations']; }
function set_theme_mod(string $name, $value): void { if ($name === 'nav_menu_locations') { $GLOBALS['locations'] = $value; } }
function wp_get_nav_menu_object($menu) {
    foreach ($GLOBALS['menus'] as $id => $m) {
        if ($id === $menu || $m['name'] === $menu) { return (object) ['term_id' => $id, 'name' => $m['name']]; }
    }
    return false;
}
function wp_create_nav_menu(string $name) {
    if (wp_get_nav_menu_object($name)) { return new WP_Error('a menu with that name exists'); }
    $id = $GLOBALS['next_id']++;
    $GLOBALS['menus'][$id] = ['name' => $name, 'items' => []];
    return $id;
}
function wp_update_nav_menu_item(int $menu_id, int $item_id, array $data) {
    if ($data['menu-item-title'] === $GLOBALS['fail_item']) { return new WP_Error('no'); }
    $GLOBALS['menus'][$menu_id]['items'][] = $data;
    return $GLOBALS['next_id']++;
}
function wp_delete_nav_menu(int $menu_id): bool {
    if (!isset($GLOBALS['menus'][$menu_id]) || $menu_id === ($GLOBALS['undeletable'] ?? 0)) { return false; }
    unset($GLOBALS['menus'][$menu_id]);
    return true;
}
function wp_update_nav_menu_object(int $menu_id, array $data) {
    $other = wp_get_nav_menu_object($data['menu-name']);
    if ($other && $other->term_id !== $menu_id) { return new WP_Error('a menu with that name exists'); }
    $GLOBALS['menus'][$menu_id]['name'] = $data['menu-name'];
    return $menu_id;
}
function get_terms(array $args): array { return $GLOBALS['catalog']['terms'][$args['taxonomy']] ?? []; }
$GLOBALS['wpdb'] = new class {
    public string $term_relationships = 'tr', $term_taxonomy = 'tt', $posts = 'p';
    public function prepare(string $sql, string $tax): string { return $tax; }
    public function get_results(string $tax): array { return $GLOBALS['catalog']['rows'][$tax] ?? []; }
};

require __DIR__ . '/../mos-nav.php';

$pass = 0;
$fail = 0;
function check(string $label, bool $ok, string $detail = ''): void {
    global $pass, $fail;
    if ($ok) { $pass++; return; }
    $fail++;
    echo "FAIL $label $detail\n";
}
/** Menu names by id, sorted by name. */
function names(): array { $n = array_column($GLOBALS['menus'], 'name'); sort($n); return $n; }
function shown(): string { return $GLOBALS['menus'][$GLOBALS['locations'][MOS_NAV_LOCATION] ?? 0]['name'] ?? ''; }

// A catalog: Konur with six Bolir (Fatnaður › Bolir), enough for one column.
$term = static fn (int $id, string $slug, string $name, int $parent = 0) => (object) ['term_id' => $id, 'slug' => $slug, 'name' => $name, 'parent' => $parent];
$full = ['terms' => ['product_cat' => [$term(1, 'kyn', 'Kyn'), $term(2, 'konur', 'Konur', 1), $term(10, 'fatnadur', 'Fatnaður'), $term(12, 'bolir', 'Bolir', 10)]],
    'rows' => ['product_cat' => []]];
for ($p = 1; $p <= 6; $p++) {
    $full['rows']['product_cat'][] = (object) ['id' => $p, 'term' => 2];
    $full['rows']['product_cat'][] = (object) ['id' => $p, 'term' => 12];
}

// --- an empty catalog writes nothing ---
try { mos_nav_rebuild(); check('empty catalog: refused', false, 'no exception'); }
catch (MOS_Nav_Empty $e) { check('empty catalog: refused', $GLOBALS['menus'] === []); }

// --- first rebuild: the theme's old menu stays, under its own name ---
$GLOBALS['catalog'] = $full;
$GLOBALS['menus'][5] = ['name' => 'Main Navigation', 'items' => []];
$GLOBALS['locations'] = [MOS_NAV_LOCATION => 5];
$r = mos_nav_rebuild();
check('first: shown menu is the new one', shown() === MOS_NAV_MENU_NAME, shown());
check('first: old theme menu kept, no backup yet', names() === [MOS_NAV_MENU_NAME, 'Main Navigation'] && $r['backup'] === '' && $r['previous'] === 'Main Navigation', json_encode(names()));
check('first: items counted and written', $r['items'] > 0 && count($GLOBALS['menus'][$r['menu_id']]['items']) === $r['items']);
check('first: tree returned', ($r['tree'][0]['title'] ?? '') === 'Konur');
check('first: no warnings', $r['warnings'] === [], json_encode($r['warnings']));

// --- second rebuild: the menu it replaces becomes the backup (with the owner's hand edits) ---
$first_id = $r['menu_id'];
$GLOBALS['menus'][$first_id]['items'][] = ['menu-item-title' => 'Handvirkt'];
$r = mos_nav_rebuild();
check('second: new menu shown', shown() === MOS_NAV_MENU_NAME && $r['menu_id'] !== $first_id);
check('second: replaced menu is the backup', ($GLOBALS['menus'][$first_id]['name'] ?? '') === MOS_NAV_BACKUP_NAME && $r['backup'] === MOS_NAV_BACKUP_NAME);
check('second: the backup still has the hand edit', in_array('Handvirkt', array_column($GLOBALS['menus'][$first_id]['items'], 'menu-item-title'), true));
check('second: no warnings', $r['warnings'] === [], json_encode($r['warnings']));

// --- third rebuild: still exactly one backup ---
$second_id = $r['menu_id'];
$r = mos_nav_rebuild();
check('third: one backup, the older one gone', names() === [MOS_NAV_MENU_NAME, MOS_NAV_BACKUP_NAME, 'Main Navigation'] && !isset($GLOBALS['menus'][$first_id])
    && $GLOBALS['menus'][$second_id]['name'] === MOS_NAV_BACKUP_NAME, json_encode(names()));

// --- the owner switched back to the backup: a rebuild keeps that one, drops the build they left ---
$third_id = $r['menu_id'];
$GLOBALS['locations'][MOS_NAV_LOCATION] = $second_id;
$r = mos_nav_rebuild();
check('switched back: the menu they chose is still the backup', ($GLOBALS['menus'][$second_id]['name'] ?? '') === MOS_NAV_BACKUP_NAME && !isset($GLOBALS['menus'][$third_id])
    && $r['backup'] === MOS_NAV_BACKUP_NAME, json_encode(names()));
check('switched back: the backup is not also reported as the previous menu', $r['previous'] === '');
check('switched back: new menu shown, one backup', shown() === MOS_NAV_MENU_NAME && names() === [MOS_NAV_MENU_NAME, MOS_NAV_BACKUP_NAME, 'Main Navigation']);

// --- the old backup cannot be deleted: it stays, the replaced build is kept under a dated backup name, the new menu is shown ---
$stuck = wp_get_nav_menu_object(MOS_NAV_BACKUP_NAME)->term_id;
$GLOBALS['undeletable'] = $stuck;
$r = mos_nav_rebuild();
check('stuck backup: warned, new menu shown under the main name', count($r['warnings']) === 1 && shown() === MOS_NAV_MENU_NAME && isset($GLOBALS['menus'][$stuck]), json_encode($r['warnings']));
check('stuck backup: nothing lost', count($GLOBALS['menus']) === 4, json_encode(names()));
$GLOBALS['undeletable'] = 0;
foreach ($GLOBALS['menus'] as $id => $m) { if (str_starts_with($m['name'], MOS_NAV_BACKUP_NAME . ' ')) { unset($GLOBALS['menus'][$id]); } }

// --- a failure halfway: the shown menu stays, no half-built menu is left ---
$before = [$GLOBALS['menus'], $GLOBALS['locations']];
$GLOBALS['fail_item'] = 'Bolir';
try { mos_nav_rebuild(); check('failure: throws', false, 'no exception'); }
catch (MOS_Nav_Empty $e) { check('failure: throws', false, 'empty'); }
catch (RuntimeException $e) { check('failure: nothing changed', [$GLOBALS['menus'], $GLOBALS['locations']] === $before); }
$GLOBALS['fail_item'] = '';

// --- the button ---
$run = static function (): string {
    try { mos_nav_handle_rebuild(); return 'returned'; }
    catch (FakeDie $e) { return 'die:' . $e->getMessage(); }
    catch (FakeRedirect $e) { return $e->getMessage(); }
};
ini_set('error_log', '/dev/null');
$before = [$GLOBALS['menus'], $GLOBALS['locations']];
$GLOBALS['can'] = false;
$_REQUEST = ['_wpnonce' => 'nonce-mos_nav_rebuild'];
check('button: refused without manage_options (403)', $run() === 'die:403' && [$GLOBALS['menus'], $GLOBALS['locations']] === $before);
$GLOBALS['can'] = true;
$_REQUEST = [];
check('button: refused without a nonce', $run() === 'die:nonce' && [$GLOBALS['menus'], $GLOBALS['locations']] === $before);
$_REQUEST = ['_wpnonce' => 'nonce-mos_nav_rebuild'];
$to = $run();
check('button: rebuilds and redirects with the count', str_contains($to, 'page=mos-stillingar') && str_contains($to, 'mos_nav=backup') && (bool) preg_match('/mos_nav_items=[1-9]\d*/', $to)
    && str_ends_with($to, '#valmynd') && [$GLOBALS['menus'], $GLOBALS['locations']] !== $before, $to);
$kept = $GLOBALS;
$GLOBALS['menus'] = [];
$GLOBALS['locations'] = [];
check('button: a first build promises no backup', str_contains($run(), 'mos_nav=rebuilt&'));
$GLOBALS['menus'] = $kept['menus'];
$GLOBALS['locations'] = $kept['locations'];
$GLOBALS['catalog'] = ['terms' => [], 'rows' => []];
$before = [$GLOBALS['menus'], $GLOBALS['locations']];
check('button: empty catalog -> empty notice, nothing written', str_contains($run(), 'mos_nav=empty') && [$GLOBALS['menus'], $GLOBALS['locations']] === $before);
$GLOBALS['catalog'] = $full;
$GLOBALS['fail_item'] = 'Bolir';
check('button: failure -> failed notice, nothing written', str_contains($run(), 'mos_nav=failed') && [$GLOBALS['menus'], $GLOBALS['locations']] === $before);
$GLOBALS['fail_item'] = '';

// --- the box ---
$box = static function (array $get): string { $_GET = $get; ob_start(); mos_nav_admin_box(); return (string) ob_get_clean(); };
$html = $box([]);
check('box: heading, button, action, nonce, confirm', str_contains($html, 'id="valmynd"') && str_contains($html, 'Endursmíða valmynd') && str_contains($html, 'value="mos_nav_rebuild"')
    && str_contains($html, 'nonce-mos_nav_rebuild') && str_contains($html, 'confirm('));
check('box: no notice by default', !str_contains($html, 'notice-'));
$html = $box(['mos_nav' => 'backup', 'mos_nav_items' => '244']);
check('box: rebuilt notice with the count and the backup', str_contains($html, 'notice-success') && str_contains($html, '244') && str_contains($html, 'afrit'));
check('box: first-build notice promises no backup', !str_contains($box(['mos_nav' => 'rebuilt', 'mos_nav_items' => '9']), 'Fyrri útgáfa'));
check('box: failed notice', str_contains($box(['mos_nav' => 'failed']), 'notice-error'));
check('box: unknown notice ignored', !str_contains($box(['mos_nav' => '<script>']), 'notice-'));
$GLOBALS['can'] = false;
check('box: hidden without manage_options', $box([]) === '');

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail ? 1 : 0);
