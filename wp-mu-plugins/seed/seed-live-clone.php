<?php
/**
 * Seed the ACF "Forsíða" fields with live musikogsport.is's current homepage content.
 *
 * Run once with WP-CLI (not a mu-plugin; lives here for version tracking):
 *   wp eval-file wp-mu-plugins/seed/seed-live-clone.php /path/to/spec.json
 *
 * spec.json is produced from a saved copy of live's homepage HTML; each image entry carries `image_url` and,
 * optionally, `file`, a local copy of the image. Without a local copy the image is downloaded from `image_url`,
 * over https from the live store's own hosts only (seed-image-source.php). Images are imported into the media
 * library once and reused on re-runs (matched on the `_mos_seed_source` meta). Re-running overwrites the field values.
 */

declare(strict_types=1);

if (!defined('ABSPATH') || !defined('WP_CLI')) { exit; }

// Destructive on re-run; production content is edited by hand. MOS_SEED_FORCE=1 overrides on purpose (MU-18).
if (wp_get_environment_type() === 'production' && getenv('MOS_SEED_FORCE') !== '1') {
    WP_CLI::error('Refusing to seed a production site. Set MOS_SEED_FORCE=1 to run it anyway.');
}

require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/image.php';
require_once __DIR__ . '/seed-image-source.php';

$spec_path = $args[0] ?? '';
$spec = is_readable($spec_path) ? json_decode((string) file_get_contents($spec_path), true) : null;
if (!is_array($spec)) {
    WP_CLI::error('Pass the path to spec.json as the first argument.');
}

$page_id = (int) get_option('page_on_front');
if ($page_id <= 0) {
    WP_CLI::error('No static front page is configured (page_on_front).');
}

/** Import an image once; returns the attachment ID or 0. An image imported on an earlier run (same source URL) is
 *  reused. Otherwise the local file is imported, or, when the spec has none, the image is downloaded from its
 *  source URL if that is one of the live store's own (mos_seed_image_download_allowed). */
$import = static function (?string $file, string $source_url): int {
    if ($source_url !== '') {
        $existing = get_posts([
            'post_type' => 'attachment', 'post_status' => 'inherit', 'fields' => 'ids', 'numberposts' => 1,
            'meta_key' => '_mos_seed_source', 'meta_value' => $source_url,
        ]);
        if ($existing) { return (int) $existing[0]; }
    }
    if ($file && is_readable($file)) {
        $name = basename($file);
        $tmp = wp_tempnam($name);
        copy($file, $tmp);
    } elseif (mos_seed_image_download_allowed($source_url)) {
        $name = basename((string) parse_url($source_url, PHP_URL_PATH));
        $tmp = download_url($source_url, 30);
        if (is_wp_error($tmp)) {
            WP_CLI::warning("Image download failed for $source_url: " . $tmp->get_error_message());
            return 0;
        }
    } else {
        if ($source_url !== '') { WP_CLI::warning("No local file, and not a store image to download: $source_url"); }
        return 0;
    }
    $id = media_handle_sideload(['name' => $name, 'tmp_name' => $tmp], 0);
    if (is_wp_error($id)) {
        @unlink($tmp);
        WP_CLI::warning("Image import failed for $name: " . $id->get_error_message());
        return 0;
    }
    update_post_meta($id, '_mos_seed_source', $source_url);
    return (int) $id;
};

$set = static function (string $name, $value) use ($page_id): void {
    update_field('field_mos_' . $name, $value, $page_id);
};

/** Set an image field from a spec entry. With no image to import the current one is kept (a re-run
 *  without the local files must not blank the homepage). */
$set_image = static function (string $name, array $entry) use ($import, $set): void {
    $id = $import($entry['file'] ?? null, (string) ($entry['image_url'] ?? ''));
    if ($id > 0) {
        $set($name, $id);
        return;
    }
    WP_CLI::log("{$name}: no image to import, keeping the current one.");
};

$set('campaign_text', (string) ($spec['campaign_text'] ?? ''));
$set('campaign_text_right', (string) ($spec['campaign_text_right'] ?? ''));
$set('store_notice', (string) ($spec['store_notice'] ?? ''));
foreach (['site_logo', 'footer_logo'] as $logo) {
    $entry = (array) ($spec[$logo] ?? []);
    $set_image($logo, $entry);
}
$set('hero_heading', (string) ($spec['hero_heading'] ?? ''));
$set('hero_text', (string) ($spec['hero_text'] ?? ''));

foreach (array_values((array) ($spec['hero_buttons'] ?? [])) as $i => $button) {
    $n = $i + 1;
    $set("hero_button_{$n}_label", (string) ($button['label'] ?? ''));
    $set("hero_button_{$n}_link", (string) ($button['link'] ?? ''));
}

foreach (array_values((array) ($spec['hero_slides'] ?? [])) as $i => $slide) {
    $n = $i + 1;
    $product = get_page_by_path((string) ($slide['product_slug'] ?? ''), OBJECT, 'product');
    if (!$product) {
        WP_CLI::warning("Hero slide {$n}: product '{$slide['product_slug']}' does not exist locally (post-May?) — slot left empty.");
    }
    $set("hero_slide_{$n}_product", $product ? (int) $product->ID : null);
    $set_image("hero_slide_{$n}_image", (array) $slide);
}

foreach (array_values((array) ($spec['rows'] ?? [])) as $i => $row) {
    $n = $i + 1;
    $set("row_{$n}_title", (string) ($row['title'] ?? ''));
    $set("row_{$n}_source", (string) ($row['source'] ?? 'newest'));
    $set("row_{$n}_count", (int) ($row['count'] ?? 10));
    $set("row_{$n}_category", null);
}

foreach (array_values((array) ($spec['banners'] ?? [])) as $i => $banner) {
    $n = $i + 1;
    $set("banner_{$n}_title", (string) ($banner['title'] ?? ''));
    $set("banner_{$n}_link", (string) ($banner['link'] ?? ''));
    $set_image("banner_{$n}_image", (array) $banner);
}

$footer = (array) ($spec['footer'] ?? []);
foreach (['address', 'directions_label', 'directions_link', 'email', 'phone', 'company_line'] as $key) {
    $set("footer_{$key}", (string) ($footer[$key] ?? ''));
}

update_option('mos_seed_live_clone', gmdate('c'), false);
WP_CLI::success("Seeded the Forsíða fields on page {$page_id}.");
