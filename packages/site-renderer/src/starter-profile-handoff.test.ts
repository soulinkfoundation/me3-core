import { describe, expect, it } from 'vitest';
import { normalizeStarterHandoffProfile } from './starter-profile-handoff.js';

describe('starter handoff contract', () => {
  it('carries all starter fields while discarding installed-site features', () => {
    const buttons = Array.from({ length: 100 }, (_, i) => ({ id: `b${i}`, text: `Link ${i}`, url: `https://example.com/${i}`, style: 'outline' }));
    const profile = normalizeStarterHandoffProfile({ handle: 'connie', name: 'Connie', visibility: 'public', bio: 'Hello', avatar: '/files/avatar.jpg', location: 'Cork', locationData: { label: 'Cork', latitude: 51.9, longitude: -8.5, precision: 'locality' }, buttons, links: { website: 'https://example.com/' }, extensions: { 'me3.app/site': { theme: 'me3', layout: 'split', colorMode: 'dark', accent: '#123456' }, evil: {} }, pages: ['secret'], intents: { book: { enabled: true } } }, 'connie');
    expect(profile.buttons).toEqual(buttons);
    expect(profile.locationData?.label).toBe('Cork');
    expect(profile.extensions).toEqual({ 'me3.app/site': { theme: 'me3', layout: 'split', colorMode: 'dark', accent: '#123456' } });
    expect(profile).not.toHaveProperty('pages');
    expect(profile).not.toHaveProperty('intents');
  });
  it('accepts old minimal envelopes, preserves privacy, and refuses unsafe or mismatched data', () => {
    expect(normalizeStarterHandoffProfile({ handle: 'connie', name: 'Connie' }, 'connie')).toMatchObject({ visibility: 'private', name: 'Connie' });
    expect(() => normalizeStarterHandoffProfile({ handle: 'other' }, 'connie')).toThrow(/handle/);
    expect(() => normalizeStarterHandoffProfile({ handle: 'connie', buttons: [{ id: 'a', text: 'Bad', url: 'javascript:alert(1)' }] }, 'connie')).toThrow();
    expect(() => normalizeStarterHandoffProfile({ handle: 'connie', buttons: Array(101).fill({ id: 'a', text: 'A', url: 'https://example.com' }) }, 'connie')).toThrow();
  });
});
