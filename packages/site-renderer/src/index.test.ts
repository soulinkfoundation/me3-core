import { describe, expect, it } from "vitest";
import { generateSiteHtml } from "./index";

describe("site generator", () => {
  it("generates profile HTML without publishing the private source document", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        name: "test site",
        handle: "test",
        bio: "A generated ME3 site.",
        avatar: "./files/avatar.jpg",
        banner: "./files/banner.jpg",
        links: { _vibe: "tech" },
        buttons: [{ text: "Join my course", url: "https://example.com/course" }],
        pages: [{ slug: "about", title: "About", file: "about.md" }],
      },
      [{ name: "about.md", content: "# About\n\nGenerated from markdown." }],
    );

    expect(files["index.html"]).toContain('body data-vibe="tech"');
    expect(files["index.html"]).toContain('src="./files/avatar.jpg"');
    expect(files["index.html"]).toContain("Join my course");
    expect(files["about.html"]).toContain("Generated from markdown.");
    expect(files["me.json"]).toBeUndefined();
  });

  it("renders one-level navigation groups without changing page URLs", async () => {
    const files = await generateSiteHtml(
      {
        name: "Grouped Site",
        pages: [
          {
            slug: "about",
            title: "About",
            file: "about.md",
          },
          {
            slug: "private-sessions",
            title: "Private Sessions",
            file: "private-sessions.md",
            navigationGroup: "Services",
          },
          {
            slug: "monthly-events",
            title: "Monthly Events",
            file: "monthly-events.md",
            navigationGroup: "Services",
          },
        ],
      },
      [
        { name: "about.md", content: "About" },
        { name: "private-sessions.md", content: "Sessions" },
        { name: "monthly-events.md", content: "Events" },
      ],
    );

    expect(files["index.html"].match(/<details class="nav-group/g)).toHaveLength(1);
    expect(files["index.html"]).toContain(
      '<summary class="nav-link nav-group-toggle">Services',
    );
    expect(files["index.html"]).toContain(
      '<svg viewBox="0 0 20 20" focusable="false">',
    );
    expect(files["index.html"]).toContain('href="./private-sessions"');
    expect(files["index.html"]).toContain('href="./monthly-events"');
    expect(files["index.html"]).toContain('href="./about"');
    expect(files["private-sessions.html"]).toContain(
      'class="nav-group active"',
    );
    expect(files["private-sessions.html"]).toContain(
      'class="nav-link active">Private Sessions</a>',
    );
    expect(files["private-sessions.html"]).toContain(
      '<details class="nav-group active" open>',
    );
  });

  it("offers a compact accessible navigation drawer on every page", async () => {
    const files = await generateSiteHtml(
      {
        name: "Compact Site",
        avatar: "./files/avatar.jpg",
        links: { _navigation_style: "compact" },
        pages: [{ slug: "about", title: "About", file: "about.md" }],
      },
      [{ name: "about.md", content: "About" }],
    );

    expect(files["index.html"]).toContain(
      'body data-vibe="warm" data-navigation-style="compact"',
    );
    expect(files["index.html"]).toContain(
      'class="site-navigation site-navigation-home site-navigation-compact"',
    );
    expect(files["index.html"]).not.toContain('class="nav nav-inline"');
    expect(files["index.html"]).toContain(
      'class="site-menu-trigger" type="button" data-site-menu-open aria-label="Open menu"',
    );
    expect(files["index.html"]).not.toContain('<span>Menu</span>');
    expect(files["index.html"]).toContain(
      ".site-navigation-home.site-navigation-compact{position:absolute;top:16px;right:16px",
    );
    expect(files["index.html"]).toContain('aria-haspopup="dialog"');
    expect(files["index.html"]).toContain(
      '<dialog id="site-navigation-dialog"',
    );
    expect(files["index.html"]).toContain('aria-label="Close menu"');
    expect(files["index.html"]).toContain('typeof dialog.showModal');
    expect(files["about.html"]).toContain(
      'class="site-navigation site-navigation-header site-navigation-compact"',
    );
    expect(files["about.html"]).toContain(
      '<header class="page-header"><a class="back-link"',
    );
  });

  it("uses the top-right drawer at every width for legacy standard profiles", async () => {
    const files = await generateSiteHtml({name: "Standard Site", links: {_navigation_style: "standard"}, pages: [{slug: "about", title: "About", file: "about.md"}]}, [{name: "about.md", content: "About"}]);
    expect(files["index.html"]).toContain('data-navigation-style="compact"');
    expect(files["index.html"]).not.toContain('<nav class="nav nav-inline"');
    expect(files["index.html"].indexOf('<div class="site-navigation')).toBeLessThan(files["index.html"].indexOf('<main'));
    expect(files["about.html"]).toContain('site-navigation-header site-navigation-compact');
  });

  it("publishes semantic native audio controls with responsive styling", async () => {
    const files = await generateSiteHtml(
      {
        name: "Audio Site",
        pages: [{ slug: "listen", title: "Listen", file: "listen.md" }],
      },
      [
        {
          name: "listen.md",
          content: `<figure data-me3-audio="true" data-asset-id="audio-id" data-path="./files/content/audio-id.mp3" class="content-audio"><figcaption>Grounding practice</figcaption><audio controls preload="metadata" aria-label="Grounding practice"><source src="./files/content/audio-id.mp3" type="audio/mpeg">Your browser does not support audio playback.</audio></figure>`,
        },
      ],
    );

    const html = files["listen.html"];
    expect(html).toContain("<audio controls");
    expect(html).toContain("Grounding practice");
    expect(html).toContain('src="./files/content/audio-id.mp3"');
    expect(html).toContain(".content .content-audio audio{display:block;width:100%");
    expect(html).not.toContain("blob:");
  });

  it("expands reusable editor blocks from the global site configuration", async () => {
    const files = await generateSiteHtml(
      {
        name: "Reusable Blocks",
        handle: "reusable-blocks",
        testimonials: [
          { name: "Jamie", quote: "This was exactly what I needed." },
        ],
        intents: {
          subscribe: {
            enabled: true,
            title: "Monthly notes",
            description: "One useful note each month.",
          },
        },
        pages: [{ slug: "services", title: "Services", file: "services.md" }],
      },
      [
        {
          name: "services.md",
          content: `<p>Choose your next step.</p>
            <div data-me3-cta-button="true" data-text="Book &amp; begin" data-url="/book" data-style="outline" data-icon=""></div>
            <div data-me3-site-block="testimonials"></div>
            <div data-me3-site-block="newsletter"></div>`,
        },
      ],
    );

    const services = files["services.html"];
    expect(services).toContain(
      '<a class="cta-button outline" href="/book">Book &amp; begin</a>',
    );
    expect(services).toContain("This was exactly what I needed.");
    expect(services).toContain("Monthly notes");
    expect(services).toContain(
      'action="/api/sites/reusable-blocks/subscribe"',
    );
    expect(services).not.toContain("data-me3-site-block");
    expect(services).not.toContain("data-me3-cta-button");
    expect(services).not.toContain('id="newsletter"');
  });

  it("renders legacy rich booking intros as plain text", async () => {
    const files = await generateSiteHtml(
      {
        name: "Booking Intro",
        handle: "booking-intro",
        intents: {
          book: {
            enabled: true,
            title: "Book a session",
            description: "<p>Choose a path &amp; begin.</p>",
            availability: {
              timezone: "Europe/Dublin",
              windows: { monday: ["09:00"] },
            },
          },
        },
      },
      [],
    );

    expect(files["index.html"]).toContain(
      "<p>Choose a path &amp; begin.</p>",
    );
    expect(files["index.html"]).not.toContain("&lt;p&gt;");
    expect(files["index.html"]).not.toContain("&amp;amp;");
  });

  it("keeps captions attached and adds one accessible gallery to image pages", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        name: "Gallery Site",
        pages: [
          { slug: "paintings", title: "Paintings", file: "paintings.md" },
          { slug: "about", title: "About", file: "about.md" },
        ],
      },
      [
        {
          name: "paintings.md",
          content: `<div data-gallery="true" class="tiptap-gallery">
            <figure data-tiptap-image="true" class="tiptap-image-figure">
              <img src="./files/painting-1.jpg" alt="Number 37">
              <figcaption class="tiptap-figcaption">Number 37. Size: 80cm x 90cm.</figcaption>
            </figure>
            <figure data-tiptap-image="true" class="tiptap-image-figure">
              <img src="./files/painting-2.jpg" alt="Number 38">
              <figcaption class="tiptap-figcaption">Number 38. Size: 120cm x 90cm.</figcaption>
            </figure>
          </div>`,
        },
        { name: "about.md", content: "# About\n\nNo images here." },
      ],
    );

    const paintings = files["paintings.html"];
    expect(paintings).toContain('data-gallery="true"');
    expect(paintings).toContain("Number 37. Size: 80cm x 90cm.</figcaption>");
    expect(paintings).toContain(".content figure>figcaption");
    expect(paintings).toContain("text-align:center");
    expect(paintings).toContain('data-content-lightbox aria-label="Image gallery"');
    expect(paintings).toContain('document.querySelectorAll(".content img")');
    expect(paintings).toContain('trigger.type = "button"');
    expect(paintings).toContain('dialog.showModal()');
    expect(paintings).toContain('event.key === "Escape"');
    expect(paintings).toContain('event.key === "ArrowRight"');
    expect(paintings).toContain('addEventListener("touchend"');
    expect(paintings.match(/<dialog class="content-lightbox"/g)).toHaveLength(1);
    expect(files["about.html"]).not.toContain('data-content-lightbox aria-label="Image gallery"');
    expect(files["index.html"]).not.toContain('data-content-lightbox aria-label="Image gallery"');
  });

  it("renders concise public locations from structured location data", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        name: "Cork Coach",
        location: "Cork, County Cork, Eire / Ireland",
        locationData: {
          label: "Cork, County Cork, Eire / Ireland",
          latitude: 51.89851,
          longitude: -8.47264,
          precision: "city",
          region: "County Cork",
          country: "Eire / Ireland",
          countryCode: "IE",
        },
      },
      [],
    );

    expect(files["index.html"]).toContain("Cork, Ireland");
    expect(files["index.html"]).not.toContain("County Cork, Eire / Ireland");
  });

  it("uses custom link labels for platform icons", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        name: "Links Site",
        links: {
          custom_youtube: "kieranbutler",
          custom_youtube_label: "Youtube",
        },
      },
      [],
    );

    expect(files["index.html"]).toContain('aria-label="Youtube"');
    expect(files["index.html"]).toContain("M23.498 6.186");
  });

  it("renders escaped markdown links and images as html", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        name: "Markdown Site",
        pages: [
          { slug: "now", title: "Now", file: "now.md" },
          { slug: "about", title: "About", file: "about.md" },
        ],
        posts: [
          {
            slug: "hello",
            title: "Hello",
            file: "blog/hello.md",
            publishedAt: "2026-02-03",
            excerpt: "A short hello from the blog.",
          },
          {
            slug: "why-me3",
            title: "Why ME3",
            file: "blog/why-me3.md",
            publishedAt: "2026-02-04",
          },
          {
            slug: "image-import",
            title: "Image Import",
            file: "blog/image-import.md",
            publishedAt: "2026-02-05",
          },
        ],
      },
      [
        {
          name: "now.md",
          content:
            "### Work\n\n\\[\\*\\*ME3\\*\\*\\](https://me3.app)\n\n[**Book here**](https://kieranbutler.com/#booking) **or** [**email me**](<mailto: hello@example.com>)\n\n![Alt text](./files/now-1.webp)",
        },
        {
          name: "about.md",
          content:
            '<figure><img src="https://example.com/preview/testuser/files/about-1.webp" alt="About"></figure>',
        },
        {
          name: "blog/hello.md",
          content:
            '<figure><img src="/preview/testuser/files/post-1.webp" alt="Post"></figure>',
        },
        {
          name: "blog/why-me3.md",
          content:
            "\\_“I’m allergic to tech... I want simple!”\\_\n\n“\\_Me too...\\_” I said, and I pulled that thread.\n\nThe result is **ME3**, free software you own and host yourself.\n\n> Good morning, Ethan.\n>\n> Intelligence suggests that the Ministry of Smoke and Mirrors is harvesting all human knowledge.\n>\n> Godspeed Ethan.",
        },
        {
          name: "blog/image-import.md",
          content:
            '![Ouroboros](https://example.com/ouroboros.webp "ouroboros.png")\n\nouroboros.png\n\nActual story after the imported image.',
        },
      ],
    );

    expect(files["now.html"]).toContain("<h3>Work</h3>");
    expect(files["now.html"]).toContain(
      '<a href="https://me3.app" target="_blank" rel="noopener"><strong>ME3</strong></a>',
    );
    expect(files["now.html"]).toContain(
      '<a href="https://kieranbutler.com/#booking" target="_blank" rel="noopener"><strong>Book here</strong></a>',
    );
    expect(files["now.html"]).toContain(
      '<a href="mailto:hello@example.com"><strong>email me</strong></a>',
    );
    expect(files["now.html"]).toContain(
      '<img src="./files/now-1.webp" alt="Alt text"',
    );
    expect(files["about.html"]).toContain('src="./files/about-1.webp"');
    expect(files["blog/hello.html"]).toContain('src="../files/post-1.webp"');
    expect(files["now.html"]).not.toContain("\\[\\*\\*ME3");
    expect(files["blog/index.html"]).toContain(
      "“I’m allergic to tech... I want simple!” “Me too...” I said",
    );
    expect(files["blog/index.html"]).not.toContain("\\“");
    expect(files["blog/index.html"]).not.toContain("\\Me");
    expect(files["blog/why-me3.html"]).toContain(
      "<em>“I’m allergic to tech... I want simple!”</em>",
    );
    expect(files["blog/why-me3.html"]).toContain(
      "“<em>Me too...</em>” I said",
    );
    expect(files["blog/why-me3.html"]).toContain(
      "The result is <strong>ME3</strong>",
    );
    expect(files["blog/why-me3.html"]).toContain(
      "<blockquote><p>Good morning, Ethan.</p><p>Intelligence suggests that the Ministry of Smoke and Mirrors is harvesting all human knowledge.</p><p>Godspeed Ethan.</p></blockquote>",
    );
    expect(files["blog/why-me3.html"]).not.toContain("<p>&gt;</p>");
    expect(files["blog/image-import.html"]).toContain(
      '<figure><img src="https://example.com/ouroboros.webp" alt="Ouroboros"',
    );
    expect(files["blog/image-import.html"]).not.toContain(
      "<figcaption>ouroboros.png</figcaption>",
    );
    expect(files["blog/image-import.html"]).not.toContain(
      "<p>ouroboros.png</p>",
    );
    expect(files["blog/index.html"]).toContain(
      "Actual story after the imported image.",
    );
    expect(files["blog/index.html"]).not.toContain(
      'blog-item-excerpt">ouroboros.png',
    );
  });

  it("normalizes stale preview-prefixed profile image paths", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        name: "Preview Asset Site",
        avatar: "./preview/testuser/files/avatar.jpg",
        banner: "/preview/testuser/files/banner.jpg",
      },
      [],
    );

    expect(files["index.html"]).toContain('src="./files/avatar.jpg"');
    expect(files["index.html"]).toContain('src="./files/banner.jpg"');
    expect(files["index.html"]).not.toContain("/preview/testuser/files/");
  });

  it("renders homepage booking, testimonials, and newsletter like the app site", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        name: "Booking Site",
        handle: "booking-site",
        avatar: "./files/avatar.jpg",
        links: {
          _vibe: "tech",
          x: "kieranbutler",
          instagram: "kieranbutler",
          linkedin: "kieranbutler",
          email: "hello@example.com",
          substack: "soulink",
        },
        buttons: [{ text: "Join Soulink", url: "https://soulink.app", icon: "Infinity" }],
        testimonials: [
          {
            name: "Alie Rae",
            quote:
              "Kieran was a pleasure to work with. Incredibly talented in technology.",
            handle: "Author",
            profileUrl: "https://example.com",
          },
          {
            name: "Jane Doe",
            quote: "A grounded, generous collaborator.",
            handle: "Founder",
          },
        ],
        intents: {
          subscribe: {
            enabled: true,
            title: "Newsletter",
            description: "Ideas from the future.",
          },
          book: {
            enabled: true,
            title: "Book a call",
            description: "Choose what fits.",
            bufferTime: 15,
            availability: { timezone: "Europe/Dublin", windows: { monday: ["09:00"] } },
            offers: [
              { title: "ME3 Setup", duration: 60, pricing: { enabled: false } },
              {
                title: "Coaching call",
                duration: 60,
                pricing: {
                  enabled: true,
                  currency: "EUR",
                  suggestedAmount: 75,
                  allowFlexiblePricing: true,
                },
              },
            ],
          },
        },
      },
      [],
    );

    expect(files["index.html"]).toContain("<h2>Book a session</h2>");
    expect(files["index.html"]).not.toContain("<h2>Book a call</h2>");
    expect(files["index.html"]).toContain('<link rel="icon" href="./files/avatar.jpg">');
    expect(files["index.html"]).toContain('<link rel="apple-touch-icon" href="./files/avatar.jpg">');
    expect(files["index.html"]).toContain('href="https://x.com/kieranbutler"');
    expect(files["index.html"]).toContain('href="https://instagram.com/kieranbutler"');
    expect(files["index.html"]).toContain('href="https://linkedin.com/in/kieranbutler"');
    expect(files["index.html"]).toContain('href="mailto:hello@example.com"');
    expect(files["index.html"]).toContain('href="https://soulink.substack.com/"');
    expect(files["index.html"]).toContain('class="btn-icon"><svg');
    expect(files["index.html"]).not.toContain(">Infinity</span>");
    expect(files["index.html"]).toContain("ME3 Setup");
    expect(files["index.html"]).toContain("Coaching call");
    expect(files["index.html"]).toContain("From €75");
    expect(files["index.html"]).toContain("Choose an offer");
    expect(files["index.html"]).toContain('<button type="button" class="booking-card active" aria-pressed="true">');
    expect(files["index.html"]).not.toContain("data-booking-selection");
    expect(files["index.html"]).toContain('type="date"');
    expect(files["index.html"]).toContain("data-booking-date-wrap");
    expect(files["index.html"]).toContain("showPicker");
    expect(files["index.html"]).toContain("if(!dateInput.value) dateInput.value=today");
    expect(files["index.html"]).toContain("populateSlots();");
    expect(files["index.html"]).toContain("cursor:pointer");
    expect(files["index.html"]).toContain('pattern="[^\\s@]+@[^\\s@]+\\.[^\\s@]+"');
    expect(files["index.html"]).toContain("setCustomValidity(hasInvalidEmail?'Enter a valid email address.':'')");
    expect(files["index.html"]).toContain("if(!validateForm()) return;");
    expect(files["index.html"]).toContain("'/free'");
    expect(files["index.html"]).toContain("form.reset();dateInput.value='';selectedTime='';timeInput.value=''");
    expect(files["index.html"]).toContain("'Your booking is confirmed.'");
    expect(files["index.html"]).toContain("Your booking is confirmed.");
    expect(files["index.html"]).toContain("data-booking-status");
    expect(files["index.html"]).toContain("clearBookingParams()");
    expect(files["index.html"]).toContain("url.searchParams.delete('booking')");
    expect(files["index.html"]).toContain("url.searchParams.delete('session_id')");
    expect(files["index.html"]).toContain("showReturnStatus('Confirming your booking...')");
    expect(files["index.html"]).toContain("A confirmation email will be sent soon");
    expect(files["index.html"]).not.toContain("if this site has email sending configured");
    expect(files["index.html"]).not.toContain("Your booking request is ready.");
    expect(files["index.html"]).toContain('"bufferTime":15');
    expect(files["index.html"]).toContain("t+=slotStep");
    expect(files["index.html"]).toContain("button.dataset.timeValue=value");
    expect(files["index.html"]).toContain("var slotButton=event.currentTarget");
    expect(files["index.html"]).toContain("item.classList.toggle('active',item===slotButton)");
    expect(files["index.html"]).toContain("No available times on this day.");
    expect(files["index.html"]).toContain('<h3 class="section-title">Testimonials</h3>');
    expect(files["index.html"]).toContain('class="testimonials-carousel"');
    expect(files["index.html"]).toContain("EmblaCarousel");
    expect(files["index.html"]).toContain("testimonial-quote");
    expect(files["index.html"]).toContain('<h2 class="newsletter-title">Newsletter</h2>');
    expect(files["index.html"]).toContain('class="newsletter-form"');
    expect(files["index.html"]).toContain('action="/api/sites/booking-site/subscribe"');
    expect(files["index.html"]).toContain("event.preventDefault()");
    expect(files["index.html"]).toContain('role="status" aria-live="polite"');
    expect(files["index.html"]).toContain('name="website"');
    expect(files["index.html"]).not.toContain('action="/subscribe"');
    expect(files["index.html"]).toContain("No spam. Unsubscribe anytime.");
    expect(files["index.html"]).toContain("body[data-vibe=tech] .name{font-size:24px");
    expect(files["index.html"]).toContain("body[data-vibe=tech] .newsletter input[type=email]");
    expect(files["index.html"]).not.toContain("readonly");
  });

  it("prefers a custom site logo for icons and otherwise falls back to the avatar", async () => {
    const brandedFiles = await generateSiteHtml(
      {
        name: "Branded Site",
        logo: "./files/logo.png",
        avatar: "./files/avatar.jpg",
      },
      [],
    );
    const avatarFiles = await generateSiteHtml(
      { name: "Avatar Site", avatar: "./files/avatar.jpg" },
      [],
    );
    const unbrandedFiles = await generateSiteHtml({ name: "Plain Site" }, []);

    expect(brandedFiles["index.html"]).toContain(
      '<link rel="icon" href="./files/logo.png">',
    );
    expect(brandedFiles["index.html"]).toContain(
      '<link rel="apple-touch-icon" href="./files/logo.png">',
    );
    expect(brandedFiles["index.html"]).not.toContain(
      '<link rel="icon" href="./files/avatar.jpg">',
    );
    expect(avatarFiles["index.html"]).toContain(
      '<link rel="icon" href="./files/avatar.jpg">',
    );
    expect(unbrandedFiles["index.html"]).not.toContain('rel="icon"');
    expect(unbrandedFiles["index.html"]).not.toContain("favicon.png");
  });

  it("tells visitors when newsletter confirmation is required", async () => {
    const files = await generateSiteHtml(
      {
        name: "Confirmed Newsletter",
        handle: "confirmed-newsletter",
        intents: {
          subscribe: { enabled: true, doubleOptIn: true },
        },
      },
      [],
    );

    expect(files["index.html"]).toContain("Confirm by email. Unsubscribe anytime.");
  });

  it("confirms pay-separately bookings without checkout and keeps instructions private", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        handle: "manual-payments",
        name: "Manual Payments",
        intents: {
          book: {
            enabled: true,
            availability: {
              timezone: "Europe/Dublin",
              windows: { monday: ["09:00-12:00"] },
            },
            offers: [
              {
                id: "healing-session",
                title: "Healing session",
                duration: 60,
                pricing: {
                  enabled: true,
                  suggestedAmount: 80,
                  currency: "EUR",
                  paymentMethod: "manual",
                  paymentInstructions: "Private payment link: https://pay.example/secret",
                },
              },
            ],
          },
        },
      },
      [],
    );

    const html = files["index.html"];
    expect(html).toContain(
      "Payment is not taken now. You’ll receive payment details by email after booking.",
    );
    expect(html).toContain('"paymentMethod":"manual"');
    expect(html).toContain("selected.pricing.paymentMethod==='manual'");
    expect(html).toContain("'/free'");
    expect(html).not.toContain("Private payment link");
    expect(html).toContain("Confirm Booking");
  });

  it("renders functional class and retreat registration flows with attendee quantities", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        handle: "events",
        name: "Events",
        intents: {
          book: {
            enabled: true,
            bookingTypes: [
              {
                type: "class",
                label: "Classes",
                classes: [
                  {
                    id: "movement-class",
                    title: "Movement class",
                    duration: 60,
                    timezone: "Europe/Dublin",
                    recurrence: {
                      frequency: "weekly",
                      weekday: "monday",
                      startTime: "18:00",
                      startDate: "2026-09-07",
                    },
                    capacity: 12,
                  },
                ],
              },
              {
                type: "retreat",
                label: "Retreats",
                retreats: [
                  {
                    id: "autumn-retreat",
                    title: "Autumn retreat",
                    durationDays: 2,
                    startDate: "2026-10-24",
                    startTime: "10:00",
                    endDate: "2026-10-25",
                    endTime: "16:00",
                    timezone: "Europe/Dublin",
                    capacity: 6,
                    pricing: {
                      enabled: true,
                      suggestedAmount: 300,
                      currency: "EUR",
                    },
                  },
                ],
              },
            ],
          },
        },
      },
      [],
    );

    const html = files["index.html"];
    expect(html).toContain('data-booking-type-tab="class"');
    expect(html).toContain('data-booking-type-tab="retreat"');
    expect(html).not.toContain("data-booking-type-tab=\"class\" disabled");
    expect(html).toContain('data-event-booking-widget');
    expect(html).toContain('name="quantity"');
    expect(html).toContain(
      "'/events/'+encodeURIComponent(config.bookingType)+'/'+encodeURIComponent(selected.id)+'/availability'",
    );
    expect(html).toContain("(paid?'checkout-session':'register')");
    expect(html).toContain("event_booking_pending");
    expect(html).toContain("params.get('purchase')==='success'");
    expect(html).toContain('"bookingType":"class"');
    expect(html).toContain('"bookingType":"retreat"');
  });

  it("publishes me3 vibe with rounded green CTAs and rounded blocks", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        name: "ME3 Site",
        links: { _vibe: "me3" },
        buttons: [{ text: "Personal AI Assistant", url: "https://example.com" }],
        intents: {
          subscribe: { enabled: true, title: "Newsletter" },
          book: {
            enabled: true,
            title: "Book a call",
            offers: [{ title: "ME3 Setup", duration: 60, pricing: { enabled: false } }],
          },
        },
      },
      [],
    );

    expect(files["index.html"]).toContain('body data-vibe="me3"');
    expect(files["index.html"]).toContain('<main class="main no-banner">');
    expect(files["index.html"]).toContain(".main.no-banner .profile-header{margin-top:0}");
    expect(files["index.html"]).toContain("--accent:#3d9b7c");
    expect(files["index.html"]).toContain(".cta-button.primary{background:var(--accent);color:#ffffff}");
    expect(files["index.html"]).toContain(".cta-button{display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:6px 16px;box-sizing:border-box;border-radius:var(--radius-md)");
    expect(files["index.html"]).toContain(".link-item{width:56px;height:56px;border-radius:999px");
    expect(files["index.html"]).toContain(".testimonials,.booking,.newsletter{margin:32px 0;padding:40px 48px;border-radius:24px;background:var(--border)}");
    expect(files["index.html"]).toContain(".content{margin:32px 0;padding:0 32px 32px;background:transparent;border-radius:0}");
    expect(files["index.html"]).toContain(".content h1{font-size:2.2rem;line-height:1.1;margin-top:0}");
    expect(files["index.html"]).toContain(".booking-card{font:inherit;color:inherit;width:100%;border:0;border-radius:16px");
    expect(files["index.html"]).toContain(".booking-slots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px");
    expect(files["index.html"]).toContain(".booking-slots{grid-template-columns:repeat(2,minmax(0,1fr))}");
    expect(files["index.html"]).toContain(".booking-back,.booking-submit{font:inherit;font-weight:800;border:0;border-radius:18px");
    expect(files["index.html"]).toContain("Confirm Booking");
    expect(files["index.html"]).toContain("placeholder=\"Your name\"");
    expect(files["index.html"]).toContain(".newsletter button{font:inherit;font-weight:800;min-height:48px;border:0;border-radius:var(--radius-md);background:var(--accent);color:#ffffff;padding:12px 22px");
  });

  it("publishes the paper vibe with editorial type and burnt-orange ink", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        name: "Paper Site",
        bio: "Notes from the edge of the page.",
        links: { _vibe: "paper" },
        buttons: [{ text: "Read the latest", url: "https://example.com" }],
      },
      [],
    );

    const html = files["index.html"];
    expect(html).toContain('body data-vibe="paper"');
    expect(html).toContain("family=Fraunces");
    expect(html).toContain("--bg:#efe5d7");
    expect(html).toContain("--surface:#fffaf2");
    expect(html).toContain("--accent:#b5522d");
    expect(html).toContain("body[data-vibe=paper] .name");
    expect(html).toContain("font-family:\"Fraunces\"");
    expect(html).toContain(
      "body[data-vibe=paper] .cta-button.primary{background:var(--accent);color:#fffaf2}",
    );
  });

  it("renders the retired natural vibe as paper", async () => {
    const files = await generateSiteHtml(
      {
        name: "Legacy Natural Site",
        links: { _vibe: "natural" },
      },
      [],
    );

    expect(files["index.html"]).toContain('body data-vibe="paper"');
    expect(files["index.html"]).toContain("--accent:#b5522d");
  });

  it("uses title-derived blog and offerings paths in generated navigation", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        name: "Path Site",
        pages: [{ slug: "writing", title: "Writing", file: "writing.md" }],
        posts: [
          {
            slug: "hello",
            title: "Hello",
            file: "blog/hello.md",
            publishedAt: "2026-02-03",
            excerpt: "A short hello from the blog.",
          },
        ],
        products: [
          {
            slug: "pai-setup",
            title: "Pai Setup",
            file: "shop/pai-setup.md",
            price: 7500,
            currency: "EUR",
            excerpt: "Get help setting up a personal AI assistant.",
          },
        ],
        blogTitle: "Writing",
        shopTitle: "Work With Me",
      },
      [
        { name: "writing.md", content: "# Writing" },
        { name: "blog/hello.md", content: "# Hello" },
        { name: "shop/pai-setup.md", content: "# Pai Setup" },
      ],
    );

    expect(files["work-with-me/index.html"]).toContain("Pai Setup");
    expect(files["work-with-me/index.html"]).toContain("75.00 EUR");
    expect(files["work-with-me/index.html"]).toContain("Get help setting up a personal AI assistant.");
    expect(files["work-with-me/pai-setup.html"]).toContain("<h1>Pai Setup</h1>");
    expect(files["writing-1/index.html"]).toContain("Hello");
    expect(files["writing-1/index.html"]).toContain("2/3/2026");
    expect(files["writing-1/index.html"]).toContain("A short hello from the blog.");
    expect(files["index.html"]).toContain('href="./work-with-me/"');
    expect(files["index.html"]).not.toContain('href="./shop/"');
  });

  it("excludes script and style contents from collection excerpts", async () => {
    const files = await generateSiteHtml(
      {
        version: "0.1",
        name: "Excerpt Site",
        posts: [{ slug: "safe", title: "Safe", file: "blog/safe.md", publishedAt: "2026-02-03" }],
      },
      [
        {
          name: "blog/safe.md",
          content: "Visible <script >do-not-include()</script > after <style >.hidden{display:none}</style > styling.",
        },
      ],
    );

    expect(files["blog/index.html"]).toContain("Visible");
    expect(files["blog/index.html"]).toContain("after");
    expect(files["blog/index.html"]).toContain("styling.");
    expect(files["blog/index.html"]).not.toContain("do-not-include");
    expect(files["blog/index.html"]).not.toContain(".hidden{display:none}");
  });
});

 it("renders checkout for products even without a markdown file", async () => {
   const profile = {name: "Shop", handle:"shop", products:[{slug:"book",title:"Book",file:"missing.md",price:100,currency:"EUR",excerpt:"A book"}]};
   const files = await generateSiteHtml(profile, []);
   expect(files["shop/book.html"]).toContain("1.00 EUR");
   expect(files["shop/book.html"]).toContain("Continue to checkout");
   expect(files["shop/book.html"]).toContain("data-product-checkout");
   const preview = await generateSiteHtml(profile, [], {productCheckoutEnabled:false});
   expect(preview["shop/book.html"]).not.toContain("<form data-product-checkout");
 });
