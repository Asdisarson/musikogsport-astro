<?php
/**
 * Plugin Name: MOS Product Names
 * Description: Tidies product names a little, never more:
 *  - words typed in capitals become ordinary case ("NIKE PRO WARM TIGHT" → "Nike Pro Warm Tight"); abbreviations,
 *    federations, sizes and maker's codes stay as typed (FC, GTX, HSÍ, UEFA, XL, FTWWHT/SOLRED/LUCBLU), and so does
 *    everything with a digit in it (F50, EURO24, 2025/26): years and numbers never change;
 *  - extra spaces go, and a brand or audience word said a second time goes ("Trofe Trofe …", "… BARNA … BARNA").
 *  Words already in ordinary case are left exactly as typed, and spelling is never corrected.
 *  The SKU is never read for writing and never written. The product's link (its slug) stays what the original name
 *  gave: an existing product keeps its slug, and a new one gets its slug from the name as it was typed.
 *  - New products: tidied once, the first time a catalog editor saves them with a name (after `mark` or `apply` has
 *    switched this on). The product is then marked (MOS_NAMES_META), so a name staff change later stands.
 *  - WP-CLI: `wp mos-names preview` (writes nothing; old and new name side by side), `wp mos-names apply` (writes,
 *    with a journal in uploads/mos-names/ that `wp mos-names restore <file>` puts back), `wp mos-names mark` (changes
 *    no name: marks every existing product as handled and switches the new-product tidying on).
 *
 * Author: Músík og Sport
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) { exit; }

const MOS_NAMES_META = '_mos_name_tidied';     // set once a product's name was looked at; never looked at again
const MOS_NAMES_LIVE_OPTION = 'mos_names_live';   // '1' once the existing catalog was marked: new products are tidied
const MOS_NAMES_DIR = 'mos-names';             // under wp-content/uploads
const MOS_NAMES_VOCAB_TRANSIENT = 'mos_names_vocab';

/* ------------------------------------------------------------------------
 * 1. Word lists
 * --------------------------------------------------------------------- */

/** All-caps words that stay as typed although they contain a vowel: abbreviations, federations, sizes, trademarks. */
const MOS_NAMES_KEEP = ['ADV', 'AF', 'AFA', 'AG', 'ALV', 'AMG', 'ATR', 'EHF', 'EU', 'FIFA', 'HSÍ', 'II', 'III', 'IV', 'JDI', 'KSÍ', 'KKÍ', 'MIPS',
    'NSW', 'OM', 'OTR', 'UCL', 'UEFA', 'UPL', 'US', 'USA', 'USX', 'UV', 'ZNE', 'TYR', 'SE', 'ES', 'EG', 'IM', 'DNA', 'AC', 'NBA', 'NFL', 'PSG',
    'LFC', 'MUFC', 'XL', 'XS', 'XXL', 'XXS', 'UK', 'EUR', 'CE', 'ID', 'LED', 'EVA', 'PU', 'TPU', 'HD', 'GEL', 'AEROREADY', 'BOA', 'GORE', 'TEX',
    'DÍH', 'ATM', 'AM', 'ESS', 'LGE', 'EL', 'BU', 'DU'];
/** Brands their makers write in capitals: left as typed. */
const MOS_NAMES_CAPS_BRANDS = ['sklz', 'hoka'];
/** All-caps words that are ordinary words although the shop never writes them in ordinary case, or they have no vowel. */
const MOS_NAMES_WORDS = ['GYM', 'DRY', 'SKY', 'FLY', 'TRY', 'MY', 'BY', 'GYLLT', 'BAKI', 'BLAR', 'HUFA', 'SKOR', 'VEL', 'BAR', 'BUG', 'CUTE', 'DAD',
    'EAR', 'ECO', 'FACT', 'FOG', 'FUN', 'GOL', 'JAM', 'JOG', 'LEAF', 'LIME', 'NEON', 'NUDE', 'PLUM', 'RAMP', 'SACK', 'SIX', 'SLAM', 'TAPE', 'TOY',
    'TRIO', 'WASH', 'WOLF', 'ZONE', 'BELT', 'COPA', 'ECRU', 'FUSE', 'GRIT', 'HOUR', 'THE', 'AIR', 'PRO', 'RUN', 'BAG', 'CAP', 'HAT', 'SET', 'KIT',
    'MAN', 'RED', 'TEE', 'TOP', 'BRA', 'ONE', 'OWN', 'FOR', 'AND', 'WITH', 'ALL', 'DAY', 'BIG', 'BOY', 'ON', 'IN', 'OF', 'DUNK', 'LJOS', 'BIO', 'FÁNI', 'MÖTT', 'RÖND', 'SKÓ', 'SKÓR', 'BLÁ', 'BLÁR', 'GRÁ', 'GRÁR', 'GUL', 'HVÍT', 'RAUÐ', 'GRÆN', 'BRÚN',
    'HÚFA', 'ÚLPA', 'ULL', 'DÖMU', 'LJÓS'];
