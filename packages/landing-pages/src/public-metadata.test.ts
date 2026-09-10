import { describe, expect, it } from 'vitest';
import { buildLandingPageDocument, createBusinessSiteDocument, renderLandingPageHtml, upgradeLandingPageDocument, normalizeLandingPageDocument, getLandingPageValidationErrors } from './index';

function eventPage() {
  const page = upgradeLandingPageDocument(buildLandingPageDocument({ template: 'event', username: 'business', brief: 'A workshop with guided conversation.', profile: { name: 'Business', bio: null, avatar: null, profileUrl: null } }));
  page.event = { startDate: '2026-10-03T14:00:00+01:00', endDate: '2026-10-03T19:00:00+01:00', location: { type: 'place', name: 'The Barn', address: 'Killaloe, Co. Clare, Ireland' } };
  return page;
}

describe('business discovery and event metadata', () => {
  it('publishes actual event details in both HTML and JSON-LD with the correct site identity', () => {
    const page = eventPage();
    const html = renderLandingPageHtml(page, 'business', { businessSite: createBusinessSiteDocument('Business'), siteBaseUrl: 'https://example.com/site/business', canonicalUrl: 'https://example.com/site/business/workshop/' });
    const schemas = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(match => JSON.parse(match[1]));
    expect(schemas.find(schema => schema['@type'] === 'Event')).toMatchObject({ startDate: page.event!.startDate, location: { name: 'The Barn' }, organizer: { url: 'https://example.com/site/business/' } });
    expect(html).toContain('href="https://example.com/site/business/me.json"');
    expect(html).toContain('The Barn · Killaloe');
    expect(html).toContain('3 October 2026');
    expect(html).not.toContain('Date to be confirmed');
  });
  it('rejects ambiguous dates, reversed dates and unsafe online locations; never guesses event schema', () => {
    const page = eventPage();
    page.event!.startDate = 'Next Saturday';
    expect(normalizeLandingPageDocument(page)).toBeNull();
    expect(getLandingPageValidationErrors(page).join(' ')).toContain('timezone');
    expect(renderLandingPageHtml(page, 'business')).not.toContain('"@type":"Event"');
    page.event = { startDate: '2026-10-03T14:00:00+01:00', endDate: '2026-10-02T14:00:00+01:00', location: { type: 'online', url: 'javascript:alert(1)' } };
    expect(normalizeLandingPageDocument(page)).toBeNull();
    delete page.event;
    expect(renderLandingPageHtml(page, 'business')).not.toContain('"@type":"Event"');
  });
});
