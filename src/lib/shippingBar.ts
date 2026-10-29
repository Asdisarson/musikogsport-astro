// Live's free-shipping progress bar (Goya "progress bar" in the mini cart and on /karfa/). The goal,
// messages and colour come from WordPress (Goya theme mods) through the site-chrome endpoint.

export interface ShippingBar {
  goal: number;
  /** Admin HTML with Goya's [missing_amount] placeholder (sanitized server-side). */
  message: string;
  success: string;
  color: string;
  locations: string[];
}

export interface ShippingProgress {
  percent: number;
  remaining: number;
  reached: boolean;
}

/** Percent is floored like Goya's (1.990 / 20.000 → 9%). A goal of 0 means the bar is off. */
export function freeShippingProgress(subtotal: number, goal: number): ShippingProgress {
  if (!(goal > 0)) return { percent: 0, remaining: 0, reached: false };
  if (subtotal >= goal) return { percent: 100, remaining: 0, reached: true };
  return { percent: Math.floor((Math.max(0, subtotal) / goal) * 100), remaining: goal - Math.max(0, subtotal), reached: false };
}

export function shippingBarMessage(
  bar: Pick<ShippingBar, 'message' | 'success'>,
  progress: ShippingProgress,
  format: (amount: number) => string,
): string {
  if (progress.reached) return bar.success;
  return bar.message.replace('[missing_amount]', `<span class="amount">${format(progress.remaining)}</span>`);
}
