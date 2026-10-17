# Network commerce: ME3 agents buying from ME3 sites

Status: **proposed design, awaiting owner review** (bead `me3-2gdu.11`). Spans
ME3 Core, ME3 Cloud and ME3 Protocol. Durable parts move into the shared docs
once approved; build work becomes beads.

## Goal

Bookings and simple products sold on ME3 sites should be the easiest things on
the internet for an agent to buy. An ME3 agent searches the network first, checks
the live price and availability, and the owner approves and pays in a couple of
taps, with a receipt on both sides. That smoothness is a reason for sellers to
get an ME3 site. Later, the same seller interface is exposed through industry
standards so any agent (ChatGPT, Gemini, Claude, Shopify agents) can buy too.

Unchanged rules from agent payments (`me3-2gdu.3`): the owner approves the exact
purchase with a fresh sign-in, the owner pays on their own device, ME3 never
holds card details, limits apply, and every step is audited.

## What exists today

| Piece | Where | State |
| --- | --- | --- |
| Offerings in `me.json` | Core `public-me-profile.ts` | Services (bookings) and products with price, duration, availability. Actions `book` and `purchase` are plain `link`s to the site. |
| Seller checkout | Core public routes | `GET /api/book/:username/slots`, `POST /api/book/:username/checkout-session` (paid 1:1), `POST /api/book/:username/free`, event registration, `POST /api/shop/:username/:slug/order` with a stale-price guard (`expectedAmount`/`expectedCurrency`). Stripe Connect or managed commerce. Built for the site's own pages, not for agents. |
| Network index | ME3 Cloud `services/network-directory.ts` | Indexes listed sites' services and products (title, description, price, duration, up to 20 each) with full-text search and coarse location. Listing requires Soulink membership. |
| Buyer search | Core `core.people.search` tool | Searches the index, filters by service/product and country. |
| Network scheduling | Core + Cloud | Free 1:1 meeting requests across the network with Cloud-issued authorizations. |
| Approvals | Core `agent-payments.ts` | Proposal, fresh-sign-in approval, single hand-over, receipts, limits. |

Gaps: no agent-facing purchase interface on sellers, the index does not say how
to buy or whether a seller is agent-ready, paid bookings and products have no
buyer path, and listing is limited to Soulink members.

## Decisions proposed

1. **Listing is open to every ME3 site.** Any installation linked to ME3 Cloud
   (self-hosted or managed) can opt in. Soulink membership becomes a trust
   badge, not a gate. Abuse controls: Cloud-linked installations only, per-install
   sync rate limits, report and delist, and a "new seller" label for the first
   weeks or first sales.
2. **Each seller exposes a small agent commerce API**, wrapping the existing
   checkout code rather than replacing it. It is versioned, public, and
   described in `me.json`.
3. **`me.json` says how to buy.** `book` and `purchase` actions become `openapi`
   actions pointing at the seller's agent commerce spec, plus an
   `agentCheckout` version on the capability. Plain `link` actions remain for
   humans and older clients. This is an additive ME3 Protocol change.
4. **The index stores what is needed to choose, not to transact.** Offerings,
   prices, seller location, trust signals and an `agentCheckout` flag are
   indexed. Live availability and the final price are always fetched from the
   seller at purchase time.
5. **Receipts come from the seller, not email.** The buyer's Core reads the
   order status from the seller's API, so a network purchase gets an exact,
   automatic receipt.
6. **ME3 sellers are preferred, honestly.** When a network offering fits the
   request about as well as an outside one, the agent shows it first and says it
   is on the ME3 network. It never hides a clearly better outside option.

## Seller agent commerce API (Core)

Served by every installation with commerce enabled, under
`/api/agent-commerce/v1`, unauthenticated like the public checkout today, with
rate limits per IP and per buyer installation.

| Endpoint | Purpose |
| --- | --- |
| `GET /offerings` | Agent-ready offerings: id, kind (`booking`, `product`, `event`), title, price, currency, duration, location or online, refund policy, buyer fields required. |
| `GET /offerings/:id/availability?from&to` | Bookable slots in the seller's timezone and UTC (wraps `slots`). |
| `POST /checkouts` | `{offeringId, slot?, quantity?, buyer: {name, email}, expectedAmount, expectedCurrency, idempotencyKey}` returns `{checkoutId, amount, currency, payUrl, expiresAt}`. Refuses a changed price (existing stale-price guard), holds the slot until `expiresAt`, and creates the Stripe Checkout session on the seller's connected account. |
| `GET /checkouts/:id` | `pending`, `paid`, `expired` or `cancelled`, with order or booking reference and paid amount. Readable only with the checkout's secret returned at creation. |

