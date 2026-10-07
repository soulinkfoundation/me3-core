# @me3-core/site-renderer

ME3's shared HTML renderer, themes, layouts and public metadata. It has no Cloud-specific routes or storage.

## Install outside Core

Pin the package release and subdirectory with pnpm 9:

```sh
pnpm add '@me3-core/site-renderer@github:soulinkfoundation/me3-core#site-renderer-v0.2.0&path:/packages/site-renderer'
```

The Git dependency's `prepare` script builds ESM and TypeScript declarations in `dist/`. Wrangler bundles the emitted JavaScript. No monorepo link or npm publishing credentials are required.

```ts
import { renderStarterProfileHtml } from '@me3-core/site-renderer';

const pages = await renderStarterProfileHtml({
  name: 'Alex', handle: 'alex', bio: 'Hello!',
  buttons: [{ text: 'Contact me', url: 'mailto:alex@example.com' }],
  links: { website: 'https://example.com' },
  extensions: { 'me3.app/site': { theme: 'warm', layout: 'card', colorMode: 'auto' } },
}, { baseUrl: 'https://example.com/alex' });
```

The starter helper allowlists identity, links, buttons and appearance settings, forces all capabilities off and returns only `index.html`. Private profiles return no files; the caller owns the private identity shell and HTTP headers. Supply absolute media URLs for pages served under a handle path. Callers validate public input and enforce their own storage limits.

`classic` and `portrait` are legacy aliases for the modern `card` and `split` layouts, matching Core. Button labels use `text`; editor IDs belong to the caller. Full installation publishing still uses `generateSiteHtml`, whose existing capability defaults are preserved.

## Develop

```sh
pnpm --filter @me3-core/site-renderer build
pnpm --filter @me3-core/site-renderer test
pnpm --filter @me3-core/site-renderer typecheck
```

Build the package before running Core consumers. Regional pricing and product delivery live here; Core's `shared` modules re-export the same source.
