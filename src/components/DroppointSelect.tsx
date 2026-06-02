import { useEffect, useId, useState } from 'react';
import { useStore } from '@nanostores/react';
import { droppoint, setDroppoint } from '../lib/droppointStore';

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
export default function DroppointSelect({ postcode }: Props) {
  const chosen = useStore(droppoint);
  const selectId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!/^\d{3}$/.test(postcode)) {
      setItems([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr(null);
    fetch(`/api/posturinn/droppoints?postcode=${postcode}&type=postbox`, {
      signal: AbortSignal.timeout(12000),
    })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setItems(Array.isArray(d?.items) ? d.items : []);
      })
      .catch(() => {
        if (alive) setErr('Gat ekki sótt póstbox. Reyndu aftur.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [postcode]);

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
          const id = e.target.value;
          const it = items.find((x) => x.id === id);
          setDroppoint(id && it ? { postcode, id, name: it.name } : null);
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
          {err}
        </p>
      )}
    </div>
  );
}