/** Icelandic small words: lower case unless they open the name. */
const MOS_NAMES_SMALL = ['og', 'með', 'fyrir', 'í', 'á', 'til', 'frá'];
/** Maker's spellings of whole tokens. The ones in MOS_NAMES_ALWAYS are applied whatever the case typed. */
const MOS_NAMES_SPELLINGS = ['dri-fit' => 'Dri-FIT', 'drifit' => 'Dri-FIT', 'gore-tex' => 'GORE-TEX', 't-shirt' => 'T-Shirt',
    'cold.rdy' => 'COLD.RDY', 'heat.rdy' => 'HEAT.RDY', 'f.c.' => 'F.C.', 'f.c' => 'F.C'];
const MOS_NAMES_ALWAYS = ['dri-fit'];
/** Who a product is for: said a second time in a name, the second goes. */
const MOS_NAMES_AUDIENCE = ['barna', 'herra', 'dömu', 'dömur', 'kvenna', 'karla', 'kids', 'mens', 'womens', 'junior'];

/* ------------------------------------------------------------------------
 * 2. Pure rules (unit-tested without WordPress)
 * --------------------------------------------------------------------- */

function mos_names_is_caps(string $w): bool {
    return $w === mb_strtoupper($w) && preg_match('/\p{Lu}/u', $w) === 1;
}

/**
 * The words the shop writes in ordinary case somewhere in its product names: an all-caps word found here is an
 * ordinary word, not a code.
 * @param iterable<string> $titles
 * @return array<string,true> keyed by the lower-cased word
 */
function mos_names_vocab(iterable $titles): array {
    $vocab = [];
    foreach ($titles as $title) {
        if (!preg_match_all("/\p{L}+(?:['’]\p{L}+)*/u", (string) $title, $m)) { continue; }
        foreach ($m[0] as $w) {
            if (mb_strlen($w) >= 2 && !mos_names_is_caps($w)) { $vocab[mb_strtolower($w)] = true; }
        }
    }
    return $vocab;
}

/** Whether an all-caps word of five letters or more reads like a word rather than a maker's code (CBLACK, SPDSCU). */
function mos_names_sayable(string $w): bool {
    $len = mb_strlen($w);
    if ($len < 5 || preg_match('/^(.)\1/u', $w) === 1) { return false; }
    $ratio = preg_match_all('/[AEIOUYÁÉÍÓÚÝÖÆ]/u', $w) / $len;
    if ($ratio < 0.2 || $ratio > 0.7) { return false; }
    return $len >= 8 || preg_match('/[^AEIOUYÁÉÍÓÚÝÖÆ]{4}/u', $w) !== 1;   // a long word may be a compound: "LONGSLEEVED"
}

/** Whether an all-caps word is an ordinary word the rules may put in ordinary case. $strict: only on the shop's own
 *  evidence (used inside a colour group like FTWWHT/CARBON, where one code makes the whole group a code). */
function mos_names_is_word(string $w, array $vocab, bool $strict): bool {
    if (in_array($w, MOS_NAMES_KEEP, true)) { return false; }
    if (in_array($w, MOS_NAMES_WORDS, true)) { return true; }
    if (preg_match('/[AEIOUÁÉÍÓÚÖÆ]/u', $w) !== 1) { return false; }                 // FC, GTX, KVK, FTWWHT: never a word
    if (isset($vocab[mb_strtolower($w)])) { return true; }
    if (mb_strlen($w) >= 5 && preg_match('/[ÁÐÉÍÓÚÝÞÆÖ]/u', $w) === 1) { return true; }   // an Icelandic letter in a longer word (ÍR, ÍBV, UMFÍ are clubs)
    return !$strict && mos_names_sayable($w);
}

