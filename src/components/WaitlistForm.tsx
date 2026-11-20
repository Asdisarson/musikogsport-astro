import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

// The product page's back-in-stock sign-up, shown by ProductPurchase in place of the quantity box and "Setja í körfu"
// once the live answer says the choice is sold out. `productId` is the exact product whose waitlist is joined: a
// variation's own id, or a simple product's. Posts to /api/waitlist; ProductPurchase keys it by that id, so another
// choice starts afresh. A visitor's address gets a confirmation mail first (the answer's `confirm`); a signed-in
// customer's own address is listed at once, and the field starts with it (GET /api/waitlist, asked only when the
// `mos_li` cookie says there is a session: the page itself is shared between visitors).

const FAILED = 'Ekki tókst að skrá á biðlista. Reyndu aftur síðar.';

export default function WaitlistForm({ productId }: { productId: number }) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'listed' | 'mailed' | null>(null);
  const typed = useRef(false);

  useEffect(() => {
    if (!/(?:^|;\s*)mos_li=/.test(document.cookie)) return;
    const stop = new AbortController();
    fetch('/api/waitlist', { headers: { Accept: 'application/json' }, signal: stop.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { email?: unknown } | null) => {
        if (typeof data?.email === 'string' && data.email && !typed.current) setEmail(data.email);
      })
      .catch(() => {});   // no address to start with: the field stays empty
    return () => stop.abort();
  }, []);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, productId, website: trap }),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: unknown; confirm?: unknown; message?: unknown };
      if (res.ok && data.ok === true) setDone(data.confirm === false ? 'listed' : 'mailed');
      else setErr(typeof data.message === 'string' && data.message ? data.message : FAILED);
    } catch {
      setErr(FAILED);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="pdp-waitlist__done" role="status">
        {done === 'listed'
          ? 'Þú ert á biðlista. Við sendum þér póst þegar varan kemur aftur.'
          : 'Við sendum þér póst. Smelltu á hlekkinn í honum til að staðfesta skráninguna á biðlistann.'}
      </p>
    );
  }
  return (
    <form className="pdp-waitlist" onSubmit={submit}>
      <p className="pdp-waitlist__lead">Fáðu póst þegar varan kemur aftur á lager.</p>
      <label className="pdp-waitlist__field" htmlFor={id}>
        Netfang
        <input id={id} type="email" name="email" autoComplete="email" required maxLength={200} value={email} onChange={(e) => { typed.current = true; setEmail(e.target.value); }} aria-describedby={err ? `${id}-err` : undefined} aria-invalid={err ? true : undefined} />
      </label>
      {/* a field people never see; only a script fills it */}
      <div className="pdp-waitlist__trap" aria-hidden="true">
        <label>
          Vefsíða
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </label>
      </div>
      <button type="submit" className="pdp-atc" disabled={busy} aria-busy={busy}>
        Skrá á biðlista
      </button>
      {err && <p className="form-error" role="alert" id={`${id}-err`}>{err}</p>}
      <p className="pdp-waitlist__note">
        Netfangið er aðeins notað til að láta þig vita. <a href="/personuvernd/">Persónuvernd</a>
      </p>
    </form>
  );
}
