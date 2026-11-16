// /min-sida/edit-account/: what saving the form answers. A refusal comes back as a message for one field or as a
// notice, never as a redirect that would empty the form.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
const requestToken = vi.fn();
const verifiedUser = vi.fn();
const setAuth = vi.fn();
const clearAuth = vi.fn();
const invalidateUser = vi.fn();
vi.mock('./auth', () => ({
  requestToken: (...a: unknown[]) => requestToken(...a),
  verifiedUser: (...a: unknown[]) => verifiedUser(...a),
  setAuth: (...a: unknown[]) => setAuth(...a),
  clearAuth: (...a: unknown[]) => clearAuth(...a),
  invalidateUser: (...a: unknown[]) => invalidateUser(...a),
  rememberedSession: () => true,
}));
const updateCustomer = vi.fn();
vi.mock('./account', () => ({ updateCustomer: (...a: unknown[]) => updateCustomer(...a) }));

const { saveDetails } = await import('./accountDetails');
const cookies = {} as never;
const names = { first: 'Anna', last: 'Jónsdóttir', email: 'anna@b.is', current: '', next: '', confirm: '' };
const change = { ...names, current: 'gamalt-lykilord', next: 'nytt-lykilord', confirm: 'nytt-lykilord' };
let id = 100;
const user = () => ({ id: ++id, email: 'anna@b.is' }) as never;

beforeEach(() => {
  for (const m of [requestToken, verifiedUser, setAuth, clearAuth, invalidateUser, updateCustomer]) m.mockReset();
  updateCustomer.mockResolvedValue({});
});

describe('saveDetails', () => {
  it('saves name and e-mail without asking for a password', async () => {
    const u = user();
    expect(await saveDetails(u, cookies, names)).toEqual({ redirect: '/min-sida/edit-account/?saved=1' });
    expect(updateCustomer).toHaveBeenCalledWith(id, { first_name: 'Anna', last_name: 'Jónsdóttir', email: 'anna@b.is' });
    expect(requestToken).not.toHaveBeenCalled();
    expect(invalidateUser).toHaveBeenCalledWith(id);
  });

  it('returns the field problems and saves nothing', async () => {
    const out = await saveDetails(user(), cookies, { ...names, email: 'anna@b' });
    expect('problems' in out && Object.fromEntries(out.problems)).toEqual({ account_email: 'Ógilt netfang.' });
    expect(updateCustomer).not.toHaveBeenCalled();
  });

  it('puts a wrong current password at that field', async () => {
    requestToken.mockResolvedValue({ error: 'rejected' });
    const out = await saveDetails(user(), cookies, change);
    expect('problems' in out && Object.fromEntries(out.problems)).toEqual({ password_current: 'Núverandi lykilorð er rangt.' });
    expect(updateCustomer).not.toHaveBeenCalled();
  });

  it('stops after five wrong current passwords', async () => {
    requestToken.mockResolvedValue({ error: 'rejected' });
    const u = user();
    for (let i = 0; i < 5; i++) await saveDetails(u, cookies, change);
    expect(await saveDetails(u, cookies, change)).toEqual({ notice: 'Of margar tilraunir. Reyndu aftur síðar.' });
    expect(requestToken).toHaveBeenCalledTimes(5);
  });

  it('says so when WordPress could not check the password, without counting it as a wrong guess', async () => {
    requestToken.mockResolvedValue({ error: 'unavailable' });
    const u = user();
    for (let i = 0; i < 7; i++) {
      expect(await saveDetails(u, cookies, change)).toEqual({
        notice: 'Ekki tókst að staðfesta lykilorðið: þjónustan svaraði ekki. Reyndu aftur eftir smá stund.',
      });
    }
  });

  it('changes the password and signs this browser in again', async () => {
    requestToken.mockResolvedValue({ token: 'new.tok.en' });
    expect(await saveDetails(user(), cookies, change)).toEqual({ redirect: '/min-sida/edit-account/?saved=1' });
    expect(updateCustomer).toHaveBeenCalledWith(id, expect.objectContaining({ password: 'nytt-lykilord' }));
    expect(setAuth).toHaveBeenCalledWith(cookies, 'new.tok.en', true);
  });

  it('sends the customer to sign in when the change saved but no new token came', async () => {
    requestToken.mockResolvedValueOnce({ token: 'old' }).mockResolvedValue({ error: 'rejected' });
    expect(await saveDetails(user(), cookies, change)).toEqual({ redirect: '/min-sida/?login=changed' });
    expect(clearAuth).toHaveBeenCalled();
  });

  it('reports a refused save as a notice', async () => {
    updateCustomer.mockRejectedValue(new Error('400'));
    expect(await saveDetails(user(), cookies, names)).toEqual({ notice: 'Ekki tókst að vista breytingarnar. Reyndu aftur.' });
  });

  it('after a timed-out password change, checks whether it applied', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    updateCustomer.mockRejectedValue(timeout);
    requestToken.mockResolvedValueOnce({ token: 'old' }).mockResolvedValueOnce({ error: 'rejected' });
    const u = user();
    expect(await saveDetails(u, cookies, change)).toEqual({
      notice: 'Ekki fékkst staðfesting á vistuninni. Ef þú verður skráð(ur) út skaltu skrá þig inn með nýja lykilorðinu.',
    });
    requestToken.mockReset();
    requestToken.mockResolvedValueOnce({ token: 'old' }).mockResolvedValueOnce({ token: 'applied' });
    verifiedUser.mockResolvedValue({ id });
    expect(await saveDetails(u, cookies, change)).toEqual({ redirect: '/min-sida/edit-account/?saved=1' });
    expect(setAuth).toHaveBeenCalledWith(cookies, 'applied', true);
  });
});