/** One run of letters. $first: it opens the name. $after_hyphen: it follows a hyphen inside its token. */
function mos_names_case_word(string $w, bool $first, bool $after_hyphen, array $vocab, array $brands, bool $strict = false): string {
    $low = mb_strtolower($w);
    if ($first && $w === $low && isset($brands[$low])) { return $brands[$low]; }     // "adidas Own the Run"
    if (mb_strlen($w) < 2 || !mos_names_is_caps($w)) { return $w; }
    if ($after_hyphen && $w === 'FIT') { return $w; }                                 // Therma-FIT, Storm-FIT
    if (isset($brands[$low])) { return in_array($low, MOS_NAMES_CAPS_BRANDS, true) ? $w : $brands[$low]; }
    if (in_array($low, MOS_NAMES_SMALL, true)) { return $first ? mb_substr($w, 0, 1) . mb_substr($low, 1) : $low; }
    if (!mos_names_is_word($w, $vocab, $strict)) { return $w; }
    return mb_substr($w, 0, 1) . mb_strtolower(mb_substr($w, 1));
}

/** One space-separated token of the name. */
function mos_names_case_token(string $t, bool $first, array $vocab, array $brands): string {
    $core = trim($t, '()",');
    $low = mb_strtolower($core);
    if ($core !== '' && isset(MOS_NAMES_SPELLINGS[$low])) {
        if (!in_array($low, MOS_NAMES_ALWAYS, true) && !mos_names_is_caps($core)) { return $t; }   // "T-shirt" as typed
        return str_replace($core, MOS_NAMES_SPELLINGS[$low], $t);
    }
    $word = "\p{L}+(?:['’]\p{L}+)*";
    if (preg_match('/\d/', $t) === 1) {
        // F50, EURO24, 500ML, 2025/26 stay; a whole word hyphened or slashed to a number is cased ("3-STRIPES").
        $parts = preg_split('~([-/])~', $t, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [$t];
        foreach ($parts as $i => $part) {
            if (mb_strlen($part) >= 3 && preg_match("/^$word$/u", $part) === 1) { $parts[$i] = mos_names_case_word($part, false, false, $vocab, $brands); }
        }
        return implode('', $parts);
    }
    $strict = false;
    if (str_contains($t, '/')) {
        // A colour group: one part that is not a word on the shop's own evidence keeps the whole group as typed.
        preg_match_all("/$word/u", $t, $m);
        foreach ($m[0] as $part) {
            if (mb_strlen($part) >= 2 && mos_names_is_caps($part) && !isset($brands[mb_strtolower($part)]) && !mos_names_is_word($part, $vocab, true)) { return $t; }
        }
        $strict = true;
    }
    return (string) preg_replace_callback("/$word/u", static function (array $m) use ($t, $first, $vocab, $brands, $strict): string {
        [$w, $at] = $m[0];
        return mos_names_case_word($w, $first && $at === 0, $at > 0 && $t[$at - 1] === '-', $vocab, $brands, $strict);
    }, $t, -1, $count, PREG_OFFSET_CAPTURE);
}

/** The token as the repeat rules compare it. */
function mos_names_bare(string $t): string {
    return trim(mb_strtolower($t), '()",.');
}

/**
 * The tidied name. Never empties a name, never touches a name of one word (a bare code stays what it is).
 * @param array<string,true> $vocab  mos_names_vocab()
 * @param array<string,string> $brands  lower-cased one-word brand => the brand as the shop writes it
 */
function mos_names_simplify(string $name, array $vocab, array $brands): string {
    $n = trim((string) preg_replace('/\s+/u', ' ', $name));
    $n = (string) preg_replace('/\s+([,.])(?=\s|$)/u', '$1', $n);
    $n = (string) preg_replace('/^(?:[\s,]|[\-–.](?!\d))+|[\s\-–,]+$/u', '', $n);
    $tokens = $n === '' ? [] : explode(' ', $n);
    if (count($tokens) < 2) { return $n === '' ? $name : $n; }

    $seen = [];
    $brands_seen = [];
    $out = [];
    $count = count($tokens);
    for ($i = 0; $i < $count; $i++) {
        $t = $tokens[$i];
        $k = mos_names_bare($t);
        if (isset($brands[$k]) && isset($brands_seen[$k])) {
            // The brand again, with the words it repeats after it, and a cut-off repeat at the very end.
            $j = $i + 1;
            while ($j < $count && isset($seen[mos_names_bare($tokens[$j])])) { $j++; }
            if ($j < $count && preg_match('/\d/', $tokens[$j]) === 1) {   // "Air Max 90 Nike Air Max 95": another model, not a repeat
                $seen[$k] = true;
                $out[] = $t;
                continue;
            }
            if ($j === $count - 1 && preg_match('/^\p{L}{3,}$/u', $tokens[$j]) === 1) {
                $tail = mb_strtolower($tokens[$j]);
                foreach (array_keys($seen) as $s) {
                    if (str_starts_with((string) $s, $tail)) { $j++; break; }
                }
            }
            if ($j >= $count) {
                while ($out && in_array(end($out), ['-', '–', '/', '|'], true)) { array_pop($out); }
            }
            $i = $j - 1;
            continue;
        }
        if ($out && mb_strtolower(end($out)) === mb_strtolower($t) && preg_match('/\p{L}{3}/u', $t) === 1) { continue; }   // "Trofe Trofe"
        if (in_array($k, MOS_NAMES_AUDIENCE, true) && isset($seen[$k])) { continue; }                                    // "… BARNA … BARNA"
        if (isset($brands[$k])) { $brands_seen[$k] = true; }
        $seen[$k] = true;
        $out[] = $t;
    }
    foreach ($out as $i => $t) { $out[$i] = mos_names_case_token($t, $i === 0, $vocab, $brands); }
    $tidied = (string) preg_replace('/^(?:[\s,]|[\-–.](?!\d))+|[\s\-–,]+$/u', '', implode(' ', $out));
    return $tidied === '' ? $n : $tidied;
}

/** Whether a saved product is due its one tidying. */
function mos_names_due(string $status, string $title, bool $handled, bool $live): bool {
    if (!$live || $handled || trim($title) === '') { return false; }
    return !in_array($status, ['auto-draft', 'trash'], true);
}

/* ------------------------------------------------------------------------
 * 3. WordPress glue
 * --------------------------------------------------------------------- */

/** @return array{0:array<string,true>,1:array<string,string>} the vocabulary and the one-word brands */
function mos_names_context(bool $fresh = false): array {
    static $context = null;
    if ($context !== null && !$fresh) { return $context; }
    $vocab = $fresh ? false : get_transient(MOS_NAMES_VOCAB_TRANSIENT);
    if (!is_array($vocab)) {
        global $wpdb;
        $titles = $wpdb->get_col("SELECT post_title FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status NOT IN ('trash', 'auto-draft')");
        $vocab = mos_names_vocab($titles);
        set_transient(MOS_NAMES_VOCAB_TRANSIENT, $vocab, 12 * HOUR_IN_SECONDS);
    }
    $brands = [];
    $terms = get_terms(['taxonomy' => 'product_brand', 'hide_empty' => false]);
    foreach (is_array($terms) ? $terms : [] as $term) {
        $name = html_entity_decode((string) $term->name, ENT_QUOTES);
        if (!str_contains($name, ' ')) { $brands[mb_strtolower($name)] = $name; }
    }
    return $context = [$vocab, $brands];
}

/** Whether a product without a link yet must be given one now: only when the tidied name would give another link
 *  than the name as typed (a repeated word went). Capitals and spaces never change a link, so then the product is
 *  left to get its link when it is published, as any draft does. */
function mos_names_freeze_slug(string $typed_slug, string $tidied_slug): bool {
    return $typed_slug !== $tidied_slug;
}

/** A size's own title starts with its product's name (WooCommerce writes "<product> - <size>", and rewrites it the
 *  same way when a product is renamed in wp-admin): give the sizes of a renamed product the new start. Titles only. */
function mos_names_rename_variations(int $id, string $from, string $to): int {
    global $wpdb;
    if ($from === '' || $from === $to) { return 0; }
    $ids = $wpdb->get_col($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'product_variation' AND post_parent = %d AND post_title LIKE %s",
        $id, $wpdb->esc_like($from) . '%'));
    if (!$ids) { return 0; }
    $n = (int) $wpdb->query($wpdb->prepare("UPDATE {$wpdb->posts} SET post_title = CONCAT(%s, SUBSTRING(post_title, %d)) WHERE post_type = 'product_variation' AND post_parent = %d AND post_title LIKE %s",
        $to, mb_strlen($from) + 1, $id, $wpdb->esc_like($from) . '%'));
    foreach ($ids as $vid) { clean_post_cache((int) $vid); }
    return $n;
}

