import { useEffect, useId, useState } from 'react';
import { useStore } from '@nanostores/react';
import { chooseDroppoint, droppoint, reconcileDroppoint, startDroppointCheck } from '../lib/droppointStore';

interface Item {
  id: string;
  name: string;
}
interface Props {
  postcode: string;
}

// Parcel-locker (Pósturinn Pakki Póstbox) chooser. Rendered only when a postbox
// shipping rate is selected. Fetches the lockers for the postcode and persists the
// choice (shared cart ↔ checkout) so checkout can submit postis_dpo_postbox.
// A saved locker counts only once it is found in the list fetched now (CO-03): a retired one is cleared, and
// checkout asks for a locker while the list is loading or failed to load.
export default function DroppointSelect({ postcode }: Props) {
  const chosen = useStore(droppoint);
  const selectId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Bumped by "Reyna aftur": a failed fetch is asked again without the shopper changing postcode or shipping rate.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!/^\d{3}$/.test(postcode)) {
      setItems([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr(null);
    startDroppointCheck();
    fetch(`/api/posturinn/droppoints?postcode=${postcode}&type=postbox`, {
      signal: AbortSignal.timeout(12000),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`droppoints ${r.status}`); // an outage isn't "no lockers here"
        return r.json();
      })
      .then((d) => {
        if (!alive) return;
        const list: Item[] = Array.isArray(d?.items) ? d.items : [];
        setItems(list);
        reconcileDroppoint(postcode, list.map((x) => x.id));
      })
      .catch(() => {
        if (alive) setErr('Gat ekki sótt póstbox.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [postcode, attempt]);

  // A chosen locker is valid only for the postcode it was picked for.
  const value = chosen && chosen.postcode === postcode ? chosen.id : '';

  return (
    <div className="droppoint">
      <label className="droppoint__label" htmlFor={selectId}>
        Veldu póstbox *
      </label>
      <select
        id={selectId}
        className="select droppoint__select"
        value={value}
        disabled={loading || items.length === 0}
        onChange={(e) => {
          const it = items.find((x) => x.id === e.target.value);
          chooseDroppoint(postcode, it ?? null);
        }}
      >
        <option value="">
          {loading ? 'Sæki póstbox…' : items.length === 0 ? 'Engin póstbox fundust' : '— Veldu póstbox —'}
        </option>
        {items.map((it) => (
          <option key={it.id} value={it.id}>
            {it.name}
          </option>
        ))}
      </select>
      {err && (
        <p className="form-error" role="alert">
          {err}{' '}
          <button type="button" className="link-button" disabled={loading} onClick={() => setAttempt((n) => n + 1)}>
            Reyna aftur
          </button>
        </p>
      )}
    </div>
  );
}
