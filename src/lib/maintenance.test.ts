// The storefront's "closed for an update" switch (MOS_MAINTENANCE): who gets the notice, who gets in with the
// owner's preview key, and what stays reachable.
import { describe, expect, it } from 'vitest';
import { maintenanceDecision, maintenanceSettings, PREVIEW_PARAM } from './maintenance';

const KEY = 'a-long-preview-key-123';
const on = { enabled: true, key: KEY };
const ask = (over: Partial<Parameters<typeof maintenanceDecision>[1]> = {}) =>
  maintenanceDecision(on, { path: '/', queryKey: null, cookieKey: null, ...over });

describe('maintenanceSettings', () => {
  it('is off unless switched on', () => {
    expect(maintenanceSettings(undefined, undefined).enabled).toBe(false);
    expect(maintenanceSettings('0', KEY).enabled).toBe(false);
    expect(maintenanceSettings('', KEY).enabled).toBe(false);
    for (const v of ['1', 'true', 'on', ' TRUE ']) expect(maintenanceSettings(v, KEY).enabled).toBe(true);
  });

  it('ignores a preview key too short to be a secret', () => {
    expect(maintenanceSettings('1', 'short').key).toBeNull();
    expect(maintenanceSettings('1', undefined).key).toBeNull();
    expect(maintenanceSettings('1', ` ${KEY} `).key).toBe(KEY);
  });
});

describe('maintenanceDecision', () => {
  it('passes everything when the switch is off', () => {
    expect(maintenanceDecision({ enabled: false, key: KEY }, { path: '/gera-upp/', queryKey: null, cookieKey: null })).toBe('pass');
  });

  it('closes pages and API routes to a visitor without the key', () => {
    expect(ask()).toBe('closed');
    expect(ask({ path: '/verslun/' })).toBe('closed');
    expect(ask({ path: '/api/checkout' })).toBe('closed');
    expect(ask({ cookieKey: 'wrong-key-wrong-key-12' })).toBe('closed');
    expect(ask({ queryKey: 'wrong-key-wrong-key-12' })).toBe('closed');
  });

  it('keeps the notice itself and the health check reachable', () => {
    expect(ask({ path: '/vidhald/' })).toBe('pass');
    expect(ask({ path: '/api/healthz' })).toBe('pass');
    expect(ask({ path: '/_image' })).toBe('pass');
  });

  it('unlocks with the key in the address, then passes on the cookie', () => {
    expect(ask({ path: '/gera-upp/', queryKey: KEY })).toBe('unlock');
    expect(ask({ path: '/gera-upp/', cookieKey: KEY })).toBe('pass');
  });

  it('lets nobody in when no key is configured', () => {
    const noKey = { enabled: true, key: null };
    expect(maintenanceDecision(noKey, { path: '/', queryKey: '', cookieKey: '' })).toBe('closed');
    expect(maintenanceDecision(noKey, { path: '/', queryKey: 'null', cookieKey: null })).toBe('closed');
  });

  it('names the address parameter', () => {
    expect(PREVIEW_PARAM).toBe('forskodun');
  });
});
