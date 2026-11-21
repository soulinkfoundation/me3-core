# Changelog

## Unreleased

- Every page carries one schema.org JSON-LD graph built from the profile: the person or business (a ProfessionalService with address, area served, opening hours and price range when there is a place and something to book in person), each bookable offer as a Service with a priced Offer, duration and ReserveAction, each product as a Product with an Offer and BuyAction, and social links as sameAs. Product and offer pages make that product or service the page's main entity. Offers and products that show Enquire keep their price but advertise no action.
- A home Shop section shows the first three products in one row, like Latest writing (a sideways-swipe row on phones), as photo cards with prices and an All products link. It sits after offers by default, can be hidden or moved like other sections, and sites saved before it existed get it after offers.
- The Shop page is wide, with image-led cards (4:5 photos, soft shadow, stock and download tags on the photo) in three columns, two on phones. `normalizeHomeSections` is exported for editors.
- Product pages set the photo beside a buy panel: title, price with stock, option cards, one Buy button and short delivery facts, then the description. Buyer details open in a short step only after Buy; on phones the action bar becomes Buy now · price, then submits the step.
- Shop and product prices read like a shop: €14, from €14, €4.50 (Intl currency format, whole amounts without cents).

## 0.3.3

- Cover is immersive on desktop: the banner fills the first screen, the header floats over it and turns frosted on scroll, and the name, bio, buttons and social icons sit on the photo. On phones the menu floats over the photo and the hero is centred.
- Latest writing shows picture cards (image fills the card on Cover); offers, writing cards and avatars share one soft shadow; Minimal offers are cards.
- Buttons take their shape, typeface and size from the theme (pills for Warm, Meadow and ME3, 12px for Paper, square for Tech) and centre text on cap height.
- Lighter menu links, no header or footer rules (the header gains a shadow once scrolled), a one-row footer, a centred newsletter block on wide layouts, three-column offers on Cover and Split, and stacked full-width hero buttons on phones.
- Show each offer once on the home page: when offer cards are shown, the separate booking block is left out and the cards open the calendar beneath themselves.

## 0.3.2

- Centre the sun and moon icons inside the theme toggle button.

## 0.3.1

- Keep starter identity in one hero, without installation header, menu or footer link duplicates.
- Preserve starter theme switching and default installation navigation.

## 0.2.0

- Package-local source with built ESM and TypeScript declarations for external consumers.
- Export starter rendering with all capabilities disabled and installation content excluded.
- Export button/link and rendering capability types.
- Omit booking controls and runtime from starter output.
