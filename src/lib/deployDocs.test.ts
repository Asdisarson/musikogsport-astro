// DEPLOY.md and .do/app.yaml must agree with the code they describe (ship review SR-02): the storefront WRITES to
// WooCommerce's REST API (lib/account: PUT /orders/<id> to put an order on the account, PUT /customers/<id> for the
// address and account forms), so a Read-only key would break those quietly; and every variable in the app spec has to
// be explained in DEPLOY.md.
import { describe, expect, it } from 'vitest';
import deploy from '../../DEPLOY.md?raw';
import spec from '../../.do/app.yaml?raw';
import account from './account.ts?raw';

describe('deploy docs', () => {
  it('the code does write through the REST key (the premise of the next test)', () => {
    expect(account).toMatch(/wooSend(<.*>)?\('PUT', `\/orders\//);
    expect(account).toMatch(/wooSend\('PUT', `\/customers\//);
  });

  it('asks for a Read/Write REST key, never a Read-only one', () => {
    expect(deploy).toMatch(/Read\/Write/);
    expect(deploy).not.toMatch(/\*\*Read\*\*\s+(WooCommerce\s+)?(REST\s+)?(key|permission)/i);
    expect(spec).not.toMatch(/read-only WooCommerce REST key/i);
  });

  it('documents every variable of the app spec in DEPLOY.md', () => {
    const keys = [...spec.matchAll(/^\s*- key: (\w+)/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(8);
    for (const key of keys) expect(deploy, key).toContain(`\`${key}\``);
  });
});
