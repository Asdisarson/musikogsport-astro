// DEPLOY.md must agree with the code it describes (ship review SR-02): the storefront WRITES to WooCommerce's REST
// API (lib/account: PUT /orders/<id> to put an order on the account, PUT /customers/<id> for the address and account
// forms), so a Read-only key would break those quietly. (The App Platform spec, .do/app.yaml, which this also
// checked against DEPLOY.md, was removed from the repo on 2026-11-20.)
import { describe, expect, it } from 'vitest';
import deploy from '../../DEPLOY.md?raw';
import account from './account.ts?raw';

describe('deploy docs', () => {
  it('the code does write through the REST key (the premise of the next test)', () => {
    expect(account).toMatch(/wooSend(<.*>)?\('PUT', `\/orders\//);
    expect(account).toMatch(/wooSend\('PUT', `\/customers\//);
  });

  it('asks for a Read/Write REST key, never a Read-only one', () => {
    expect(deploy).toMatch(/Read\/Write/);
    expect(deploy).not.toMatch(/\*\*Read\*\*\s+(WooCommerce\s+)?(REST\s+)?(key|permission)/i);
  });
});
