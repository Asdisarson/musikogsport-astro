// The storefront's "closed for an update" switch. Run-time settings (no rebuild; restart the app):
//   MOS_MAINTENANCE=1          every page answers 503 with the notice at /vidhald/, every API route 503
//   MOS_MAINTENANCE_KEY=<key>  the owner opens any page once with ?forskodun=<key>; a cookie then lets that
//                              browser use the whole shop, checkout included, while everyone else sees the notice
// Pure: src/middleware.ts reads the request and acts on the decision.

export const PREVIEW_PARAM = 'forskodun';
export const PREVIEW_COOKIE = 'mos_preview';
export const NOTICE_PATH = '/vidhald/';
const MIN_KEY_LENGTH = 16;
const OPEN_PATHS = new Set([NOTICE_PATH, '/api/healthz']);

export interface MaintenanceSettings {
  enabled: boolean;
  /** The preview key, or null when none (or one too short to be a secret) is set: then nobody gets in. */
  key: string | null;
}

export function maintenanceSettings(flag: string | undefined, key: string | undefined): MaintenanceSettings {
  const k = (key ?? '').trim();
  return { enabled: ['1', 'true', 'on'].includes((flag ?? '').trim().toLowerCase()), key: k.length >= MIN_KEY_LENGTH ? k : null };
}

export type MaintenanceDecision = 'pass' | 'unlock' | 'closed';

/** What to do with a request: serve it, remember this browser as the owner's and serve it, or show the notice. */
export function maintenanceDecision(
  settings: MaintenanceSettings,
  req: { path: string; queryKey: string | null; cookieKey: string | null },
): MaintenanceDecision {
  // `/_…` are Astro's own endpoints (the image service): the notice page needs them.
  if (!settings.enabled || OPEN_PATHS.has(req.path) || req.path.startsWith('/_')) return 'pass';
  if (settings.key === null) return 'closed';
  if (req.cookieKey === settings.key) return 'pass';
  return req.queryKey === settings.key ? 'unlock' : 'closed';
}
