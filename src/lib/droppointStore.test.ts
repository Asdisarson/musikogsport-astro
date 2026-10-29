// CO-03: a saved Pósturinn locker counts only once it is confirmed against the lockers Pósturinn lists now for the
// postcode. A retired one is cleared (the shopper chooses again), and checkout refuses without a confirmed locker.
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function fresh() {
  vi.resetModules();
  return import('./droppointStore');
}

describe('droppoint verification (CO-03)', () => {
  let s: Awaited<ReturnType<typeof fresh>>;
  beforeEach(async () => {
    s = await fresh();
  });

  it('a saved locker still in the fetched list is kept and confirmed', () => {
    s.setDroppoint({ postcode: '101', id: 'DPO1', name: 'Kringlan' });
    expect(s.postboxReady(s.droppoint.get(), s.verifiedDroppoint.get(), '101')).toBe(false); // not yet confirmed
    s.reconcileDroppoint('101', ['DPO0', 'DPO1']);
    expect(s.droppoint.get()?.id).toBe('DPO1');
    expect(s.postboxReady(s.droppoint.get(), s.verifiedDroppoint.get(), '101')).toBe(true);
  });

  it('a saved locker missing from the fetched list is cleared and blocks checkout', () => {
    s.setDroppoint({ postcode: '101', id: 'DPO-RETIRED', name: 'Gamalt' });
    s.reconcileDroppoint('101', ['DPO0', 'DPO1']);
    expect(s.droppoint.get()).toBeNull();
    expect(s.postboxReady(s.droppoint.get(), s.verifiedDroppoint.get(), '101')).toBe(false);
  });

  it('a locker saved for another postcode is left alone but does not count here', () => {
    s.setDroppoint({ postcode: '600', id: 'DPO6', name: 'Akureyri' });
    s.reconcileDroppoint('101', ['DPO0']);
    expect(s.droppoint.get()?.id).toBe('DPO6');
    expect(s.postboxReady(s.droppoint.get(), s.verifiedDroppoint.get(), '101')).toBe(false);
  });

  it('choosing from the list confirms at once; a new fetch (another postcode) unconfirms until it answers', () => {
    s.chooseDroppoint('101', { id: 'DPO1', name: 'Kringlan' });
    expect(s.postboxReady(s.droppoint.get(), s.verifiedDroppoint.get(), '101')).toBe(true);
    s.startDroppointCheck();
    expect(s.postboxReady(s.droppoint.get(), s.verifiedDroppoint.get(), '101')).toBe(false);
    s.chooseDroppoint('101', null);
    expect(s.droppoint.get()).toBeNull();
  });

  it('a verified id that no longer matches the chosen locker does not count', () => {
    s.chooseDroppoint('101', { id: 'DPO1', name: 'Kringlan' });
    expect(s.postboxReady({ postcode: '101', id: 'DPO2', name: 'x' }, s.verifiedDroppoint.get(), '101')).toBe(false);
  });
});
