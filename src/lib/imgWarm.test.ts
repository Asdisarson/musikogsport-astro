// The photo warm-up of a nightly run: which /img/ addresses a rendered page asks for, and the bounded pass that keeps them.
// The file system and the conversion are replaced; nothing is written.
import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://media.test' }));
import { NOT_ATTEMPTED, createSlots, lightRequestsIn, warmPhotos, type WarmDeps } from './imgWarm';
import { LIGHT_VERSION } from './img';
import { cachePathFor, type LightRequest } from './imgConvert';

const DIR = '/cache/v2';

function deps(over: Partial<WarmDeps> & { kept?: string[]; fail?: string[] } = {}): WarmDeps & { converted: string[] } {
  const kept = new Set(over.kept ?? []);
  const fail = new Set(over.fail ?? []);
  const converted: string[] = [];
  return {
    dir: DIR,
    stat: async (file) => kept.has(file),
    convert: async (req) => {
      const file = cachePathFor(DIR, req.width, req.format, req.rel, req.crop);
      if (fail.has(req.rel)) throw new Error('boom');
      converted.push(req.rel);
      kept.add(file);
    },
    stop: () => false,
    parallel: 2,
    ...over,
    converted,
  };
}

describe('lightRequestsIn', () => {
  it('finds the src and srcset addresses of the current version, both formats and the phone crop', () => {
    const html = `
      <img src="/img/720/webp/${LIGHT_VERSION}/2026/04/a.jpg" srcset="/img/360/avif/${LIGHT_VERSION}/2026/04/a.jpg 360w, /img/1080c/webp/${LIGHT_VERSION}/2026/04/a.jpg 1080w">`;
    const got = lightRequestsIn(html).map((r) => `${r.width}${r.crop ? 'c' : ''}/${r.format}/${r.rel}`);
    expect(got.sort()).toEqual(['1080c/webp/2026/04/a.jpg', '360/avif/2026/04/a.jpg', '720/webp/2026/04/a.jpg'].sort());
  });

  it('skips the addresses of another version, and any address the endpoint would not serve', () => {
    const html = `/img/720/webp/v1/2026/04/a.jpg /img/721/webp/${LIGHT_VERSION}/2026/04/a.jpg /img/720/gif/${LIGHT_VERSION}/2026/04/a.jpg /img/720/webp/${LIGHT_VERSION}/../x.jpg`;
    expect(lightRequestsIn(html)).toEqual([]);
  });

  it('de-duplicates an address that the page names twice', () => {
    const u = `/img/450/webp/${LIGHT_VERSION}/2026/04/b.png`;
    expect(lightRequestsIn(`<img src="${u}"><img src="${u}">`)).toHaveLength(1);
  });

  it('reads a percent-encoded address as the route does: the decoded path, so the same kept file', () => {
    const html = `<img src="/img/720/avif/${LIGHT_VERSION}/2024/01/Sk%C3%B3r%20a.jpg">`;
    const [req] = lightRequestsIn(html);
    expect(req).toEqual({ width: 720, format: 'avif', rel: '2024/01/Skór a.jpg' });
    // the route gets ctx.params.path decoded by Astro: the kept file it reads is the one the warm-up wrote
    const routeRel = `2024/01/${decodeURIComponent('Sk%C3%B3r%20a.jpg')}`;
    expect(cachePathFor(DIR, 720, 'avif', req.rel)).toBe(cachePathFor(DIR, 720, 'avif', routeRel));
  });

  it('reads an HTML-escaped address as the page meant it: a file name with & is requested under the name with &', () => {
    // the attribute text is HTML-escaped: a & in the file name is &amp; in the markup
    const html = `<img srcset="/img/720/webp/${LIGHT_VERSION}/2024/01/a&amp;b.jpg 720w">`;
    expect(lightRequestsIn(html)).toEqual([{ width: 720, format: 'webp', rel: '2024/01/a&b.jpg' }]);
  });

  it('unescapes the entities once, in one pass: &amp;lt; is the text &lt;, not <', () => {
    const html = `<img src="/img/720/webp/${LIGHT_VERSION}/2024/01/x&amp;lt;y.jpg">`;
    expect(lightRequestsIn(html).map((r) => r.rel)).toEqual(['2024/01/x&lt;y.jpg']);
  });

  it('skips one address whose percent-encoding is malformed, and keeps the others', () => {
    const html = `/img/720/webp/${LIGHT_VERSION}/2024/01/bad%E0%A4%A.jpg /img/720/webp/${LIGHT_VERSION}/2024/01/ok.jpg`;
    expect(lightRequestsIn(html).map((r) => r.rel)).toEqual(['2024/01/ok.jpg']);
  });

  it('reads nothing from a page with no photo addresses', () => {
    expect(lightRequestsIn('<html>ekkert hér</html>')).toEqual([]);
  });
});

