import { describe, expect, it, vi } from 'vitest';
import { allowedDomains } from './allowedHosts.mjs';

const BASE = [
  { protocol: 'https', hostname: 'musikogsport.is' },
  { protocol: 'https', hostname: 'www.musikogsport.is' },
];

describe('allowedDomains', () => {
  it('is the two production hosts when nothing extra is set', () => {
    expect(allowedDomains(undefined)).toEqual(BASE);
    expect(allowedDomains('')).toEqual(BASE);
  });

  it('adds exact extra hosts (the App Platform default domain), https only', () => {
    expect(allowedDomains('musikogsport-abc12.ondigitalocean.app')).toEqual([
      ...BASE,
      { protocol: 'https', hostname: 'musikogsport-abc12.ondigitalocean.app' },
    ]);
    expect(allowedDomains(' Staging.Example.com , other.example.com ')).toEqual([
      ...BASE,
      { protocol: 'https', hostname: 'staging.example.com' },
      { protocol: 'https', hostname: 'other.example.com' },
    ]);
  });

  it('skips duplicates of hosts already allowed', () => {
    expect(allowedDomains('musikogsport.is,musikogsport.is')).toEqual(BASE);
  });

  it('refuses wildcards, schemes, ports, paths and unresolved placeholders (warns, never trusts them)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['*.ondigitalocean.app', '**.example.com', 'https://a.example.com', 'a.example.com:8080', 'a.example.com/x', '${APP_DOMAIN}', 'localhost']) {
      expect(allowedDomains(bad)).toEqual(BASE);
    }
    expect(warn).toHaveBeenCalledTimes(7);
    warn.mockRestore();
  });
});
