<?php
/**
 * Where seed-live-clone.php may download a spec image from when the spec carries no local copy. Pure (no WordPress),
 * so tests/mos_seed_image_source_test.php can load it on its own.
 */

declare(strict_types=1);

/** The live store's own hosts: the only places a seed run fetches images from. */
const MOS_SEED_IMAGE_HOSTS = ['musikogsport.is', 'www.musikogsport.is'];

/**
 * Whether the seed script may download this image URL: https, one of the allowed hosts exactly (no port, no
 * credentials), and a path ending in an image extension.
 *
 * @param list<string> $hosts
 */
function mos_seed_image_download_allowed(string $url, array $hosts = MOS_SEED_IMAGE_HOSTS): bool {
    $parts = parse_url($url);
    if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https') { return false; }
    if (isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])) { return false; }
    if (!in_array(strtolower((string) ($parts['host'] ?? '')), $hosts, true)) { return false; }
    return preg_match('/\.(?:png|jpe?g|webp|gif|avif)$/i', (string) ($parts['path'] ?? '')) === 1;
}
