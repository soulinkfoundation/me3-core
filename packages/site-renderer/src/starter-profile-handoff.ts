import type { Me3SiteProfile, PublicLocationData } from './index.js';
import { normalizeStarterButtons, normalizeStarterLinks, normalizeStarterPresentation } from './starter-profile.js';
export * from './starter-profile.js';

export const MAX_HANDOFF_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_HANDOFF_TOTAL_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_HANDOFF_PROFILE_BYTES = 256 * 1024;
export const PROFILE_ASSET_PATTERN = /^files\/[a-z0-9][a-z0-9._-]*\.(?:jpg|jpeg|png|webp|gif)$/i;
export type StarterProfileHandoffAsset = { path: string; contentType: string; base64: string };
export type StarterProfileHandoff = { profile: Me3SiteProfile & { name: string; handle: string; visibility: 'public' | 'private' }; assets: StarterProfileHandoffAsset[] };

const text = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function image(value: unknown): string | undefined {
  const raw = text(value, 2048);
  const path = raw.replace(/^\.?\//, '');
  if (PROFILE_ASSET_PATTERN.test(path)) return `/${path}`;
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function locality(value: unknown): PublicLocationData | undefined {
  const data = record(value);
  if (data.precision !== 'locality' || !text(data.label, 160) || typeof data.latitude !== 'number' || !Number.isFinite(data.latitude) || Math.abs(data.latitude) > 90 || typeof data.longitude !== 'number' || !Number.isFinite(data.longitude) || Math.abs(data.longitude) > 180) return undefined;
  return { label: text(data.label, 160), latitude: Math.round(data.latitude * 100) / 100, longitude: Math.round(data.longitude * 100) / 100, precision: 'locality', ...Object.fromEntries(['locality', 'region', 'country', 'countryCode'].filter(key => text(data[key], 160)).map(key => [key, text(data[key], 160)])) };
}

// This private authoring envelope is separate from the public me.json protocol.
// Older envelopes omit the optional fields and remain valid.
export function normalizeStarterHandoffProfile(value: unknown, expectedHandle: string): StarterProfileHandoff['profile'] {
  const source = record(value);
  const handle = text(source.handle, 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(handle) || handle !== expectedHandle) throw new Error('Starter profile handle does not match the install claim');
  const buttons = source.buttons === undefined ? [] : normalizeStarterButtons(source.buttons);
  const links = source.links === undefined ? {} : normalizeStarterLinks(source.links);
  const presentation = normalizeStarterPresentation(record(record(source.extensions)['me3.app/site']));
  const locationData = locality(source.locationData);
  return {
    version: '0.1', handle, name: text(source.name, 120) || handle,
    visibility: source.visibility === 'public' ? 'public' : 'private',
    ...(text(source.bio, 500) ? { bio: text(source.bio, 500) } : {}),
    ...(image(source.avatar) ? { avatar: image(source.avatar) } : {}),
    ...(image(source.banner) ? { banner: image(source.banner) } : {}),
    ...(text(source.location, 160) ? { location: text(source.location, 160) } : {}),
    ...(locationData ? { locationData } : {}),
    ...(Object.keys(links).length ? { links } : {}),
    ...(buttons.length ? { buttons } : {}),
    ...(Object.keys(presentation).length ? { extensions: { 'me3.app/site': presentation } } : {}),
  };
}
