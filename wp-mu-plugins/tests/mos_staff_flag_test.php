<?php
/**
 * Unit test for the pure rule in ../mos-staff-flag.php (no WordPress needed).
 *
 * Run: php wp-mu-plugins/tests/mos_staff_flag_test.php   (exit code 0 = all pass)
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
function add_action(...$args): void {}

require __DIR__ . '/../mos-staff-flag.php';

$pass = 0;
$fail = 0;
function check(string $label, $got, $want): void {
    global $pass, $fail;
    if ($got === $want) { $pass++; return; }
    $fail++;
    printf("FAIL %s\n  want %s\n  got  %s\n", $label, json_encode($want), json_encode($got));
}

// WordPress on a subdomain of the shop: the cookie goes on the shop's host, which covers both.
check('production', mos_staff_cookie_domain('wp.musikogsport.is', 'musikogsport.is'), 'musikogsport.is');
check('case and port ignored', mos_staff_cookie_domain('WP.Musikogsport.is:443', 'musikogsport.is'), 'musikogsport.is');
check('deeper subdomain', mos_staff_cookie_domain('a.wp.musikogsport.is', 'musikogsport.is'), 'musikogsport.is');
// Same host (local: both on localhost, cookies ignore the port): a host-only cookie.
check('local', mos_staff_cookie_domain('localhost:10025', 'localhost'), '');
// Hosts that share no cookie scope: no flag at all.
check('unrelated hosts', mos_staff_cookie_domain('wp.example.com', 'musikogsport.is'), null);
check('suffix that is not a subdomain', mos_staff_cookie_domain('evilmusikogsport.is', 'musikogsport.is'), null);
check('shop on a subdomain of WordPress', mos_staff_cookie_domain('musikogsport.is', 'new.musikogsport.is'), null);
check('no shop configured', mos_staff_cookie_domain('wp.musikogsport.is', ''), null);
check('no host', mos_staff_cookie_domain('', 'musikogsport.is'), null);

printf("%d passed, %d failed\n", $pass, $fail);
exit($fail === 0 ? 0 : 1);
