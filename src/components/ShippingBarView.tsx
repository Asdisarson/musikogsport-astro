import { formatISK } from '../lib/format';
import { freeShippingProgress, shippingBarMessage, type ShippingBar } from '../lib/shippingBar';

// Live's free-shipping progress bar (Goya): message, then a rail with the filled share, a dot and the percent.
// `bar` comes from WordPress (sanitized server-side); `subtotal` is in whole krónur.
export default function ShippingBarView({ bar, subtotal }: { bar: ShippingBar; subtotal: number }) {
  const progress = freeShippingProgress(subtotal, bar.goal);
  const html = shippingBarMessage(bar, progress, formatISK);
  return (
    <div className="ship-bar" style={{ '--bar-color': bar.color } as React.CSSProperties} data-reached={progress.reached ? 'true' : undefined}>
      <div className="ship-bar__message" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="ship-bar__rail" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label="Frí sending">
        <span className="ship-bar__status" style={{ minWidth: `${progress.percent}%` }}>
          <span className="ship-bar__dot" />
          <span className="ship-bar__percent">{progress.percent}%</span>
        </span>
        <span className="ship-bar__left" />
      </div>
    </div>
  );
}
