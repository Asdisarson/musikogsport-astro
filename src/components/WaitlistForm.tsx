import { useState } from 'react';

interface Props {
  productId: number;
  variationId?: number;
}

// Map the StoreDash response codes to Icelandic copy (the plugin returns English).
const MESSAGES: Record<string, string> = {
  subscribed: 'Takk! Við látum þig vita þegar varan er aftur komin á lager.',
  already_subscribed: 'Þú ert nú þegar á biðlista fyrir þessa vöru.',
  invalid_email: 'Sláðu inn gilt netfang.',
  invalid_product: 'Ógild vara.',
  product_not_found: 'Varan fannst ekki.',
  in_stock: 'Þessi vara er til á lager.',
  insert_failed: 'Ekki tókst að skrá þig. Reyndu aftur.',
  server_error: 'Villa kom upp. Reyndu aftur.',
};

type State = 'idle' | 'sending' | 'done' | 'error';

export default function WaitlistForm({ productId, variationId }: Props) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');

  async function submit() {
    if (!email) return;
    setState('sending');
    setMessage('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, variation_id: variationId ?? 0, email }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; code?: string; message?: string } | null;
      const msg = (data?.code && MESSAGES[data.code]) || data?.message || 'Villa kom upp. Reyndu aftur.';
      if (data?.ok) {
        setState('done');
        setMessage(msg);
      } else {
        setState('error');
        setMessage(msg);
      }
    } catch {
      setState('error');
      setMessage('Villa kom upp. Reyndu aftur.');
    }
  }

  if (state === 'done') {
    return (
      <div className="waitlist waitlist--done">
        <p role="status">{message}</p>
      </div>
    );
  }

  return (
    <div className="waitlist">
      <p className="waitlist__lead">Uppselt — fáðu tilkynningu þegar varan kemur aftur á lager.</p>
      <form
        className="waitlist__form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === 'error') setState('idle');
          }}
          placeholder="Netfangið þitt"
          aria-label="Netfang fyrir biðlista"
        />
        <button type="submit" className="btn btn--primary" disabled={state === 'sending'}>
          {state === 'sending' ? 'Skrái…' : 'Láta vita'}
        </button>
      </form>
      {state === 'error' && (
        <p className="form-error" role="alert">{message}</p>
      )}
    </div>
  );
}
