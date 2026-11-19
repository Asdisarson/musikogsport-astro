// The body of POST /api/shell-refresh (wp-mu-plugins/mos-shell-poke.php): storefront paths to mark stale, paths to
// drop, whether the listings are stale, and whether every product is (a bulk change: one mark, not a list).
// Pure; SERVER-ONLY by use. Strict on purpose: without MOS_SHELL_POKE_KEY the route needs no secret, so the only
// thing a stranger can do is mark a page stale (it keeps being served) or drop one (it is rendered again on the next
// request), for paths of this shape, and only within a budget of path actions (src/pages/api/shell-refresh.ts).
import { createHash, timingSafeEqual } from 'node:crypto';

export const MAX_POKE_PATHS = 50;
export const MAX_POKE_BYTES = 16 * 1024;
const MAX_PATH = 200;
/** /vara/<slug>/ or /verslun/<category>/…/<slug>/: lower-case letters (Icelandic included), digits, '-' and '_'. */
const PATH = /^\/(vara|verslun)(\/[\p{Ll}\p{N}_-]+)+\/$/u;

export interface ShellPoke {
  stale: string[];
  drop: string[];
  listings: boolean;
  products: boolean;
}

function pathList(v: unknown): string[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_POKE_PATHS) return null;
  const out = new Set<string>();
  for (const p of v) {
    if (typeof p !== 'string') return null;
    // An over-long path is skipped, not refused: the other paths of the poke still count.
    if (p.length > MAX_PATH) continue;
    if (!PATH.test(p)) return null;
    out.add(p);
  }
  return [...out];
}

/** The poke, or null when the body is not one of this shape. */
export function parseShellPoke(body: unknown): ShellPoke | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const stale = pathList(b.stale);
  const drop = pathList(b.drop);
  if (!stale || !drop) return null;
  if (b.listings !== undefined && typeof b.listings !== 'boolean') return null;
  if (b.products !== undefined && typeof b.products !== 'boolean') return null;
  return { stale, drop, listings: b.listings === true, products: b.products === true };
}

/** The request body as text, or null when it is larger than `max` bytes. The length is checked before the body is
 *  read, and the stream is cut off at the cap (a chunked body has no length to check). */
export async function readCappedBody(request: Request, max: number = MAX_POKE_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) {
    await request.body?.cancel();
    return null;
  }
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Whether the poke's shared key (MOS_SHELL_POKE_KEY, sent by WordPress in X-Mos-Shell-Key) is the one configured.
 *  Both sides are hashed first, so the comparison takes the same time whatever the guess. */
export function pokeKeyMatches(header: string | null, key: string): boolean {
  if (!header) return false;
  const a = createHash('sha256').update(header).digest();
  const b = createHash('sha256').update(key).digest();
  return timingSafeEqual(a, b);
}
