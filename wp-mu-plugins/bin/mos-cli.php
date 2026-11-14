<?php
/**
 * The mu-plugins' WP-CLI commands for hosts without WP-CLI (Plesk: Scheduled Tasks → "Run a PHP script" → Run Now):
 *
 *   php mos-cli.php mos-clean preview|apply [--samples=15] [--batch=200]
 *   php mos-cli.php mos-clean restore <journal file>
 *   php mos-cli.php mos-nav preview|apply
 *   php mos-cli.php mos-size reindex [--dry-run] | purge
 *
 * It loads WordPress with WP_CLI defined and a stand-in WP_CLI class (log, warning, success, error, add_command), so
 * the commands' own code runs unchanged. Every line also goes to <home>/mos-cli-logs/<command>-<sub>-<time>.log
 * (outside the web root), because Plesk shows only the first lines of a task's output. Only `mos-*` commands run.
 * `--wp=<folder>` names the WordPress folder; without it: ../../../httpdocs. Command line only.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

$mos_positional = [];
$mos_assoc = [];
foreach (array_slice($argv, 1) as $mos_arg) {
    if (preg_match('/^--([a-z][a-z0-9-]*)(?:=(.*))?$/s', $mos_arg, $mos_m)) { $mos_assoc[$mos_m[1]] = $mos_m[2] ?? true; }
    else { $mos_positional[] = $mos_arg; }
}
$mos_command = (string) ($mos_positional[0] ?? '');
$mos_sub = (string) ($mos_positional[1] ?? '');
$mos_rest = array_slice($mos_positional, 2);
$mos_wordpress_dir = rtrim((string) ($mos_assoc['wp'] ?? (__DIR__ . '/../../../httpdocs')), '/');
unset($mos_assoc['wp']);
if (!preg_match('/^mos-[a-z-]+$/', $mos_command) || !preg_match('/^[a-z_]+$/', $mos_sub)) {
    fwrite(STDERR, "Usage: php mos-cli.php mos-clean|mos-nav|mos-size <subcommand> [arguments]\n");
    exit(1);
}
if (!is_file($mos_wordpress_dir . '/wp-load.php')) { fwrite(STDERR, "No wp-load.php in $mos_wordpress_dir\n"); exit(1); }

$mos_log_dir = dirname($mos_wordpress_dir) . '/mos-cli-logs';
if (!is_dir($mos_log_dir)) { @mkdir($mos_log_dir, 0700, true); }
$GLOBALS['mos_cli_log'] = is_dir($mos_log_dir) ? @fopen(sprintf('%s/%s-%s-%s.log', $mos_log_dir, $mos_command, $mos_sub, gmdate('Ymd-His')), 'w') : false;

/** One line to the task's output and to the log file. */
function mos_cli_out(string $line): void {
    echo $line, "\n";
    if (!empty($GLOBALS['mos_cli_log'])) { fwrite($GLOBALS['mos_cli_log'], $line . "\n"); }
}

define('WP_CLI', true);
/** What the mos-* commands use of WP-CLI; any other static call (other plugins registering their commands) is a no-op. */
class WP_CLI {
    /** @var array<string, string|object> */
    public static array $commands = [];
    public static function add_command($name, $callable, $args = []) { self::$commands[(string) $name] = $callable; return true; }
    public static function log($message) { mos_cli_out((string) $message); }
    public static function line($message = '') { mos_cli_out((string) $message); }
    public static function success($message) { mos_cli_out('Success: ' . $message); }
    public static function warning($message) { mos_cli_out('Warning: ' . (is_object($message) && method_exists($message, 'get_error_message') ? $message->get_error_message() : $message)); }
    public static function error($message, $exit = true) {
        mos_cli_out('Error: ' . (is_object($message) && method_exists($message, 'get_error_message') ? $message->get_error_message() : $message));
        if ($exit) { exit(1); }
    }
    public static function __callStatic($name, $arguments) { return null; }
}
class WP_CLI_Command {}

set_time_limit(0);
@ini_set('memory_limit', '1024M');
// A request-less load: plugins that read the host get one, and a wp_die() during the load prints its message as text.
$_SERVER['HTTP_HOST'] = $_SERVER['HTTP_HOST'] ?? (string) (getenv('MOS_WP_HOST') ?: 'localhost');
$_SERVER['REQUEST_URI'] = $_SERVER['REQUEST_URI'] ?? '/';
$_SERVER['REQUEST_METHOD'] = $_SERVER['REQUEST_METHOD'] ?? 'GET';
function mos_cli_die($message, $title = '', $args = []) {
    if (is_object($message) && method_exists($message, 'get_error_message')) { $message = $message->get_error_message(); }
    mos_cli_out('WordPress stopped: ' . trim(html_entity_decode(strip_tags((string) $message))));
    exit(1);
}
$GLOBALS['wp_filter']['wp_die_handler'][10]['mos_cli_die'] = ['function' => static fn () => 'mos_cli_die', 'accepted_args' => 1];
define('WP_USE_THEMES', false);
require $mos_wordpress_dir . '/wp-load.php';

$mos_target = WP_CLI::$commands[$mos_command] ?? null;
if ($mos_target === null) { mos_cli_out("Error: no command \"$mos_command\" (is its mu-plugin installed?)"); exit(1); }
$mos_instance = is_object($mos_target) ? $mos_target : new $mos_target();
if (!is_callable([$mos_instance, $mos_sub])) { mos_cli_out("Error: \"$mos_command\" has no subcommand \"$mos_sub\""); exit(1); }
mos_cli_out("# $mos_command $mos_sub " . implode(' ', $mos_rest));
$mos_instance->{$mos_sub}($mos_rest, $mos_assoc);