/**
 * Write a tidied name. Only the title is written (never the SKU). The slug is not regenerated: an existing slug
 * stays, and a product that has none yet gets it from the name as it was typed when the tidied name would give
 * another. Nothing is written when the name is no longer $old (staff changed it meanwhile).
 */
function mos_names_write(int $id, string $old, string $new): bool {
    global $wpdb;
    $post = get_post($id);
    if (!$post instanceof WP_Post || $post->post_type !== 'product') { return false; }
    $fields = ['post_title' => $new];
    if ($post->post_name === '' && mos_names_freeze_slug(sanitize_title($old), sanitize_title($new))) {
        $fields['post_name'] = wp_unique_post_slug(sanitize_title($old), $id, 'publish', 'product', (int) $post->post_parent);
    }
    if (!$wpdb->update($wpdb->posts, $fields, ['ID' => $id, 'post_title' => $old])) { return false; }   // false: error; 0: renamed meanwhile
    mos_names_rename_variations($id, $old, $new);
    clean_post_cache($id);
    if (function_exists('wc_delete_product_transients')) { wc_delete_product_transients($id); }
    return true;
}

/** A catalog editor saved a product: tidy its name if this is the first time it has one. */
function mos_names_on_save(int $id): void {
    if ($id <= 0 || !empty($GLOBALS['mos_names_running'])) { return; }
    if (!(defined('WP_CLI') && WP_CLI) && !current_user_can('edit_products')) { return; }
    $post = get_post($id);
    if (!$post instanceof WP_Post || $post->post_type !== 'product') { return; }
    $handled = get_post_meta($id, MOS_NAMES_META, true) !== '';
    if (!mos_names_due((string) $post->post_status, (string) $post->post_title, $handled, get_option(MOS_NAMES_LIVE_OPTION) === '1')) { return; }
    $GLOBALS['mos_names_running'] = true;
    try {
        [$vocab, $brands] = mos_names_context();
        $old = (string) $post->post_title;
        $new = mos_names_simplify($old, $vocab, $brands);
        if ($new !== $old) { mos_names_write($id, $old, $new); }
        update_post_meta($id, MOS_NAMES_META, '1');
    } catch (\Throwable $e) {
        error_log("mos-product-names: could not tidy the name of $id: " . $e->getMessage());
    } finally {
        $GLOBALS['mos_names_running'] = false;
    }
}