Booking holds expire after 15 minutes so an unpaid agent checkout cannot block a
slot. A buyer installation identifies itself with a signed header (its Cloud
install identity) so sellers can rate-limit and later trust-tier, but anonymous
human-style checkout keeps working.

## Buyer flow (Core agent)

1. **Find.** `core.people.search` (extended or renamed `core_network_offerings_search`)
   searches the index for offerings that match, preferring `agentCheckout`
   sellers and showing trust badges.
2. **Check.** A read tool calls the seller's `/offerings/:id` and
   `/availability` for the live price and slots.
3. **Propose.** `core_payments_propose` with method `in_network`, carrying the
   seller, offering, slot, price and the buyer details that will be shared. The
   approval card says: "Shares your name and email with {seller}."
4. **Approve.** Fresh sign-in as today.
5. **Hand over.** After approval, Core calls `POST /checkouts` and hands the
   owner `payUrl`: the seller's Stripe Checkout, where Apple Pay or Google Pay is
   one tap on a phone.
6. **Receipt.** Core polls `GET /checkouts/:id` (and on notification) and records
   the receipt automatically, flagging any difference from the approved amount.
   The booking also lands in the owner's calendar.

What the owner sees: one card with seller, item, time and total; **Approve**
(Face ID); a sheet that opens the seller's payment page with Apple Pay; then
"Booked: Thursday 10:00 with Aoife, €60 paid" in Chat and the calendar.

**Later, true one-tap:** native apps present the Apple Pay or Google Pay sheet
directly for the seller's connected account (Stripe PaymentSheet), so approve
and pay become a single Face ID. This needs the native approval proof from
`me3-2gdu.10` and Stripe's support for presenting a connected account's payment
from the buyer's app.

## Index changes (ME3 Cloud)

- Open listing to any Cloud-linked installation; keep Soulink membership as a
  badge. Existing opt-in decision and delisting stay.
- Store per offering: kind, price, currency, duration, online/in-person,
  `agentCheckout` version, seller handle and profile URL. Store per seller:
  Soulink-linked, listed since, completed network sales (count only, reported by
  the seller), and report status.
- Search ranks by relevance, then location fit, then trust signals. No
  pay-to-rank.
- Free ME3 Cloud starter profiles can be listed for discovery but have no
  `agentCheckout` until they adopt a Core installation with commerce.

## Selling to any agent (later)

Map the same seller API to industry standards once the network flow works:
UCP (`/.well-known/ucp`, catalog, cart and checkout, as Shopify does), ACP via
Stripe for Connect sellers, and the Personal Agent Protocol
(`/.well-known/poppy.json`). `me.json` stays the source of truth; the standard
endpoints are generated from it. This is the seller pitch: "every AI assistant
can book you."

## Risks

- **Seller fraud or no-shows.** Mitigated by Stripe Connect (refunds and
  disputes), "new seller" labels, Soulink badges, reports and delisting.
- **Spam listings.** Cloud-linked installs only, rate limits, review on report.
- **Personal data.** Name and email go to the seller only after approval, and
  the card says so.
- **Slot squatting.** Short holds, per-buyer rate limits.
- **Price drift.** The seller refuses a changed price at checkout; the buyer
  re-proposes.

## Build order after approval

1. **Core seller API** wrapping existing checkout, with holds and checkout
   status; `me.json` `openapi` actions; ME3 Protocol additive version.
2. **Cloud index**: open listing, commerce fields, trust signals, ranking.
3. **Core buyer tools**: search, live check, `in_network` method, hand-over to
   `payUrl`, automatic receipts, calendar entry.
4. **Web and native cards** for network purchases (builds on `me3-2gdu.4`).
5. **Native one-tap** Apple Pay/Google Pay (after `me3-2gdu.10`).
6. **Standards exposure** (UCP, ACP, Personal Agent Protocol).

Steps 1 and 2 can run in parallel; 3 needs both.

## Questions for the owner

1. Free starter profiles: list them for discovery (recommended) or Core sites only?
2. Should the agent ever choose an ME3 seller automatically when only one fits,
   or always show alternatives? (Recommended: always show the card; mention
   alternatives when they exist.)
3. Is a 15-minute booking hold right?
4. Should sellers be able to turn agent checkout off while staying listed?
   (Recommended: yes, default on for sellers with commerce enabled.)
