// Stable short key for a dismissible message: dismissal is remembered per text, so editing the
// message in wp-admin shows it again (as WooCommerce's store notice does). Pure.
export function messageKey(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
