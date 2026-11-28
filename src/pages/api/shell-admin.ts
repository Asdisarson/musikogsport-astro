import type { APIRoute } from 'astro';
import { createLimiter } from '../../lib/rateLimit';
import { jsonResponse, tooManyRequests } from '../../lib/http';
import { log, runtimeEnv } from '../../lib/logger';
import { parseShellAdminAction } from '../../lib/shellAdmin';
import { clearPhotos, clearShellPages, refreshShellPath, shellAdminStatus, storeOpens } from '../../lib/shellAdminRuntime';
import { applyNightlySettings, nightlyClearing, nightlyRunning, rebuildBase, runNightlyRebuild, stopNightlyRebuild } from '../../lib/nightlyRebuildRuntime';
import { pokeKeyMatches, readCappedBody } from '../../lib/shellPoke';
import { shellEnabled } from '../../lib/shellRuntime';

export const prerender = false;

// The page-store admin for WordPress's "Síðugeymsla" (wp-mu-plugins/mos-shell-admin.php). Keyed only: without
// MOS_SHELL_POKE_KEY every request is refused (403), and with it the WordPress side must send the same value as
// X-Mos-Shell-Key. GET returns the status; POST {action} runs one of: run, stop, refresh ({path}), clear, clear-photos.
// Contract: DEPLOY.md, "Admin endpoint". Never a second run; "clear" is refused while a run is going, and a run or a clear is
// refused while a clear is going ('clearing'; a clear is not a run, so "stop" answers that no run is going). "settings" takes
// {settings: {…}|null}: the nightly rebuild's saved settings (src/lib/nightlySettings.ts), refused with 400 when out of range.
// "run" takes optional {concurrency, pauseMs, photos} for that one run only (absent = the saved setting; out of range = 400).
// "clear-photos" removes the kept photos of this version: 409 while a run or a clear holds the slot.
const limiter = createLimiter(120, 60_000);

/** The refusal for a request without the key (or with the wrong one), or a limit hit; null when the request may go on. */
function admit(request: Request): Response | null {
  const key = runtimeEnv('MOS_SHELL_POKE_KEY');
  if (!key || !pokeKeyMatches(request.headers.get('x-mos-shell-key'), key)) {
    return jsonResponse({ message: 'Ekki heimilað.' }, 403);
  }
  if (!limiter.take('shell-admin')) return tooManyRequests(60);
  return null;
}

export const GET: APIRoute = async ({ request }) => {
  const denied = admit(request);
  if (denied) return denied;
  try {
    return jsonResponse(await shellAdminStatus(Date.now()), 200);
  } catch (err) {
    log.warn('[shell-admin] status failed', { err });
    return jsonResponse({ message: 'Ekki tókst.' }, 503);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const denied = admit(request);
  if (denied) return denied;
  const text = await readCappedBody(request);
  if (text === null) return jsonResponse({ message: 'Beiðnin er of stór.' }, 413);
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const act = parseShellAdminAction(body);
  if (!act) return jsonResponse({ message: 'Ógild beiðni.' }, 400);
  log.info('[shell-admin] action', { action: act.action });
  try {
    if (act.action === 'run') {
      if (!shellEnabled()) return jsonResponse({ error: 'store-off', message: 'Síðugeymslan er slökkt.' }, 409);
      const origin = rebuildBase().origin;
      if (!origin) return jsonResponse({ error: 'no-base', message: 'Engin grunnslóð: stilltu MOS_SHELL_REBUILD_BASE.' }, 409);
      // A store that does not open would make the walk do nothing: answer that, not 202.
      if (!(await storeOpens())) return jsonResponse({ error: 'store-off', message: 'Síðugeymslan er slökkt.' }, 409);
      if (nightlyRunning()) return jsonResponse({ error: 'running', message: 'Keyrsla er þegar í gangi.' }, 409);
      if (nightlyClearing()) return jsonResponse({ error: 'clearing', message: 'Tæming er í gangi: bíddu eftir henni.' }, 409);
      // No await between the check above and the call: the walk's run state is set synchronously, before the response.
      // The options a request left out stay undefined: the walk then takes the saved setting.
      void runNightlyRebuild(origin, { concurrency: act.concurrency, delayMs: act.pauseMs, photos: act.photos });
      return jsonResponse({ ok: true, started: true }, 202);
    }
    if (act.action === 'stop') {
      if (!stopNightlyRebuild()) return jsonResponse({ error: 'not-running', message: 'Engin keyrsla er í gangi.' }, 409);
      return jsonResponse({ ok: true, stopping: true }, 202);
    }
    if (act.action === 'refresh') {
      if (!shellEnabled()) return jsonResponse({ error: 'store-off', message: 'Síðugeymslan er slökkt.' }, 409);
      if (!(await refreshShellPath(act.path))) return jsonResponse({ error: 'store-off', message: 'Síðugeymslan er slökkt.' }, 409);
      return jsonResponse({ ok: true, path: act.path }, 200);
    }
    if (act.action === 'settings') {
      const r = await applyNightlySettings(act.settings);
      if (!r.ok && r.stored === false) return jsonResponse({ error: 'not-kept', message: 'Stillingarnar voru ekki skrifaðar á disk.', problems: r.problems }, 503);
      if (!r.ok) return jsonResponse({ error: 'invalid', message: 'Stillingarnar eru ógildar.', problems: r.problems }, 400);
      return jsonResponse({ ok: true, settings: r.settings.effective, source: r.settings.source, saved: r.settings.saved, persisted: r.persisted }, 200);
    }
    if (act.action === 'clear-photos') {
      const photos = await clearPhotos();
      if (photos === 'running') return jsonResponse({ error: 'running', message: 'Keyrsla er í gangi: stöðvaðu hana fyrst.' }, 409);
      if (photos === 'clearing') return jsonResponse({ error: 'clearing', message: 'Tæming er þegar í gangi.' }, 409);
      return jsonResponse({ ok: true, removed: photos.removed, failed: photos.failed }, 200);
    }
    // clear
    const cleared = await clearShellPages();
    if (cleared === 'running') return jsonResponse({ error: 'running', message: 'Keyrsla er í gangi: stöðvaðu hana fyrst.' }, 409);
    if (cleared === 'clearing') return jsonResponse({ error: 'clearing', message: 'Tæming er þegar í gangi.' }, 409);
    if (cleared === null) return jsonResponse({ error: 'store-off', message: 'Síðugeymslan er slökkt.' }, 409);
    // failed: page files that could not be removed (they may still be served); the page then warns instead of reporting success.
    return jsonResponse({ ok: true, removed: cleared.removed, failed: cleared.failed }, 200);
  } catch (err) {
    log.warn('[shell-admin] action failed', { action: act.action, err });
    return jsonResponse({ message: 'Ekki tókst.' }, 503);
  }
};
