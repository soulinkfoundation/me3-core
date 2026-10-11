# Agent computer: browser and sandbox with owner takeover

Status: **main rules and default limits approved by the owner on 2026-10-11**
(bead `me3-ahsk.18`); spikes 1–3 done, spike 4 pending. No code, bindings or
deployment follow until the build beads are filed. The durable parts then move into the shared
[agent runtime](../../docs/projects/me3-agent-runtime.md) architecture and
the build work becomes beads.

## Goal

Give the new ME3 agent a computer it can use on the owner's behalf:

- a **browser** for finding things, filling carts and forms, and preparing checkouts;
- an **owner takeover** whenever a human must act: signing in, solving a CAPTCHA,
  paying, or confirming something consequential;
- later, a **sandbox** with files and a shell for generated code and documents.

The first product that depends on this is agent payments (`me3-2gdu.6`): ME3
prepares a checkout and the owner pays.

## Platform

Measured against Cloudflare documentation, October 2026.

| Need | Cloudflare product | What it gives us | Gaps |
| --- | --- | --- | --- |
| Browser | [Browser Run](https://developers.cloudflare.com/browser-run/) (formerly Browser Rendering) | Headless Chrome over CDP/Puppeteer/Playwright from a Worker binding. Paid plan: 200 concurrent browsers, 10 browser-hours/month included then $0.09/h, 10 concurrent included then $2 per browser (averaged monthly). | Sessions close after at most 10 minutes of inactivity and on Browser Run releases. No documented persistent profiles. Traffic is "always identified as bot traffic". |
| Live view | [Live View](https://developers.cloudflare.com/browser-run/features/live-view/) | Signed `live.browser.run` URL per session, `tab`/`full`/`devtools` modes, 1 min–1 h connect deadline, optional read-only guardrail, session-wide destination guardrails. | The URL is a bearer credential. Mobile, touch input and iframe/WebView embedding are not documented. |
| Takeover | [Human in the Loop](https://developers.cloudflare.com/browser-run/features/human-in-the-loop/) | `Cloudflare.getLiveView`, `Cloudflare.handoff({instructions, timeout ≤ 30 min})`, `Cloudflare.handoffComplete {success, reason}`. | Not documented: whether other CDP clients can read the page during a handoff, and whether a handoff keeps an idle session alive. |
| Recording | [Session recording](https://developers.cloudflare.com/browser-run/features/session-recording/) | Opt-in rrweb replay; input values masked; 30-day retention in Cloudflare. | Not needed; stays off. |
| Sandbox | [Sandboxes](https://blog.cloudflare.com/sandbox-ga/) (GA) | Isolated container per instance with files and shell; outbound Workers inject credentials and enforce per-instance egress allow/deny lists, so secrets never enter the sandbox. | Requires Containers on Workers Paid; not needed for browsing or payments. |

## Decisions proposed

1. **Browser first, sandbox later.** Browser Run already has live view and
   handoff, and payments need only the browser. The sandbox becomes its own
   bead after the browser ships.
2. **Computer work runs as a background job, not inside a chat turn.** Chat turns
   are capped at 30 steps and five minutes; browsing plus a 30-minute takeover
   does not fit. The chat tool starts a job and returns; the job reports
   progress, pauses for the owner, and posts its result into the same conversation.
3. **ME3 never performs the final consequential click.** Submitting a payment,
   placing an order, sending a message, creating an account or accepting terms
   is done by the owner in takeover, or by an approved tool with an exact
   reviewed payload. Browsing and reading need no approval.
4. **Sensitive input is owner-only.** ME3 does not type into password, one-time
   code or payment-card fields, and its tools never return input values. During a
   takeover ME3 stops reading the page entirely.
5. **No stored browser sessions in v1.** Every job starts in a fresh incognito
   context, and nothing survives the job. Remembering merchant sign-ins would mean
   storing owner credentials and is a separate decision.
6. **Off on self-hosted installs until set up.** The feature appears only when the
   installation has the Browser Run binding and Workers Paid. Managed installs get
   it with per-owner limits.

## How a job runs

```text
Chat turn ── computer_start(goal) ──► Job (Agent DO + D1 checkpoints)
                                        │ browser steps: open, read, click, type
                                        │ ── needs owner? ─► handoff ─► "ME3 needs you" card + push
                                        │                     owner taps Take over ─► Live View
                                        │                     owner taps Done / Couldn't ─► resume
                                        └─ finish ─► result message + artifacts in the conversation
```

- **Ownership.** The owner's `ME3_AGENT` Durable Object runs the job with fiber
  recovery, as chat turns do today. D1 holds the job record, ordered steps,
  approvals, handoffs, results and artifact references. The browser session is
  disposable: if it is lost, the job reports where it got to and can restart
  from the goal. It never silently replays a write.
- **Limits** (defaults, owner-adjustable down, managed plan sets the ceiling):
  one running job per owner; 20 minutes of active browsing per job; one takeover
  of up to 30 minutes at a time; 60 model steps per job; a daily browser-minute
  budget. Model cost goes through the existing usage receipts and managed admission.
- **Model input.** Pages reach the model as an accessibility/text snapshot with
  element references, not raw HTML. Screenshots only when the model asks.
  Every page result is marked untrusted web content, as web research results are.
- **Status.** The job streams `step` events into the conversation. Pausing for
  the owner uses the existing `approval_required` / `needs_you` notification path
  (`me3-ahsk.27`).

## Tools

All tools live in `packages/agent/src/tools`, are owner-scoped and run in the job.
The chat-turn surface is only `computer_start`, `computer_status` and
`computer_cancel`; the rest are available inside the job.

| Tool | Effect | Approval | Notes |
| --- | --- | --- | --- |
| `computer_start({goal, startUrl?})` | starts a job | none | Enforces limits; returns the job ID. |
| `browser_open({url})` | read | none | http(s) only; blocks private/internal addresses. |
| `browser_read()` | read | none | Text/accessibility snapshot with `ref`s; input values replaced by `[filled]`/`[empty]`. |
| `browser_screenshot()` | read | none | Saved as a private job artifact. |
| `browser_click({ref})` | page action | none for navigation | Refused on submit-class elements (see below). |
| `browser_type({ref, text})` | page action | none | Refused on password, one-time code and `cc-*` fields. Owner personal data (name, address, email, phone) needs approval of exactly which values go to which site. |
| `browser_submit({ref, reviewed})` | external effect | **required** | Exact page, field values and screenshot reviewed. Not allowed on payment pages. |
| `browser_handoff({reason, instructions})` | pause | owner acts | `reason`: `sign_in`, `captcha`, `payment`, `confirm`, `blocked`. |
| `computer_finish({summary, artifacts})` | completes job | none | Posts the result to the conversation. |

**Submit-class elements** are submit buttons, form-associated buttons on pages
where ME3 typed something, and elements whose accessible name matches purchase,
send, sign-up or agreement wording. Detection is deliberately over-broad; a
false positive costs one approval, a false negative could cost money. A page with
payment-card fields switches the job to payment mode: only `browser_read`,
`browser_screenshot` and `browser_handoff({reason: "payment"})` remain.

## Owner takeover

1. ME3 calls `browser_handoff`. Core records the handoff, publishes a "ME3 needs
   you" card with the reason and instructions, and sends the `needs_you` push.
2. The owner taps **Take over**. Core then asks Browser Run for a `tab`-mode Live
   View URL with a 2-minute connect deadline. The URL goes only to that owner's
   authenticated client, is never stored in D1, chat history, logs, traces or
   push payloads, and is regenerated if the owner reconnects.
3. Core sends `Cloudflare.handoff` and **stops all of its own CDP reads** for that
   session until `handoffComplete`. No screenshots, snapshots, network or console capture.
4. The owner acts in Live View, then taps **Done** or **I couldn't**. Timeout or
   either button resumes the job; ME3 reads the page again and continues or
   reports. After a payment handoff, ME3 reads only the confirmation page.
5. Web opens Live View in a new tab or panel. Native opens it full screen in an
   in-app browser, offered only for tap-only handoffs (`captcha`, `confirm`)
   because typing does not work there on iOS. Handoffs that need typing ask the
   owner to continue on a computer or switch to "finish on your device".

## Payments with this design

For `me3-2gdu.6`, ME3 finds the item, fills the cart and checkout details
(with approval for any personal data), and stops at the payment step. The
payment approval card shows the exact total, merchant and purpose; approving it
starts the payment takeover.

Two consequences the payments decision did not account for:

- **"Finish on your device" is the primary path.** When the merchant supports a
  shareable cart link (Shopify cart permalinks are the common case), ME3 builds
  the cart and the owner opens the link on their own device and pays natively
  with Apple Pay, Google Pay or Shop Pay. Otherwise ME3 hands over the merchant
  and item details (link, options, quantity, total) so the owner completes the
  purchase in their own browser or app.
- **Remote payment takeover is desktop-only.** The owner's device wallets and
  saved cards are not in the remote browser, and on iOS the keyboard does not
  open in Live View (spike 1). On desktop the owner can type card details into
  Live View; card digits never pass through ME3 code, logs or the model, but
  they travel through a Chrome running in the installation's Cloudflare account.
  Recording stays off.

Receipts in both paths come from the confirmation page or the order email; the
owner can confirm or correct them.

## Risks

- **Bot blocking.** Browser Run is always identified as automated traffic. Many
  checkouts (and some sign-ins) will refuse it even with a human in control.
  This may limit "any merchant" more than anything else in this design; the
  spike measures it.
- **Mobile takeover.** Typing does not work in Live View on iOS (spike 1), so
  phone owners rely on "finish on your device" for anything needing input.
- **Prompt injection.** Pages can instruct the agent. Mitigations: untrusted
  marking, approval on every external effect, no sensitive input, payment mode,
  private-address blocking, and job limits.
- **Personal data leakage.** Typing owner data into third-party sites is a
  disclosure; every such fill is approved per site and value.
- **Session loss.** Sessions die after 10 idle minutes and on Browser Run
  releases. Jobs must tolerate this and never repeat a submit to recover.
- **Cost.** Browsing is cheap ($0.09/h after included hours); model steps
  dominate. Snapshots over screenshots, step caps and the daily budget bound it.

## Spike results (2026-10-11)

Run with a dedicated Browser Run token on synthetic pages and public sites; no
owner data. Raw output was kept outside the repository.

1. **Mobile takeover: fails for typing on iOS.** Scanning the Live View link on
   an iPhone opens the session in Safari and taps reach the page, but the
   on-screen keyboard never opens, so no field can be filled. The same flow
   on a Mac worked end to end (typing, clicking Pay, pressing Done). Android not
   yet tried. Consequence: mobile takeover is for taps only (CAPTCHAs,
   confirmations, choosing options); typing and payment need desktop or the
   owner's own device.
2. **Read isolation: not provided by the platform.** While a handoff was
   active, the automation connection read all 16 synthetic card digits and the
   password length as they were typed, saw the Pay click, and kept taking
   screenshots and accessibility snapshots. ME3 must enforce rule 4 itself by
   detaching all page reads for the whole handoff; this needs an explicit test.
   After Done, the test closed the browser, so the link could not reconnect;
   the product regenerates a link per tap while a handoff is active.
3. **Merchant reach: about two thirds reachable at the browsing stage.** Of 28
   UK/IE merchants, 18 loaded their home and basket/search pages (Amazon UK,
   Currys, M&S, IKEA IE, Harvey Norman IE, Dunnes, Ryanair, Trainline, Airbnb,
   Eventbrite, Deliveroo, Just Eat, OpenTable, Fresha, Treatwell, Gymshark,
   Allbirds, Huel). Blocked or failing: Argos, Tesco and ASOS (Akamai "Access
   Denied"), Aer Lingus (Imperva "Pardon Our Interruption"), Etsy, Ticketmaster
   IE and eBay's home page (403), Boots (403), Booking.com (challenge stub) and
   John Lewis (timeouts). Only pages up to the basket were tested; add-to-cart and
   checkout are usually stricter, so real checkout reach will be lower. Browser
   Run identifies itself as `HeadlessChrome/128` on Linux. Four sites were on
   Shopify (cart links possible). None published `/.well-known/poppy.json`.
4. **Snapshot quality:** pending; needs AI Gateway credit for model calls.

## Original spike plan

All on disposable accounts and synthetic or public test pages; no owner data.

1. **Mobile takeover:** Live View `tab` mode on iPhone Safari, iOS
   `SFSafariViewController`/`WKWebView`, Android Chrome Custom Tabs/WebView:
   tapping, scrolling, typing, autofill, and whether a 30-minute handoff keeps the
   session alive.
2. **Read isolation:** confirm the Worker can fully suspend its CDP reads during
   a handoff, and that nothing in Browser Run logs or dashboards captures typed input.
3. **Merchant reach:** try reaching checkout on about 20 merchants UK/IE owners
   commonly use, recording which block Browser Run, which work, and which offer
   cart links.
4. **Snapshot quality:** accessibility snapshot vs screenshot for completing a
   synthetic shop journey with the chosen default model; steps and cost.

## Build order after approval

1. Computer job runtime (job record, D1 migration, limits, status events) with
   read-only browser tools. Depends on the `me3-ahsk.17` cutover.
2. Handoff and Live View on web; native after `me3-ahsk.22` approvals.
3. Page actions with submit/sensitive-field rules and `browser_submit` approval.
4. Payment mode and cart links, completing `me3-2gdu.6` with the `me3-2gdu.3` contract.
5. Sandbox (files and shell with outbound-Worker egress), separate bead.

## Testing

- Unit tests for every refusal rule: sensitive fields, submit-class detection,
  payment mode, private addresses, limits, Live View URL never persisted.
- A local fake browser driver for job, checkpoint, handoff and session-loss
  recovery tests; no Browser Run calls in CI.
- Synthetic shop fixture (cart, personal-data form, sign-in, payment page) for
  disposable end-to-end runs against real Browser Run, authorized per run.
- Eval cases for prompt injection from page content and for refusing to submit
  without approval.