add_action('woocommerce_new_product', static fn ($id) => mos_names_on_save((int) $id), 5);
add_action('woocommerce_update_product', static fn ($id) => mos_names_on_save((int) $id), 5);

/* ------------------------------------------------------------------------
 * 4. WP-CLI: wp mos-names preview | apply | mark | restore
 * --------------------------------------------------------------------- */

if (defined('WP_CLI') && WP_CLI) {
    /**
     * Tidy product names: capitals to ordinary case, extra spaces and repeated words out. Never the SKU, never the link.
     */
    class MOS_Names_CLI {
        /** @return list<array{0:int,1:string,2:string,3:string}> id, status, old, new: the names that would change */
        private function changes(): array {
            global $wpdb;
            [$vocab, $brands] = mos_names_context(true);
            $rows = $wpdb->get_results("SELECT ID, post_status, post_title FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status NOT IN ('trash', 'auto-draft') ORDER BY ID");
            $out = [];
            foreach ($rows as $row) {
                if (get_post_meta((int) $row->ID, MOS_NAMES_META, true) !== '') { continue; }   // handled before: staff's name stands
                $new = mos_names_simplify((string) $row->post_title, $vocab, $brands);
                if ($new !== (string) $row->post_title) { $out[] = [(int) $row->ID, (string) $row->post_status, (string) $row->post_title, $new]; }
            }
            return $out;
        }

        /** @return list<int> */
        private function product_ids(): array {
            global $wpdb;
            return array_map('intval', $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status NOT IN ('trash', 'auto-draft')"));
        }

        /** Every product a later save could reach, the bin included: a product restored from the bin is an existing
         *  product, not a new one. @return list<int> */
        private function markable_ids(): array {
            global $wpdb;
            return array_map('intval', $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'product' AND post_status <> 'auto-draft'"));
        }

        private function mark_all(): int {
            $n = 0;
            foreach ($this->markable_ids() as $id) {
                if (get_post_meta($id, MOS_NAMES_META, true) === '') { update_post_meta($id, MOS_NAMES_META, '1'); $n++; }
            }
            update_option(MOS_NAMES_LIVE_OPTION, '1', false);
            return $n;
        }

        /**
         * List the names that would change, old and new (tab-separated: id, status, old, new). Writes nothing.
         */
        public function preview($args, $assoc) {
            $changes = $this->changes();
            foreach ($changes as [$id, $status, $old, $new]) { WP_CLI::line("$id\t$status\t$old\t$new"); }
            WP_CLI::log(count($changes) . ' of ' . count($this->product_ids()) . ' names would change. Nothing was written.');
        }

        /**
         * Write the tidied names, with a journal for `restore`; then mark every product as handled and switch the
         * tidying of new products on. SKUs and links (slugs) are not touched.
         */
        public function apply($args, $assoc) {
            $changes = $this->changes();
            $dir = trailingslashit(wp_upload_dir()['basedir']) . MOS_NAMES_DIR;
            if (!wp_mkdir_p($dir)) { WP_CLI::error("Cannot create $dir"); }
            // A folder the web server will not list or serve (nginx ignores .htaccess: see DEPLOY.md).
            if (!file_exists("$dir/.htaccess")) { file_put_contents("$dir/.htaccess", "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n"); }
            if (!file_exists("$dir/index.php")) { file_put_contents("$dir/index.php", "<?php\n// Silence is golden.\n"); }
            $file = sprintf('%s/journal-%s-%s.json', $dir, gmdate('Ymd-His'), bin2hex(random_bytes(6)));
            $journal = ['version' => 2, 'started' => gmdate('c'), 'names' => []];
            foreach ($changes as [$id, , $old, $new]) { $journal['names'][$id] = ['old' => $old, 'new' => $new]; }
            if (file_put_contents($file, wp_json_encode($journal, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) === false) { WP_CLI::error("Cannot write the journal $file"); }
            $done = 0;
            $ids = [];
            foreach ($changes as [$id, , $old, $new]) {
                if (mos_names_write($id, $old, $new)) { $done++; $ids[] = $id; } else { WP_CLI::warning("product $id: name not written (renamed meanwhile, or a database error)"); }
            }
            $marked = $this->mark_all();
            delete_transient(MOS_NAMES_VOCAB_TRANSIENT);
            if ($ids) { do_action('mos_clean_filled', $ids); }   // the storefront poke hears of the changed products
            WP_CLI::success("$done names tidied, $marked products marked as handled. Journal: $file");
        }

        /**
         * Change no name: mark every existing product as handled and switch the tidying of new products on.
         */
        public function mark($args, $assoc) {
            WP_CLI::success($this->mark_all() . ' products marked as handled; new products are tidied from now on.');
        }

        /**
         * Put back the names a journal recorded. A name staff changed since is left alone and reported.
         *
         * ## OPTIONS
         *
         * <file>
         * : The journal (uploads/mos-names/journal-*.json).
         */
        public function restore($args, $assoc) {
            global $wpdb;
            $file = (string) ($args[0] ?? '');
            if ($file === '' || !is_file($file) || !is_readable($file)) { WP_CLI::error("Cannot read the journal: $file"); }
            $data = json_decode((string) file_get_contents($file), true);
            if (!is_array($data) || !in_array($data['version'] ?? 0, [1, 2], true) || !is_array($data['names'] ?? null)) { WP_CLI::error("Not a mos-names journal: $file"); }
            [$vocab, $brands] = mos_names_context(true);
            $done = 0;
            $ids = [];
            foreach ($data['names'] as $id => $entry) {
                $id = (int) $id;
                $post = get_post($id);
                // Version 2 records the name that was written; version 1 only the old one (the written name is then
                // worked out again, which a changed vocabulary can make differ: such a product is reported).
                $old = is_array($entry) ? ($entry['old'] ?? null) : $entry;
                if (!$post instanceof WP_Post || $post->post_type !== 'product' || !is_string($old)) { WP_CLI::warning("product $id: not restored (gone, or a bad entry)"); continue; }
                $written = is_array($entry) && is_string($entry['new'] ?? null) ? $entry['new'] : mos_names_simplify($old, $vocab, $brands);
                if ($post->post_title === $old) { continue; }
                if ($post->post_title !== $written) { WP_CLI::warning("product $id: renamed since (\"{$post->post_title}\"), left alone"); continue; }
                if ($wpdb->update($wpdb->posts, ['post_title' => $old], ['ID' => $id]) === false) { WP_CLI::warning("product $id: not restored"); continue; }
                mos_names_rename_variations($id, (string) $post->post_title, $old);
                clean_post_cache($id);
                $done++;
                $ids[] = $id;
            }
            delete_transient(MOS_NAMES_VOCAB_TRANSIENT);
            if ($ids) { do_action('mos_clean_filled', $ids); }
            WP_CLI::success("$done names put back.");
        }
    }
    WP_CLI::add_command('mos-names', 'MOS_Names_CLI');
}