describe('warmPhotos', () => {
  const reqs = () => lightRequestsIn(`/img/360/webp/${LIGHT_VERSION}/2026/04/a.jpg /img/360/webp/${LIGHT_VERSION}/2026/04/b.jpg /img/360/webp/${LIGHT_VERSION}/2026/04/c.jpg`);

  it('converts what is not kept yet and counts what is kept already', async () => {
    const kept = [cachePathFor(DIR, 360, 'webp', '2026/04/a.jpg')];
    const d = deps({ kept });
    const r = await warmPhotos(reqs(), d);
    expect(r).toEqual({ converted: 2, kept: 1, failed: 0 });
    expect(d.converted.sort()).toEqual(['2026/04/b.jpg', '2026/04/c.jpg']);
  });

  it('counts a failed photo as failed and carries on: a failure is never a failed page', async () => {
    const d = deps({ fail: ['2026/04/b.jpg'] });
    const r = await warmPhotos(reqs(), d);
    expect(r).toEqual({ converted: 2, kept: 0, failed: 1 });
  });

  it('counts a queue-full refusal as failed for now, not as a throw', async () => {
    const d = deps({
      convert: async () => {
        const e = Object.assign(new Error('queue full'), { status: 429 });
        throw e;
      },
    });
    expect(await warmPhotos(reqs(), d)).toEqual({ converted: 0, kept: 0, failed: 3 });
  });

  it('never runs more photos at once than its parallel limit', async () => {
    let active = 0;
    let most = 0;
    const d = deps({
      parallel: 2,
      convert: async () => {
        active += 1;
        most = Math.max(most, active);
        await new Promise((r) => setTimeout(r, 2));
        active -= 1;
      },
    });
    await warmPhotos(reqs(), d);
    expect(most).toBe(2);
  });

  it('stops between photos when asked, and counts only the photos it got to', async () => {
    let asked = 0;
    const d = deps({ parallel: 1, stop: () => asked++ >= 1 });
    const r = await warmPhotos(reqs(), d);
    expect(r.converted + r.kept + r.failed).toBe(1);
    expect(d.converted).toHaveLength(1);
  });

  it('counts a conversion as failed when the file is not there after it (the write failed, and the writer only logs)', async () => {
    const d = deps({ convert: async () => undefined });
    // convert "succeeds" but writes nothing: the kept-file check after it is what tells the truth
    const r = await warmPhotos(reqs().slice(0, 1), { ...d, stat: async () => false });
    expect(r).toEqual({ converted: 0, kept: 0, failed: 1 });
  });

  it('caps the photos in flight across two pages at once, through one shared set of slots', async () => {
    let active = 0;
    let most = 0;
    const slots = createSlots(2);
    // each page has its own fake folder (deps), and every page shares the one set of slots
    const page = () => {
      const base = deps();
      return {
        ...base,
        parallel: 4,
        convert: (req: LightRequest) =>
          slots(async () => {
            active += 1;
            most = Math.max(most, active);
            await new Promise((r) => setTimeout(r, 3));
            active -= 1;
            return base.convert(req, () => false);
          }),
      };
    };
    const reqsOf = () => lightRequestsIn(`/img/360/webp/${LIGHT_VERSION}/2026/04/x.jpg /img/450/webp/${LIGHT_VERSION}/2026/04/y.jpg /img/720/webp/${LIGHT_VERSION}/2026/04/z.jpg`);
    const [a, b] = await Promise.all([warmPhotos(reqsOf(), page()), warmPhotos(reqsOf(), page())]);
    expect(most).toBe(2);
    expect(a).toEqual({ converted: 3, kept: 0, failed: 0 });
    expect(b).toEqual({ converted: 3, kept: 0, failed: 0 });
  });

  it('does not start a photo that was still waiting for a slot when stop was asked, and counts it as neither converted nor failed', async () => {
    const slots = createSlots(1);
    let stopAsked = false;
    const started: string[] = [];
    const keptFiles = new Set<string>();
    const d = deps({
      parallel: 2,
      stop: () => stopAsked,
      stat: async (file) => keptFiles.has(file),
      convert: (req, stop) =>
        slots(async () => {
          // the slot is taken: the second photo waits here until the first one is done
          if (stop()) return NOT_ATTEMPTED;
          started.push(req.rel);
          stopAsked = true; // asked while the first photo holds the only slot
          await new Promise((r) => setTimeout(r, 2));
          keptFiles.add(cachePathFor(DIR, req.width, req.format, req.rel, req.crop));
          return undefined;
        }),
    });
    const r = await warmPhotos(reqs().slice(0, 2), d);
    expect(started).toEqual(['2026/04/a.jpg']);
    expect(r).toEqual({ converted: 1, kept: 0, failed: 0 });
  });

  it('does nothing with no requests', async () => {
    expect(await warmPhotos([], deps())).toEqual({ converted: 0, kept: 0, failed: 0 });
  });
});
