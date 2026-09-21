import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useWizardStore } from "./wizard";

describe("wizard store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should initialize with default values", () => {
      const store = useWizardStore();
      expect(store.currentStep).toBe(1);
      expect(store.furthestStep).toBe(1);
      expect(store.profile.name).toBe("");
      expect(store.profile.handle).toBe("");
      expect(store.profile.logo).toBeNull();
      expect(store.profile.navigationStyle).toBe("standard");
      expect(store.pages).toEqual([]);
      expect(store.username).toBe("");
      expect(store.draftSourceUrl).toBeNull();
    });

    it("should load state from localStorage", () => {
      const savedState = {
        currentStep: 3,
        profile: {
          name: "Test User",
          handle: "testuser",
          location: "",
          bio: "",
          avatar: null,
          banner: null,
          avatarBlob: null,
          bannerBlob: null,
          avatarOriginalBlob: null,
          bannerOriginalBlob: null,
          links: {},
          linkOrder: [],
          buttons: [],
          footer: {
            mode: "default",
            text: "",
            linkText: "",
            linkUrl: "",
          },
        },
        pages: [],
        username: "testuser",
        vibe: "warm",
        accentOverride: null,
        draftSourceUrl: "https://example.com",
      };
      localStorage.setItem("me3_wizard_state", JSON.stringify(savedState));

      const store = useWizardStore();
      expect(store.currentStep).toBe(3);
      expect(store.furthestStep).toBe(3);
      expect(store.profile.name).toBe("Test User");
      expect(store.username).toBe("testuser");
      expect(store.draftSourceUrl).toBe("https://example.com");
    });

    it("migrates the retired natural vibe to paper", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({
          profile: {
            name: "Test User",
            handle: "testuser",
            links: {},
            buttons: [],
          },
          pages: [],
          products: [],
          vibe: "natural",
        }),
      );

      const store = useWizardStore();

      expect(store.vibe).toBe("paper");
    });

    it("keeps the active editor when migrating a legacy numeric wizard step", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({
          currentStep: 4,
          furthestStep: 4,
          profile: {
            name: "Test User",
            handle: "testuser",
            links: {},
            buttons: [],
          },
          pages: [],
          products: [],
        }),
      );

      const store = useWizardStore();

      expect(store.linksEnabled).toBe(true);
      expect(store.currentStepId).toBe("links");
      expect(store.furthestStep).toBe(store.currentStep);
    });

    it("restores saved stable step ids after optional feature changes", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({
          optionalWebsiteFeaturesVersion: 1,
          currentStep: 4,
          furthestStep: 4,
          currentStepId: "pages",
          furthestStepId: "pages",
          pagesEnabled: false,
          profile: {
            name: "Test User",
            handle: "testuser",
            links: {},
            buttons: [],
          },
          pages: [],
          products: [],
        }),
      );

      const store = useWizardStore();

      expect(store.pagesEnabled).toBe(true);
      expect(store.currentStepId).toBe("pages");
      expect(store.furthestStep).toBe(store.currentStep);
    });

    it("repairs saved preview/undefined profile asset URLs", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({
          profile: {
            name: "Test User",
            handle: "testuser",
            avatar: "https://me3.kieranbutler.com/preview/undefined/files/avatar.jpg",
            banner: "/preview/undefined/files/banner.jpg",
          },
          username: "testuser",
        }),
      );

      const store = useWizardStore();

      expect(store.profile.avatar).toBe("/preview/testuser/files/avatar.jpg");
      expect(store.profile.banner).toBe("/preview/testuser/files/banner.jpg");
    });

    it("drops legacy standalone posts when loading posts from localStorage", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({
          posts: [
            { title: "Keep", slug: "hello", content: "", type: "article" },
            { title: "Legacy", slug: "_social-x", content: "", type: "article" },
            { title: "Content", slug: "_content-y", content: "", type: "article" },
            { title: "Type", slug: "note", content: "", type: "social" },
          ],
        }),
      );

      const store = useWizardStore();
      expect(store.posts.map((p) => p.slug)).toEqual(["hello"]);
    });

    it("clears persisted wizard state when a different user session is reconciled", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({
          ownerUserId: "user-with-site",
          currentStep: 3,
          profile: {
            name: "Existing User",
            handle: "existing-user",
          },
          username: "existing-user",
        }),
      );

      const store = useWizardStore();
      expect(store.profile.name).toBe("Existing User");

      store.reconcileSession("user-without-site");

      expect(store.currentStep).toBe(1);
      expect(store.profile.name).toBe("");
      expect(store.username).toBe("");
      expect(localStorage.getItem("me3_wizard_state")).toBeNull();
    });

    it("preserves persisted wizard state when the same user session is reconciled", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({
          ownerUserId: "same-user",
          currentStep: 2,
          profile: {
            name: "Same User",
            handle: "same-user",
          },
          username: "same-user",
        }),
      );

      const store = useWizardStore();
      store.reconcileSession("same-user");

      expect(store.currentStep).toBe(2);
      expect(store.profile.name).toBe("Same User");
      expect(store.username).toBe("same-user");
    });
  });

  describe("navigation", () => {
    it("should navigate to next step", () => {
      const store = useWizardStore();
      store.profile.name = "Test";
      store.profile.handle = "test";
      store.isUsernameAvailable = true;

      store.nextStep();

      expect(store.currentStep).toBe(2);
      expect(store.furthestStep).toBe(2);
    });

    it("should not proceed if validation fails", () => {
      const store = useWizardStore();
      store.profile.name = "T"; // Too short
      store.profile.handle = "te"; // Too short
      store.isUsernameAvailable = true;

      store.nextStep();

      expect(store.currentStep).toBe(1);
    });

    it("should navigate to previous step", () => {
      const store = useWizardStore();
      store.currentStep = 3;

      store.prevStep();

      expect(store.currentStep).toBe(2);
    });

    it("should not go below step 1", () => {
      const store = useWizardStore();
      store.currentStep = 1;

      store.prevStep();

      expect(store.currentStep).toBe(1);
    });

    it("should go to specific step", () => {
      const store = useWizardStore();

      store.goToStep(5);

      expect(store.currentStep).toBe(5);
      expect(store.furthestStep).toBe(5);
    });

    it("should not go to invalid step", () => {
      const store = useWizardStore();

      store.goToStep(0);
      expect(store.currentStep).toBe(1);

      store.goToStep(store.totalSteps + 1);
      expect(store.currentStep).toBe(1);
    });

    it("should keep furthest step when moving backward", () => {
      const store = useWizardStore();
      store.goToStep(4);

      store.prevStep();

      expect(store.currentStep).toBe(3);
      expect(store.furthestStep).toBe(4);
    });

    it("should go to a specific step id", () => {
      const store = useWizardStore();

      expect(store.goToStepId("pages", { enableOptional: true })).toBe(true);

      expect(store.currentStepName).toBe("Pages");
      expect(store.currentStepId).toBe("pages");
      expect(store.furthestStep).toBe(store.currentStep);
    });

    it("should normalize direct step aliases", () => {
      const store = useWizardStore();

      expect(store.normalizeWizardStepId("Additional Features")).toBe(
        "additional-features",
      );
      expect(store.normalizeWizardStepId("features")).toBe(
        "additional-features",
      );
      expect(store.normalizeWizardStepId("Shop")).toBe("offerings");
      expect(store.normalizeWizardStepId("cta")).toBe("call-to-action");
      expect(store.normalizeWizardStepId("missing")).toBeNull();
    });

    it("should enable optional steps when navigating directly", () => {
      const store = useWizardStore();

      expect(store.goToStepId("newsletter")).toBe(false);

      for (const stepId of [
        "newsletter",
        "bookings",
        "blog",
        "testimonials",
      ] as const) {
        expect(store.goToStepId(stepId, { enableOptional: true })).toBe(true);
        expect(store.currentStepId).toBe(stepId);
      }

      expect(store.newsletterEnabled).toBe(true);
      expect(store.bookingsEnabled).toBe(true);
      expect(store.blogEnabled).toBe(true);
      expect(store.testimonialsEnabled).toBe(true);
    });
  });

  describe("site-scoped drafts", () => {
    it("keeps profile and two organization drafts isolated by stable site id", () => {
      const store = useWizardStore();
      store.reconcileSession("owner-1");

      expect(
        store.activateDraftContext({
          siteId: "site-profile",
          username: "owner",
          role: "profile",
        }).restored,
      ).toBe(false);
      store.updateProfile({ name: "Owner", bio: "Profile draft" });
      store.pages = [
        {
          title: "Profile page",
          slug: "profile-page",
          content: "profile",
          images: [],
          visible: true,
        },
      ];
      store.saveToStorage();

      store.activateDraftContext({
        siteId: "site-studio",
        username: "studio",
        role: "organization",
      });
      expect(store.profile.name).toBe("");
      expect(store.pages).toEqual([]);
      store.updateProfile({
        name: "Studio",
        bio: "Studio draft",
        business: {
          ...store.profile.business,
          goals: [
            { id: "studio-goal", title: "Launch Studio", status: "active" },
          ],
        },
      });

      store.activateDraftContext({
        siteId: "site-community",
        username: "community",
        role: "organization",
      });
      expect(store.profile.name).toBe("");
      expect(store.username).toBe("community");
      expect(store.profile.business.goals).toEqual([]);
      store.updateProfile({ name: "Community", bio: "Community draft" });

      store.activateDraftContext({
        siteId: "site-studio",
        username: "studio",
        role: "organization",
      });
      expect(store.profile.name).toBe("Studio");
      expect(store.profile.bio).toBe("Studio draft");
      expect(store.pages).toEqual([]);
      expect(store.profile.business.goals.map((goal) => goal.title)).toEqual([
        "Launch Studio",
      ]);

      store.activateDraftContext({
        siteId: "site-profile",
        username: "owner",
        role: "profile",
      });
      expect(store.profile.name).toBe("Owner");
      expect(store.profile.bio).toBe("Profile draft");
      expect(store.pages.map((page) => page.slug)).toEqual(["profile-page"]);
    });

    it("migrates a matching legacy profile draft into its scoped key once", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({
          ownerUserId: "owner-1",
          siteRole: "profile",
          username: "owner-new",
          profile: { name: "Recovered Owner", handle: "owner-new" },
        }),
      );
      const store = useWizardStore();
      store.reconcileSession("owner-1");

      const result = store.activateDraftContext({
        siteId: "site-profile",
        username: "owner",
        role: "profile",
      });

      expect(result).toEqual({ restored: true, migratedLegacy: true });
      expect(store.profile.name).toBe("Recovered Owner");
      expect(store.username).toBe("owner-new");
      expect(store.selectedSiteId).toBe("site-profile");
      expect(localStorage.getItem("me3_wizard_state")).toBeNull();
    });

    it("uses role-appropriate core steps without duplicating the wizard", () => {
      const store = useWizardStore();
      store.activateDraftContext({ role: "organization" });

      expect(store.stepIds).toContain("goals");
      expect(store.stepIds).not.toContain("wheel-of-life");
      expect(store.stepNames).toContain("Logo");
      expect(store.stepNames).toContain("Who you help");

      store.activateDraftContext({ role: "profile" });
      expect(store.stepIds).not.toContain("goals");
      expect(store.stepIds).not.toContain("wheel-of-life");
      expect(store.stepNames).toContain("Avatar");
      expect(store.stepNames).toContain("Who you help");
    });
  });

  describe("profile updates", () => {
    it("should update profile", () => {
      const store = useWizardStore();

      store.updateProfile({ name: "New Name", bio: "New bio" });

      expect(store.profile.name).toBe("New Name");
      expect(store.profile.bio).toBe("New bio");
    });

    it("should set footer", () => {
      const store = useWizardStore();

      store.setFooter({ mode: "custom", text: "Custom footer" });

      expect(store.profile.footer.mode).toBe("custom");
      expect(store.profile.footer.text).toBe("Custom footer");
    });
  });

  describe("links", () => {
    it("should set link", () => {
      const store = useWizardStore();

      store.setLink("github", "octocat");

      expect(store.profile.links.github).toBe("octocat");
      expect(store.profile.linkOrder).toContain("github");
    });

    it("should remove link", () => {
      const store = useWizardStore();
      store.profile.links = { github: "octocat" };
      store.profile.linkOrder = ["github"];

      store.removeLink("github");

      expect(store.profile.links.github).toBeUndefined();
      expect(store.profile.linkOrder).not.toContain("github");
    });

    it("should set link order", () => {
      const store = useWizardStore();
      store.profile.links = { github: "octocat", twitter: "user" };
      store.profile.linkOrder = ["github", "twitter"];

      store.setLinkOrder(["twitter", "github"]);

      expect(store.profile.linkOrder).toEqual(["twitter", "github"]);
    });
  });

  describe("buttons", () => {
    it("should add button", () => {
      const store = useWizardStore();

      store.addButton({
        text: "Click me",
        url: "https://example.com",
        style: "primary",
      });

      expect(store.profile.buttons).toHaveLength(1);
      expect(store.profile.buttons[0].text).toBe("Click me");
    });

    it("should allow more than the old three-button cap", () => {
      const store = useWizardStore();

      for (let i = 0; i < 6; i++) {
        store.addButton({
          text: `Button ${i}`,
          url: "https://example.com",
        });
      }

      expect(store.profile.buttons).toHaveLength(6);
    });

    it("should update button", () => {
      const store = useWizardStore();
      store.profile.buttons = [{ text: "Old", url: "https://example.com" }];

      store.updateButton(0, { text: "New", url: "https://example.com" });

      expect(store.profile.buttons[0].text).toBe("New");
    });

    it("should remove button", () => {
      const store = useWizardStore();
      store.profile.buttons = [
        { text: "Button 1", url: "https://example.com" },
        { text: "Button 2", url: "https://example.com" },
      ];

      store.removeButton(0);

      expect(store.profile.buttons).toHaveLength(1);
      expect(store.profile.buttons[0].text).toBe("Button 2");
    });
  });

  describe("pages", () => {
    it("should add page", () => {
      const store = useWizardStore();

      const page = store.addPage("About");

      expect(page).not.toBeNull();
      expect(store.pages).toHaveLength(1);
      expect(store.pages[0].title).toBe("About");
      expect(store.pages[0].slug).toBe("about");
    });

    it("should generate slug from title", () => {
      const store = useWizardStore();

      store.addPage("My Awesome Page!");

      expect(store.pages[0].slug).toBe("my-awesome-page");
    });

    it("should ensure unique slugs", () => {
      const store = useWizardStore();

      store.addPage("Test");
      store.addPage("Test");

      expect(store.pages[0].slug).toBe("test");
      expect(store.pages[1].slug).toBe("test-1");
    });

    it("should not add more than MAX_PAGES", () => {
      const store = useWizardStore();

      for (let i = 0; i < 51; i++) {
        store.addPage(`Page ${i}`);
      }

      expect(store.pages.length).toBeLessThanOrEqual(store.maxPages);
    });

    it("should update page", () => {
      const store = useWizardStore();
      store.addPage("Old Title");

      store.updatePage(0, { title: "New Title" });

      expect(store.pages[0].title).toBe("New Title");
    });

    it("normalizes one-level navigation group labels", () => {
      const store = useWizardStore();
      store.addPage("Private Sessions");

      store.updatePage(0, { navigationGroup: "  Services   and offers  " });
      expect(store.pages[0].navigationGroup).toBe("Services and offers");

      store.updatePage(0, { navigationGroup: "" });
      expect(store.pages[0].navigationGroup).toBeUndefined();
    });

    it("keeps auto-generated page slugs in sync with title changes", () => {
      const store = useWizardStore();
      store.addPage("Old Title");

      store.updatePage(0, { title: "New Title" });

      expect(store.pages[0].slug).toBe("new-title");
      expect(store.pages[0].slugCustomized).toBe(false);
    });

    it("preserves a custom page slug when the title changes", () => {
      const store = useWizardStore();
      store.addPage("Work With Me");

      store.updatePage(0, { slug: "me3-setup-limited-offer" });
      store.updatePage(0, { title: "Updated Offer" });

      expect(store.pages[0].slug).toBe("me3-setup-limited-offer");
      expect(store.pages[0].slugCustomized).toBe(true);
    });

    it("falls back to an auto slug when a custom page slug is cleared", () => {
      const store = useWizardStore();
      store.addPage("Work With Me");

      store.updatePage(0, { slug: "me3-setup-limited-offer" });
      store.updatePage(0, { slug: "" });

      expect(store.pages[0].slug).toBe("work-with-me");
      expect(store.pages[0].slugCustomized).toBe(false);
    });

    it("should remove page", () => {
      const store = useWizardStore();
      store.addPage("Page 1");
      store.addPage("Page 2");

      store.removePage(0);

      expect(store.pages).toHaveLength(1);
      expect(store.pages[0].title).toBe("Page 2");
    });

    it("should move a page to a new position", () => {
      const store = useWizardStore();
      store.addPage("About");
      store.addPage("Services");
      store.addPage("Contact");

      store.movePage(2, 0);

      expect(store.pages.map((page) => page.title)).toEqual([
        "Contact",
        "About",
        "Services",
      ]);
    });
  });

  describe("custom routes", () => {
    it("preserves a custom post slug when the title changes", () => {
      const store = useWizardStore();
      store.addPost("Original Post");

      store.updatePost(0, { slug: "launch-notes" });
      store.updatePost(0, { title: "Updated Post" });

      expect(store.posts[0].slug).toBe("launch-notes");
      expect(store.posts[0].slugCustomized).toBe(true);
    });

    it("preserves a custom product slug when the title changes", () => {
      const store = useWizardStore();
      store.addProduct("Original Product");

      store.updateProduct(0, { slug: "me3-setup-limited-offer" });
      store.updateProduct(0, { title: "Updated Product" });

      expect(store.products[0].slug).toBe("me3-setup-limited-offer");
      expect(store.products[0].slugCustomized).toBe(true);
    });

    it("normalizes invalid product prices when updating a product", () => {
      const store = useWizardStore();
      store.addProduct("Setup");

      store.updateProduct(0, { price: Number.NaN });

      expect(store.products[0].price).toBe(0);
    });
  });

  describe("page images", () => {
    it("should add page image", () => {
      const store = useWizardStore();
      store.addPage("Test Page");
      const blob = new Blob(["image data"], { type: "image/png" });

      const result = store.addPageImage(0, {
        id: "img1",
        blob,
        mimeType: "image/png",
        ext: "png",
      });

      expect(result).not.toBeNull();
      expect(store.pages[0].images).toHaveLength(1);
      expect(store.pages[0].images[0].id).toBe("img1");
    });

    it("should remove page image", () => {
      const store = useWizardStore();
      store.addPage("Test Page");
      const blob = new Blob(["image data"], { type: "image/png" });
      store.addPageImage(0, {
        id: "img1",
        blob,
        mimeType: "image/png",
        ext: "png",
      });

      store.removePageImage(0, "img1");

      expect(store.pages[0].images).toHaveLength(0);
    });

    it("should sync page images", () => {
      const store = useWizardStore();
      store.addPage("Test Page");
      const blob = new Blob(["image data"], { type: "image/png" });
      store.addPageImage(0, {
        id: "img1",
        blob,
        mimeType: "image/png",
        ext: "png",
      });
      store.addPageImage(0, {
        id: "img2",
        blob,
        mimeType: "image/png",
        ext: "png",
      });

      store.syncPageImages(0, new Set(["img1"]));

      expect(store.pages[0].images).toHaveLength(1);
      expect(store.pages[0].images[0].id).toBe("img1");
    });
  });

  describe("generateMe3Json", () => {
    it("should generate basic me.json", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.profile.handle = "testuser";

      const me3 = store.generateMe3Json() as any;

      expect(me3.version).toBe("0.1");
      expect(me3.name).toBe("Test User");
      expect(me3.handle).toBe("testuser");
    });

    it("should include structured public location data", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.updateProfile({
        location: "Cork, County Cork, Ireland",
        locationData: {
          label: "Cork, County Cork, Ireland",
          latitude: 51.89797,
          longitude: -8.47061,
          precision: "city",
          locality: "Cork",
          region: "County Cork",
          country: "Ireland",
          countryCode: "IE",
          source: {
            provider: "photon",
            id: "N:123",
            osmType: "N",
            osmId: 123,
            osmKey: "place",
            osmValue: "city",
          },
        },
      });

      const me3 = store.generateMe3Json() as any;

      expect(me3.location).toBe("Cork, County Cork, Ireland");
      expect(me3.locationData).toEqual({
        label: "Cork, County Cork, Ireland",
        latitude: 51.89797,
        longitude: -8.47061,
        precision: "city",
        locality: "Cork",
        region: "County Cork",
        country: "Ireland",
        countryCode: "IE",
        source: {
          provider: "photon",
          id: "N:123",
          osmType: "N",
          osmId: 123,
          osmKey: "place",
          osmValue: "city",
        },
      });
    });

    it("should clear structured location data when the display location changes", () => {
      const store = useWizardStore();
      store.updateProfile({
        location: "Cork, County Cork, Ireland",
        locationData: {
          label: "Cork, County Cork, Ireland",
          latitude: 51.89797,
          longitude: -8.47061,
          precision: "city",
        },
      });

      store.updateProfile({ location: "Remote" });

      expect(store.profile.locationData).toBeNull();
    });

    it("should include links", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.linksEnabled = true;
      store.setLink("github", "octocat");
      store.setLink("twitter", "user");

      const me3 = store.generateMe3Json() as any;

      expect(me3.links).toEqual({
        github: "octocat",
        twitter: "user",
      });
    });

    it("should include buttons", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.callToActionEnabled = true;
      store.addButton({ text: "Click", url: "https://example.com" });

      const me3 = store.generateMe3Json() as any;

      expect(me3.buttons).toHaveLength(1);
      expect(me3.buttons?.[0].text).toBe("Click");
    });

    it("should include pages", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.pagesEnabled = true;
      store.addPage("About");

      const me3 = store.generateMe3Json() as any;

      expect(me3.pages).toHaveLength(1);
      expect(me3.pages?.[0].slug).toBe("about");
    });

    it("includes page navigation groups in the private site source", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.pagesEnabled = true;
      store.addPage("Private Sessions");
      store.updatePage(0, { navigationGroup: "Services" });

      const me3 = store.generateMe3Json() as any;

      expect(me3.pages?.[0].navigationGroup).toBe("Services");
    });

    it("stores compact navigation as a private site extension", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";

      store.updateProfile({ navigationStyle: "compact" });
      expect((store.generateMe3Json() as any).links).toEqual({
        _navigation_style: "compact",
      });

      store.updateProfile({ navigationStyle: "standard" });
      expect((store.generateMe3Json() as any).links).toBeUndefined();
    });

    it("should include custom blog and shop titles when set", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.blogEnabled = true;
      store.shopEnabled = true;
      store.blogTitle = "Articles";
      store.shopTitle = "Services";
      store.posts = [
        {
          title: "Hello",
          slug: "hello",
          content: "",
          images: [],
        },
      ];
      store.products = [
        {
          title: "Consulting",
          slug: "consulting",
          content: "",
          images: [],
          price: 5000,
          currency: "USD",
          available: true,
          paymentMethod: "stripe",
          paymentInstructions: "",
        },
      ];

      const me3 = store.generateMe3Json() as any;

      expect(me3.blogTitle).toBe("Articles");
      expect(me3.shopTitle).toBe("Services");
    });

    it("publishes Products as the default product section title", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.shopEnabled = true;
      store.products = [
        {
          title: "Guide",
          slug: "guide",
          content: "",
          images: [],
          price: 2000,
          currency: "USD",
          available: true,
          paymentMethod: "stripe",
          paymentInstructions: "",
        },
      ];

      const me3 = store.generateMe3Json() as any;

      expect(me3.shopTitle).toBe("Products");
    });

    it("should include blogEnabled when blog is enabled without posts", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.blogEnabled = true;
      store.blogTitle = "Articles";

      const me3 = store.generateMe3Json() as any;

      expect(me3.blogEnabled).toBe(true);
      expect(me3.blogTitle).toBe("Articles");
      expect(me3.posts).toBeUndefined();
    });

    it("should derive blog and shop paths from the main menu titles", () => {
      const store = useWizardStore();
      store.addPage("Work With Me");
      store.pagesEnabled = true;
      store.blogTitle = "Writing";
      store.shopTitle = "Work with me";
      store.testimonialsTitle = "Kind Words";

      expect(store.blogPath).toBe("writing");
      expect(store.shopPath).toBe("work-with-me-1");
      expect(store.testimonialsPath).toBe("kind-words");
    });

    it("includes testimonials without legacy placement metadata", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.testimonialsEnabled = true;
      store.testimonialsPlacement = "standalone";
      store.addTestimonial({
        name: "Jamie",
        quote: "An incredible experience.",
        handle: "jamie",
      });

      const me3 = store.generateMe3Json();

      expect(me3.testimonials).toHaveLength(1);
      expect(me3.testimonials?.[0].name).toBe("Jamie");
      expect(me3.testimonialDisplay).toBeUndefined();
    });

    it("should use files path for testimonial avatars when avatarBlob is set", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.testimonialsEnabled = true;
      const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
        type: "image/jpeg",
      });
      store.addTestimonial({
        name: "Jamie",
        quote: "An incredible experience.",
        avatar: "blob:http://local/fake",
        avatarBlob: blob,
      });

      const me3 = store.generateMe3Json();

      expect(me3.testimonials?.[0].avatar).toBe("./files/testimonial-1.jpg");
    });

    it("should strip preview prefixes from published profile image paths", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.profile.logo = "/preview/testuser/files/logo.webp";
      store.profile.avatar = "./preview/testuser/files/avatar.jpg";
      store.profile.banner = "/preview/testuser/files/banner.jpg";

      const me3 = store.generateMe3Json();

      expect(me3.logo).toBe("./files/logo.webp");
      expect(me3.avatar).toBe("./files/avatar.jpg");
      expect(me3.banner).toBe("./files/banner.jpg");
    });

    it("should use the uploaded logo file path in site source", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.updateProfile({
        logo: "blob:http://local/site-logo",
        logoBlob: new Blob(["logo"], { type: "image/png" }),
      });

      expect(store.generateMe3Json().logo).toBe("./files/logo.png");
    });

    it("does not export legacy testimonial placement targets", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.shopEnabled = true;
      store.testimonialsEnabled = true;
      store.testimonialsPlacement = "shop";
      store.addProduct("Consulting");
      store.addTestimonial({
        name: "Jamie",
        quote: "An incredible experience.",
      });

      const me3 = store.generateMe3Json();

      expect(me3.testimonialDisplay).toBeUndefined();
      expect(me3.links?._testimonials_placement).toBeUndefined();
    });

    it("should include vibe if not default", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.setVibe("tech");

      const me3 = store.generateMe3Json();

      expect(me3.links?._vibe).toBe("tech");
    });

    it("should include accent override", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.setAccentOverride("#ff0000");

      const me3 = store.generateMe3Json();

      expect(me3.links?._accent).toBe("#ff0000");
    });

  });

  describe("reset", () => {
    it("preserves the layout through drafts and published source, then resets to Classic", () => {
      const store = useWizardStore();
      expect(store.profile.layout).toBe("classic");
      expect(store.generateMe3Json().links?._layout).toBeUndefined();
      store.updateProfile({ name: "Portrait profile", layout: "portrait" });
      const source = store.generateMe3Json();
      expect(source.links?._layout).toBe("portrait");
      setActivePinia(createPinia());
      const restored = useWizardStore();
      expect(restored.profile.layout).toBe("portrait");
      restored.loadFromSiteContent({ name: source.name || "Portrait profile", links: source.links }, [], [], [], "portrait");
      expect(restored.profile.layout).toBe("portrait");
      expect(restored.profile.links._layout).toBeUndefined();
      restored.updateProfile({ layout: "classic" });
      expect(restored.generateMe3Json().links?._layout).toBeUndefined();
      restored.reset();
      expect(restored.profile.layout).toBe("classic");
    });

    it("keeps older sites on Classic and normalizes unknown layouts", () => {
      const store = useWizardStore();
      store.loadFromSiteContent({ name: "Older site" }, [], [], [], "older");
      expect(store.profile.layout).toBe("classic");
      store.loadFromSiteContent({ name: "Unknown", links: { _layout: "unknown" } }, [], [], [], "unknown");
      expect(store.profile.layout).toBe("classic");
    });

    it("should reset all state", () => {
      const store = useWizardStore();
      store.profile.name = "Test";
      store.currentStep = 5;
      store.blogTitle = "Articles";
      store.shopTitle = "Services";
      store.addPage("Test Page");

      store.reset();

      expect(store.profile.name).toBe("");
      expect(store.currentStep).toBe(1);
      expect(store.blogTitle).toBe("Blog");
      expect(store.shopTitle).toBe("Products");
      expect(store.pages).toHaveLength(0);
      expect(localStorage.getItem("me3_wizard_state")).toBeNull();
      expect(store.draftSourceUrl).toBeNull();
    });
  });

  describe("loadFromSiteContent", () => {
    it("should load profile from site content", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Existing User",
        handle: "existing",
        bio: "Existing bio",
        links: { github: "octocat" },
        buttons: [{ text: "Button", url: "https://example.com" }],
      };
      const sitePages = [{ slug: "about", title: "About", content: "Content" }];

      store.loadFromSiteContent(siteProfile, sitePages, [], [], "existing");

      expect(store.profile.name).toBe("Existing User");
      expect(store.profile.handle).toBe("existing");
      expect(store.profile.bio).toBe("Existing bio");
      expect(store.profile.links.github).toBe("octocat");
      expect(store.profile.buttons).toHaveLength(1);
      expect(store.pages).toHaveLength(1);
      expect(store.username).toBe("existing");
      expect(store.isUsernameAvailable).toBe(true);
    });

    it("upgrades a published natural vibe to paper when editing", () => {
      const store = useWizardStore();

      store.loadFromSiteContent(
        {
          name: "Existing User",
          handle: "existing",
          links: { _vibe: "natural" },
        },
        [],
        [],
        [],
        "existing",
      );

      expect(store.vibe).toBe("paper");
      expect(store.generateMe3Json().links?._vibe).toBe("paper");
    });

    it("keeps the selected additional-site role when loading site content", () => {
      const store = useWizardStore();

      store.loadFromSiteContent(
        { name: "Studio", handle: "studio" },
        [],
        [],
        [],
        "studio",
        null,
        undefined,
        "organization",
      );

      expect(store.siteRole).toBe("organization");
      expect(
        JSON.parse(localStorage.getItem("me3_wizard_state") || "{}").siteRole,
      ).toBe("organization");
    });

    it("falls back to the profile handle when resolving loaded site assets without a username", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Existing User",
        handle: "existing",
        logo: "./files/logo.png",
        avatar: "./files/avatar.jpg",
        banner: "/preview/undefined/files/banner.jpg",
      };

      store.loadFromSiteContent(siteProfile, [], [], [], undefined);

      expect(store.username).toBe("existing");
      expect(store.profile.logo).toBe("/preview/existing/files/logo.png");
      expect(store.profile.avatar).toBe("/preview/existing/files/avatar.jpg");
      expect(store.profile.banner).toBe("/preview/existing/files/banner.jpg");
    });

    it("should load lastPublishedAt when provided", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Published User",
        handle: "published",
      };
      const publishedAt = "2024-01-15T12:00:00Z";

      store.loadFromSiteContent(siteProfile, [], [], [], "published", publishedAt);

      expect(store.lastPublishedAt).toBe(publishedAt);
      expect(store.needsPublish).toBe(false);
    });

    it("should not set lastPublishedAt when not provided", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "New User",
        handle: "new",
      };

      store.loadFromSiteContent(siteProfile, [], [], [], "new");

      expect(store.lastPublishedAt).toBeNull();
      expect(store.needsPublish).toBe(true);
    });

    it("should persist the imported source URL when provided", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Imported User",
        handle: "imported",
      };

      store.loadFromSiteContent(
        siteProfile,
        [],
        [],
        [],
        "imported",
        undefined,
        "https://example.com",
      );

      expect(store.draftSourceUrl).toBe("https://example.com");
    });

    it("excludes standalone / legacy social posts from wizard blog (slug and type)", () => {
      const store = useWizardStore();
      const siteProfile = { name: "User", handle: "user" };
      const sitePosts = [
        {
          slug: "hello",
          title: "Hello",
          content: "<p>x</p>",
          type: "article" as const,
        },
        {
          slug: "_social-legacy",
          title: "Legacy",
          content: "",
          type: "article" as const,
        },
        {
          slug: "_content-abc",
          title: "Standalone",
          content: "",
          type: "article" as const,
        },
        {
          slug: "promo",
          title: "Promo",
          content: "",
          type: "social" as const,
        },
      ];

      store.loadFromSiteContent(siteProfile, [], sitePosts, [], "user");

      expect(store.posts).toHaveLength(1);
      expect(store.posts[0].slug).toBe("hello");
      expect(store.blogEnabled).toBe(true);
    });

    it("does not enable blog when only standalone content slugs exist", () => {
      const store = useWizardStore();
      const siteProfile = { name: "User", handle: "user" };
      store.loadFromSiteContent(
        siteProfile,
        [],
        [
          {
            slug: "_content-only",
            title: "S",
            content: "",
            type: "article",
          },
        ],
        [],
        "user",
      );

      expect(store.posts).toHaveLength(0);
      expect(store.blogEnabled).toBe(false);
    });

    it("should restore blogEnabled from site content without posts", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Existing User",
        blogEnabled: true,
      };

      store.loadFromSiteContent(siteProfile, [], [], [], "existing");

      expect(store.posts).toHaveLength(0);
      expect(store.blogEnabled).toBe(true);
    });

    it("should restore custom blog and shop titles from site content", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Existing User",
        blogTitle: "Articles",
        shopTitle: "Services",
      };

      store.loadFromSiteContent(siteProfile, [], [], [], "existing");

      expect(store.blogTitle).toBe("Articles");
      expect(store.shopTitle).toBe("Services");
    });

    it("restores the compact navigation layout from site content", () => {
      const store = useWizardStore();

      store.loadFromSiteContent(
        {
          name: "Existing User",
          links: { _navigation_style: "compact" },
        },
        [],
        [],
        [],
        "existing",
      );

      expect(store.profile.navigationStyle).toBe("compact");
    });

    it("normalizes invalid product prices loaded from site content", () => {
      const store = useWizardStore();
      const siteProfile = { name: "Existing User" };
      const siteProducts = [
        {
          slug: "setup",
          title: "Setup",
          content: "<p>Setup details</p>",
          price: Number.NaN,
          currency: "EUR" as const,
        },
      ];

      store.loadFromSiteContent(siteProfile, [], [], siteProducts, "existing");

      expect(store.products[0].price).toBe(0);
      expect(store.products[0].currency).toBe("EUR");
    });

    it("should preserve page order from site profile metadata", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Existing User",
        pages: [
          { slug: "services", title: "Services", file: "services.md", visible: true, navigationGroup: "Work with me" },
          { slug: "about", title: "About", file: "about.md", visible: true },
        ],
      };
      const sitePages = [
        { slug: "about", title: "About", content: "About content" },
        { slug: "services", title: "Services", content: "Services content" },
      ];

      store.loadFromSiteContent(siteProfile, sitePages, [], [], "existing");

      expect(store.pages.map((page) => page.slug)).toEqual([
        "services",
        "about",
      ]);
      expect(store.pages[0].navigationGroup).toBe("Work with me");
    });
  });

  describe("canProceed", () => {
    it("should allow proceeding from step 1 with valid data", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.profile.handle = "testuser";
      store.isUsernameAvailable = true;

      expect(store.canProceed).toBe(true);
    });

    it("should not allow proceeding from step 1 with invalid data", () => {
      const store = useWizardStore();
      store.profile.name = "T"; // Too short
      store.profile.handle = "te"; // Too short
      store.isUsernameAvailable = true;

      expect(store.canProceed).toBe(false);
    });

    it("should allow proceeding from optional steps", () => {
      const store = useWizardStore();
      store.currentStep = 2;

      expect(store.canProceed).toBe(true);
    });
  });

  describe("newsletter", () => {
    it("should initialize with default newsletter config", () => {
      const store = useWizardStore();
      expect(store.profile.newsletter.enabled).toBe(true);
      expect(store.profile.newsletter.title).toBe("");
      expect(store.profile.newsletter.description).toBe("");
      expect(store.profile.newsletter.doubleOptIn).toBe(true);
    });

    it("should set newsletter config", () => {
      const store = useWizardStore();
      store.setNewsletter({ enabled: true });
      expect(store.profile.newsletter.enabled).toBe(true);

      store.setNewsletter({ title: "My Newsletter" });
      expect(store.profile.newsletter.title).toBe("My Newsletter");

      store.setNewsletter({ description: "Subscribe for updates" });
      expect(store.profile.newsletter.description).toBe(
        "Subscribe for updates",
      );

      store.setNewsletter({ doubleOptIn: false });
      expect(store.profile.newsletter.doubleOptIn).toBe(false);
    });

    it("should update newsletter config partially", () => {
      const store = useWizardStore();
      store.setNewsletter({ enabled: true, title: "Newsletter" });

      expect(store.profile.newsletter.enabled).toBe(true);
      expect(store.profile.newsletter.title).toBe("Newsletter");
    });

    it("should include newsletter intent in me.json when enabled", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.profile.handle = "testuser";
      store.setNewsletter({
        enabled: true,
        title: "My Newsletter",
        description: "Weekly updates",
      });

      const me3 = store.generateMe3Json();
      expect(me3.intents?.subscribe).toBeDefined();
      expect(me3.intents?.subscribe?.enabled).toBe(true);
      expect(me3.intents?.subscribe?.title).toBe("My Newsletter");
      expect(me3.intents?.subscribe?.description).toBe("Weekly updates");
      expect(me3.intents?.subscribe?.doubleOptIn).toBe(true);
      expect((me3 as any).actions?.subscribe).toEqual({
        method: "POST",
        url: "http://localhost:3000/api/sites/testuser/subscribe",
        requires: ["email"],
        description: "Subscribe someone to this site's newsletter.",
      });
    });

    it("should not include newsletter intent when disabled", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.setNewsletter({ enabled: false });

      const me3 = store.generateMe3Json();
      expect(me3.intents?.subscribe).toBeUndefined();
    });

    it("should only include non-empty newsletter fields in me.json", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.setNewsletter({
        enabled: true,
        title: "",
        description: "",
      });

      const me3 = store.generateMe3Json();
      expect(me3.intents?.subscribe?.enabled).toBe(true);
      expect(me3.intents?.subscribe?.title).toBeUndefined();
      expect(me3.intents?.subscribe?.description).toBeUndefined();
    });

    it("should load newsletter config from site content", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Test User",
        intents: {
          subscribe: {
            enabled: true,
            title: "Newsletter Title",
            description: "Newsletter Description",
            doubleOptIn: true,
          },
        },
      };

      store.loadFromSiteContent(siteProfile, [], [], [], "testuser");
      expect(store.profile.newsletter.enabled).toBe(true);
      expect(store.profile.newsletter.title).toBe("Newsletter Title");
      expect(store.profile.newsletter.description).toBe(
        "Newsletter Description",
      );
      expect(store.profile.newsletter.doubleOptIn).toBe(true);
    });

    it("keeps existing newsletter sites on single opt-in until enabled", () => {
      const store = useWizardStore();

      store.loadFromSiteContent({
        name: "Existing Site",
        intents: { subscribe: { enabled: true } },
      }, [], [], [], "existing-site");

      expect(store.profile.newsletter.doubleOptIn).toBe(false);
    });

    it("should use default newsletter config when not in site content", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Test User",
      };

      store.loadFromSiteContent(siteProfile, [], [], [], "testuser");
      expect(store.newsletterEnabled).toBe(false);
      expect(store.profile.newsletter.enabled).toBe(false);
      expect(store.profile.newsletter.title).toBe("");
    });

    it("should load testimonial placement from a link extension", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Test User",
        testimonials: [
          {
            name: "Jamie",
            quote: "An incredible experience.",
          },
        ],
        links: {
          _testimonials_placement: "page:about",
        },
      };
      const sitePages = [
        {
          slug: "about",
          title: "About",
          file: "about.md",
          visible: true,
          content: "About content",
        },
      ];

      store.loadFromSiteContent(siteProfile, sitePages, [], [], "testuser");

      expect(store.testimonialsPlacement).toBe("page:about");
    });
  });

  describe("booking", () => {
    it("does not export legacy booking placement targets", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.profile.booking.enabled = true;
      store.bookingPlacement = "standalone";

      expect(store.generateMe3Json().links?._booking_placement).toBeUndefined();
    });

    it("should initialize with default booking config", () => {
      const store = useWizardStore();
      expect(store.profile.booking.enabled).toBe(true);
      expect(store.profile.booking.title).toBe("");
      expect(store.profile.booking.description).toBe("");
      expect(store.profile.booking.duration).toBe(30);
      expect(store.profile.booking.availability.monday).toEqual([
        "09:00-17:00",
      ]);
      expect(store.profile.booking.pricing?.allowFlexiblePricing).toBe(true);
      expect(store.profile.booking.pricing?.allowFree).toBe(false);
    });

    it("should set booking config", () => {
      const store = useWizardStore();
      store.setBooking({ enabled: true });
      expect(store.profile.booking.enabled).toBe(true);

      store.setBooking({ title: "Book a Call" });
      expect(store.profile.booking.title).toBe("Book a Call");

      store.setBooking({ description: "Schedule a meeting" });
      expect(store.profile.booking.description).toBe("Schedule a meeting");

      store.setBooking({ duration: 60 });
      expect(store.profile.booking.duration).toBe(60);

      store.setBooking({ timezone: "America/New_York" });
      expect(store.profile.booking.timezone).toBe("America/New_York");
    });

    it("should preserve 2-hour booking durations when loading site content", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Test User",
        intents: {
          book: {
            enabled: true,
            title: "Deep Dive",
            duration: 120,
            availability: {
              timezone: "UTC",
              windows: {
                monday: ["09:00-17:00"],
              },
            },
          },
        },
      };

      store.loadFromSiteContent(siteProfile, [], [], [], "testuser");

      expect(store.profile.booking.duration).toBe(120);
      expect(store.profile.booking.offers[0]?.duration).toBe(120);
    });

    it("should set booking availability for a day", () => {
      const store = useWizardStore();
      store.setBookingAvailability("monday", ["09:00-17:00"]);

      expect(store.profile.booking.availability.monday).toEqual([
        "09:00-17:00",
      ]);
      expect(store.profile.booking.availability.tuesday).toEqual([
        "09:00-17:00",
      ]);
    });

    it("should update booking availability for multiple days", () => {
      const store = useWizardStore();
      store.setBookingAvailability("monday", ["09:00-12:00", "14:00-17:00"]);
      store.setBookingAvailability("friday", ["10:00-15:00"]);

      expect(store.profile.booking.availability.monday).toEqual([
        "09:00-12:00",
        "14:00-17:00",
      ]);
      expect(store.profile.booking.availability.friday).toEqual([
        "10:00-15:00",
      ]);
    });

    it("should include booking intent in me.json when enabled with availability", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.profile.handle = "testuser";
      store.setBooking({
        enabled: true,
        oneToOneEnabled: true,
        title: "Book a Call",
        description: "Schedule a meeting",
        duration: 30,
        timezone: "UTC",
      });
      store.setBookingAvailability("monday", ["09:00-17:00"]);
      store.setBookingAvailability("wednesday", ["10:00-14:00"]);
      store.updateBookingOffer(store.profile.booking.offers[0].id, {
        description: "Schedule a meeting",
      });

      const me3 = store.generateMe3Json();
      expect(me3.intents?.book).toBeDefined();
      expect(me3.intents?.book?.enabled).toBe(true);
      expect(me3.intents?.book?.title).toBe("Book a Call");
      expect(me3.intents?.book?.description).toBe("Schedule a meeting");
      expect(me3.intents?.book?.duration).toBe(30);
      expect(me3.intents?.book?.availability?.timezone).toBe("UTC");
      expect(me3.intents?.book?.availability?.windows?.monday).toEqual([
        "09:00-17:00",
      ]);
      expect(me3.intents?.book?.availability?.windows?.wednesday).toEqual([
        "10:00-14:00",
      ]);
      expect((me3 as any).services).toEqual([
        {
          id: "book-a-call",
          title: "Book a Call",
          description: "Schedule a meeting",
          sessionType: "1:1",
          duration: 30,
          availabilityMode: "native",
          status: "active",
        },
      ]);
      expect((me3 as any).actions?.checkAvailability).toEqual({
        method: "GET",
        url: "http://localhost:3000/api/book/testuser/slots{?date}",
        requires: ["date"],
        description: "Return available booking slots for a given date.",
      });
      expect((me3 as any).actions?.createBooking).toEqual({
        method: "POST",
        url: "http://localhost:3000/api/book/testuser/confirm",
        requires: ["slotStart", "slotEnd", "guestName", "guestEmail"],
        description: "Create a confirmed booking for a selected slot.",
      });
    });

    it("should not include booking intent when disabled", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.setBooking({ enabled: false });

      const me3 = store.generateMe3Json();
      expect(me3.intents?.book).toBeUndefined();
    });

    it("should not include booking intent when no availability windows", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      for (const day of [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ] as const) {
        store.setBookingAvailability(day, []);
      }
      store.setBooking({ enabled: true, oneToOneEnabled: true });

      const me3 = store.generateMe3Json();
      expect(me3.intents?.book).toBeUndefined();
    });

    it("should only include days with availability windows in me.json", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.setBooking({
        enabled: true,
        oneToOneEnabled: true,
        duration: 30,
        timezone: "UTC",
      });
      for (const day of [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ] as const) {
        store.setBookingAvailability(day, []);
      }
      store.setBookingAvailability("monday", ["09:00-17:00"]);
      // tuesday has empty array, should not be included

      const me3 = store.generateMe3Json();
      expect(me3.intents?.book?.availability?.windows?.monday).toEqual([
        "09:00-17:00",
      ]);
      expect(me3.intents?.book?.availability?.windows?.tuesday).toBeUndefined();
    });

    it("should only include non-empty booking fields in me.json", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.setBooking({
        enabled: true,
        oneToOneEnabled: true,
        title: "",
        description: "",
        duration: 30,
        timezone: "UTC",
      });
      store.setBookingAvailability("monday", ["09:00-17:00"]);

      const me3 = store.generateMe3Json();
      expect(me3.intents?.book?.enabled).toBe(true);
      expect(me3.intents?.book?.duration).toBe(30);
      expect(me3.intents?.book?.title).toBeUndefined();
      expect(me3.intents?.book?.description).toBeUndefined();
    });

    it("should include booking pricing with free intro in me.json", () => {
      const store = useWizardStore();
      store.profile.name = "Test User";
      store.profile.handle = "testuser";
      store.setBooking({
        enabled: true,
        oneToOneEnabled: true,
        title: "Intro Session",
        duration: 30,
        timezone: "UTC",
      });
      store.setBookingAvailability("monday", ["09:00-17:00"]);
      store.setBookingPricing({
        enabled: true,
        suggestedAmount: 75,
        currency: "EUR",
        allowFlexiblePricing: false,
        allowFree: true,
      });

      const me3 = store.generateMe3Json();

      expect(me3.intents?.book?.pricing).toEqual({
        enabled: true,
        suggestedAmount: 75,
        currency: "EUR",
        minimumAmount: 5,
        allowFlexiblePricing: false,
        allowFree: true,
        paymentMethod: "stripe",
        paymentInstructions: "",
      });
      expect((me3 as any).services).toEqual([
        {
          id: "intro-session",
          title: "Intro Session",
          sessionType: "1:1",
          duration: 30,
          availabilityMode: "native",
          status: "active",
          price: 75,
          currency: "EUR",
        },
        {
          id: "free-intro-session",
          title: "Free Intro Session",
          description:
            "A free introductory session to explore fit and next steps.",
          sessionType: "1:1",
          duration: 30,
          price: 0,
          currency: "EUR",
          availabilityMode: "native",
          status: "active",
        },
      ]);
      expect((me3 as any).actions?.createBookingCheckout).toEqual({
        method: "POST",
        url: "http://localhost:3000/api/book/testuser/checkout-session",
        requires: ["localDate", "localTime", "guestName", "guestEmail"],
        description: "Create a checkout session for a paid booking offer.",
      });
    });

    it("publishes bookable class recurrence anchors and retreat dates", () => {
      const store = useWizardStore();
      store.profile.name = "Event Host";
      store.setBooking({
        enabled: true,
        oneToOneEnabled: false,
        classEnabled: true,
        retreatEnabled: true,
      });
      const classOffer = store.profile.booking.classOffers[0];
      const retreatOffer = store.profile.booking.retreatOffers[0];
      store.updateClassOffer(classOffer.id, {
        title: "Movement class",
        recurrence: {
          frequency: "biweekly",
          weekday: "monday",
          startTime: "18:00",
          startDate: "2026-09-07",
        },
        timezone: "Europe/Dublin",
        capacity: 12,
      });
      store.updateRetreatOffer(retreatOffer.id, {
        title: "Autumn retreat",
        startDate: "2026-10-24",
        startTime: "10:00",
        endDate: "2026-10-25",
        endTime: "16:00",
        timezone: "Europe/Dublin",
        capacity: 6,
      });

      const book = (store.generateMe3Json() as any).intents.book;
      expect(book.bookingTypes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "class",
            classes: [
              expect.objectContaining({
                recurrence: {
                  frequency: "biweekly",
                  weekday: "monday",
                  startTime: "18:00",
                  startDate: "2026-09-07",
                },
                capacity: 12,
              }),
            ],
          }),
          expect.objectContaining({
            type: "retreat",
            retreats: [
              expect.objectContaining({
                startDate: "2026-10-24",
                endDate: "2026-10-25",
                capacity: 6,
              }),
            ],
          }),
        ]),
      );
    });

    it("should load booking config from site content", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Test User",
        intents: {
          book: {
            enabled: true,
            title: "Book a Call",
            description: "Schedule a meeting",
            duration: 60,
            availability: {
              timezone: "America/New_York",
              windows: {
                monday: ["09:00-17:00"],
                friday: ["10:00-14:00"],
              },
            },
            pricing: {
              enabled: true,
              suggestedAmount: 60,
              currency: "GBP" as const,
              minimumAmount: 5 as const,
              allowFlexiblePricing: false,
              allowFree: true,
              paymentMethod: "stripe" as const,
              paymentInstructions: "",
            },
          },
        },
      };

      store.loadFromSiteContent(siteProfile, [], [], [], "testuser");
      expect(store.profile.booking.enabled).toBe(true);
      expect(store.profile.booking.title).toBe("Book a Call");
      expect(store.profile.booking.description).toBe("Schedule a meeting");
      expect(store.profile.booking.duration).toBe(60);
      expect(store.profile.booking.timezone).toBe("America/New_York");
      expect(store.profile.booking.availability.monday).toEqual([
        "09:00-17:00",
      ]);
      expect(store.profile.booking.availability.friday).toEqual([
        "10:00-14:00",
      ]);
      expect(store.profile.booking.pricing).toEqual({
        enabled: true,
        suggestedAmount: 60,
        currency: "GBP",
        minimumAmount: 5,
        allowFlexiblePricing: false,
        allowFree: true,
        paymentMethod: "stripe",
        paymentInstructions: "",
      });
    });

    it("should use default booking config when not in site content", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Test User",
      };

      store.loadFromSiteContent(siteProfile, [], [], [], "testuser");
      expect(store.profile.booking.enabled).toBe(true);
      expect(store.profile.booking.title).toBe("");
      expect(store.profile.booking.duration).toBe(30);
    });
  });

  describe("feature enabled flags", () => {
    it("should initialize with expected feature toggles", () => {
      const store = useWizardStore();

      expect(store.linksEnabled).toBe(false);
      expect(store.callToActionEnabled).toBe(false);
      expect(store.pagesEnabled).toBe(false);
      expect(store.newsletterEnabled).toBe(false);
      expect(store.blogEnabled).toBe(false);
      expect(store.bookingsEnabled).toBe(false);
      expect(store.shopEnabled).toBe(false);
      expect(store.testimonialsEnabled).toBe(false);
    });

    it("should persist newsletterEnabled flag", () => {
      const store = useWizardStore();
      store.newsletterEnabled = true;
      store.saveToStorage();

      const saved = JSON.parse(localStorage.getItem("me3_wizard_state") || "{}");
      expect(saved.newsletterEnabled).toBe(true);
    });

    it("should persist bookingsEnabled flag", () => {
      const store = useWizardStore();
      store.bookingsEnabled = true;
      store.saveToStorage();

      const saved = JSON.parse(localStorage.getItem("me3_wizard_state") || "{}");
      expect(saved.bookingsEnabled).toBe(true);
    });

    it("should persist testimonialsEnabled flag", () => {
      const store = useWizardStore();
      store.testimonialsEnabled = true;
      store.saveToStorage();

      const saved = JSON.parse(localStorage.getItem("me3_wizard_state") || "{}");
      expect(saved.testimonialsEnabled).toBe(true);
    });

    it("should persist blog and shop titles", () => {
      const store = useWizardStore();
      store.blogTitle = "Articles";
      store.shopTitle = "Services";
      store.saveToStorage();

      const saved = JSON.parse(localStorage.getItem("me3_wizard_state") || "{}");
      expect(saved.blogTitle).toBe("Articles");
      expect(saved.shopTitle).toBe("Services");
    });

    it("should load newsletterEnabled from localStorage", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({ newsletterEnabled: true })
      );

      const store = useWizardStore();
      expect(store.newsletterEnabled).toBe(true);
    });

    it("should load bookingsEnabled from localStorage", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({ bookingsEnabled: true })
      );

      const store = useWizardStore();
      expect(store.bookingsEnabled).toBe(true);
    });

    it("should keep products optional when loading old localStorage state", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({ shopEnabled: false }),
      );

      const store = useWizardStore();
      expect(store.shopEnabled).toBe(false);
    });

    it("should load testimonialsEnabled from localStorage", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({ testimonialsEnabled: true })
      );

      const store = useWizardStore();
      expect(store.testimonialsEnabled).toBe(true);
    });

    it("should load blog and shop titles from localStorage", () => {
      localStorage.setItem(
        "me3_wizard_state",
        JSON.stringify({ blogTitle: "Articles", shopTitle: "Services" }),
      );

      const store = useWizardStore();
      expect(store.blogTitle).toBe("Articles");
      expect(store.shopTitle).toBe("Services");
    });

    it("should reset all enabled flags on reset", () => {
      const store = useWizardStore();
      store.newsletterEnabled = true;
      store.linksEnabled = true;
      store.callToActionEnabled = true;
      store.pagesEnabled = true;
      store.blogEnabled = true;
      store.bookingsEnabled = true;
      store.shopEnabled = true;
      store.testimonialsEnabled = true;
      store.blogTitle = "Articles";
      store.shopTitle = "Services";

      store.reset();

      expect(store.linksEnabled).toBe(false);
      expect(store.callToActionEnabled).toBe(false);
      expect(store.pagesEnabled).toBe(false);
      expect(store.newsletterEnabled).toBe(false);
      expect(store.blogEnabled).toBe(false);
      expect(store.bookingsEnabled).toBe(false);
      expect(store.shopEnabled).toBe(false);
      expect(store.testimonialsEnabled).toBe(false);
      expect(store.blogTitle).toBe("Blog");
      expect(store.shopTitle).toBe("Products");
    });

    it("should restore newsletterEnabled from site content", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Test User",
        intents: {
          subscribe: { enabled: true },
        },
      };

      store.loadFromSiteContent(siteProfile, [], [], [], "testuser");
      expect(store.newsletterEnabled).toBe(true);
    });

    it("should restore bookingsEnabled from site content", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Test User",
        intents: {
          book: {
            enabled: true,
            duration: 30,
            availability: { timezone: "UTC", windows: {} },
          },
        },
      };

      store.loadFromSiteContent(siteProfile, [], [], [], "testuser");
      expect(store.bookingsEnabled).toBe(true);
    });

    it("should restore testimonialsEnabled from site content", () => {
      const store = useWizardStore();
      const siteProfile = {
        name: "Test User",
        testimonials: [
          { name: "Jamie", quote: "So helpful." },
        ],
      };

      store.loadFromSiteContent(siteProfile, [], [], [], "testuser");
      expect(store.testimonialsEnabled).toBe(true);
    });
  });

  describe("stepNames", () => {
    it("should include base steps and Additional Features", () => {
      const store = useWizardStore();

      expect(store.stepNames).toEqual([
        "Basics",
        "Avatar",
        "Banner",
        "Who you help",
        "Additional Features",
        "Publish",
      ]);
    });

    it("should include Newsletter step when enabled", () => {
      const store = useWizardStore();
      store.newsletterEnabled = true;

      const names = store.stepNames;
      expect(names).toContain("Newsletter");
      // Newsletter should come after Additional Features
      const newsletterIndex = names.indexOf("Newsletter");
      const additionalIndex = names.indexOf("Additional Features");
      expect(newsletterIndex).toBeGreaterThan(additionalIndex);
    });

    it("should include Blog step when enabled", () => {
      const store = useWizardStore();
      store.blogEnabled = true;

      const names = store.stepNames;
      expect(names).toContain("Blog");
      // Blog should come after Additional Features
      const blogIndex = names.indexOf("Blog");
      const additionalIndex = names.indexOf("Additional Features");
      expect(blogIndex).toBeGreaterThan(additionalIndex);
    });

    it("should include Bookings step when enabled", () => {
      const store = useWizardStore();
      store.bookingsEnabled = true;

      const names = store.stepNames;
      expect(names).toContain("Bookings");
      // Bookings should come after Additional Features
      const bookingsIndex = names.indexOf("Bookings");
      const additionalIndex = names.indexOf("Additional Features");
      expect(bookingsIndex).toBeGreaterThan(additionalIndex);
    });

    it("should include Testimonials step when enabled", () => {
      const store = useWizardStore();
      store.testimonialsEnabled = true;

      const names = store.stepNames;
      expect(names).toContain("Testimonials");
      const testimonialsIndex = names.indexOf("Testimonials");
      const additionalIndex = names.indexOf("Additional Features");
      expect(testimonialsIndex).toBeGreaterThan(additionalIndex);
    });

    it("should include Products only when enabled", () => {
      const store = useWizardStore();
      expect(store.stepNames).not.toContain("Products");
      store.shopEnabled = true;

      const names = store.stepNames;
      expect(names).toContain("Products");
      const offeringsIndex = names.indexOf("Products");
      const additionalIndex = names.indexOf("Additional Features");
      expect(offeringsIndex).toBeGreaterThan(additionalIndex);
    });

    it("should order conditional steps correctly: Newsletter, Bookings, Blog, Products, Testimonials", () => {
      const store = useWizardStore();
      store.newsletterEnabled = true;
      store.blogEnabled = true;
      store.bookingsEnabled = true;
      store.shopEnabled = true;
      store.testimonialsEnabled = true;

      const names = store.stepNames;
      const newsletterIndex = names.indexOf("Newsletter");
      const blogIndex = names.indexOf("Blog");
      const bookingsIndex = names.indexOf("Bookings");
      const offeringsIndex = names.indexOf("Products");
      const testimonialsIndex = names.indexOf("Testimonials");
      const publishIndex = names.indexOf("Publish");

      expect(newsletterIndex).toBeLessThan(bookingsIndex);
      expect(bookingsIndex).toBeLessThan(blogIndex);
      expect(blogIndex).toBeLessThan(offeringsIndex);
      expect(offeringsIndex).toBeLessThan(testimonialsIndex);
      expect(testimonialsIndex).toBeLessThan(publishIndex);
    });

    it("should have Publish as the last step always", () => {
      const store = useWizardStore();
      store.newsletterEnabled = true;
      store.blogEnabled = true;
      store.bookingsEnabled = true;
      store.shopEnabled = true;
      store.testimonialsEnabled = true;

      const names = store.stepNames;
      expect(names[names.length - 1]).toBe("Publish");
    });

    it("should update totalSteps when features are toggled", () => {
      const store = useWizardStore();
      store.newsletterEnabled = false;
      store.bookingsEnabled = false;
      const baseSteps = store.totalSteps;

      store.newsletterEnabled = true;
      expect(store.totalSteps).toBe(baseSteps + 1);

      store.blogEnabled = true;
      expect(store.totalSteps).toBe(baseSteps + 2);

      store.bookingsEnabled = true;
      expect(store.totalSteps).toBe(baseSteps + 3);

      store.testimonialsEnabled = true;
      expect(store.totalSteps).toBe(baseSteps + 4);
    });

    it("should adjust currentStep if it exceeds totalSteps when disabling features", async () => {
      const store = useWizardStore();
      store.newsletterEnabled = true;
      store.blogEnabled = true;
      const totalBeforeDisable = store.totalSteps;
      store.currentStep = totalBeforeDisable; // Last step (Publish)

      // Disable features - watcher will adjust currentStep
      store.blogEnabled = false;
      
      // Wait for watchers to run
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(store.currentStep).toBeLessThanOrEqual(store.totalSteps);
    });
  });
});
