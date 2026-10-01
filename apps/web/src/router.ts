import { createRouter, createWebHistory } from "vue-router";
import { routes } from "vue-router/auto-routes";
import { useAuthStore } from "./stores/auth";
import { api } from "./api";
import { useSitesStore } from "./stores/sites";
import { useWizardStore } from "./stores/wizard";
import { updateFeatureFavicon } from "./utils/favicon";
import { DEFAULT_APP_PATH } from "./utils/navigation";
import {
  resolveAuthenticatedLoginRedirect,
  resolveProfileSetupPath,
} from "./utils/loginRedirect";
import {
  invalidatePluginAccess,
  isPluginAccessEnabled,
} from "./utils/pluginAccess";

const router = createRouter({
  history: createWebHistory(),
  routes,
});

let syncedSessionUserId: string | null | undefined;

function updateMetaTag(name: string, content: string | undefined) {
  if (!content) return;
  let element = document.querySelector(`meta[name="${name}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("name", name);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function updateMetaProperty(property: string, content: string | undefined) {
  if (!content) return;
  let element = document.querySelector(`meta[property="${property}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("property", property);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function updateLinkTag(rel: string, href: string | undefined) {
  if (!href) return;
  let element = document.querySelector(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", rel);
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
}

async function resolveDefaultAppPathForSession(): Promise<string> {
  const auth = useAuthStore();
  if (auth.sessionOnboardingStartStep !== null) {
    return resolveProfileSetupPath({
      sitesLoaded: true,
      hasProfileSite: auth.sessionHasProfileSite === true,
      onboardingStartStep: auth.sessionOnboardingStartStep,
      defaultPath: DEFAULT_APP_PATH,
    });
  }

  const sites = useSitesStore();
  if (sites.loaded) {
    return resolveProfileSetupPath({
      sitesLoaded: true,
      hasProfileSite: sites.hasProfileSite,
      defaultPath: DEFAULT_APP_PATH,
    });
  }

  if (auth.sessionHasProfileSite !== null) {
    return resolveProfileSetupPath({
      sitesLoaded: true,
      hasProfileSite: auth.sessionHasProfileSite,
      defaultPath: DEFAULT_APP_PATH,
    });
  }

  try {
    await sites.ensureSites();
    return resolveProfileSetupPath({
      sitesLoaded: sites.loaded,
      hasProfileSite: sites.hasProfileSite,
      defaultPath: DEFAULT_APP_PATH,
    });
  } catch {
    return DEFAULT_APP_PATH;
  }
}

// Navigation guard
router.beforeEach(async (to, _from, next) => {
  const auth = useAuthStore();
  await auth.ensureInitialized();

  const currentSessionUserId = auth.user?.id ?? null;
  if (syncedSessionUserId !== currentSessionUserId) {
    const wizard = useWizardStore();
    const sites = useSitesStore();
    wizard.reconcileSession(currentSessionUserId);
    sites.resetSessionState();
    invalidatePluginAccess();
    syncedSessionUserId = currentSessionUserId;
  }

  // Resume the originally requested app route after authentication. This guard
  // runs before the login page mounts, so dropping its redirect here would send
  // an authenticated callback to the default app page instead.
  if (to.path === "/login" && auth.isAuthenticated) {
    const redirect = resolveAuthenticatedLoginRedirect(to.query.redirect, {
      origin: window.location.origin,
      hostname: window.location.hostname,
      dev: import.meta.env.DEV,
    });
    if (redirect) {
      next(redirect);
      return;
    }
    next({ path: await resolveDefaultAppPathForSession() });
    return;
  }

  // Redirect logged-in users from the public root to the app landing path.
  if (to.path === "/" && auth.isAuthenticated) {
    next({ path: await resolveDefaultAppPathForSession() });
    return;
  }

  if (to.path === "/dashboard" || to.path === "/dashboard/") {
    next({
      path: DEFAULT_APP_PATH,
      query: to.query,
      hash: to.hash,
      replace: true,
    });
    return;
  }

  if (to.path === "/socials" || to.path === "/socials/") {
    next({
      path: "/assistant",
      query: to.query,
      hash: to.hash,
      replace: true,
    });
    return;
  }

  if (to.path === "/socials/relationship-builder") {
    next({
      path: "/assistant",
      query: to.query,
      hash: to.hash,
      replace: true,
    });
    return;
  }

  if (to.path === "/messages") {
    next({
      path: "/email",
      query: to.query,
      hash: to.hash,
      replace: true,
    });
    return;
  }

  if (to.path === "/clients" || to.path === "/clients/") {
    next({
      path: "/assistant",
      query: to.query,
      hash: to.hash,
      replace: true,
    });
    return;
  }

  if (
    to.path === "/agent/relationships" ||
    to.path.startsWith("/agent/relationships/")
  ) {
    next({
      path: "/assistant",
      query: to.query,
      hash: to.hash,
      replace: true,
    });
    return;
  }

  if (
    to.path === "/agent/messages" ||
    to.path.startsWith("/agent/messages/")
  ) {
    next({
      path: "/email",
      query: to.query,
      hash: to.hash,
      replace: true,
    });
    return;
  }

  const jobDeepLinkPrefix = to.path.startsWith("/agent/jobs/")
    ? "/agent/jobs/"
    : to.path.startsWith("/assistant/jobs/")
      ? "/assistant/jobs/"
      : null;
  if (jobDeepLinkPrefix) {
    const jobSegment = to.path.slice(jobDeepLinkPrefix.length);
    if (jobSegment.length > 0) {
      next({
        path: "/assistant",
        query: { ...to.query, job: jobSegment },
        hash: to.hash,
        replace: true,
      });
      return;
    }
  }

  if (to.path === "/agent" || to.path === "/agent/") {
    next({
      path: "/assistant",
      query: to.query,
      hash: to.hash,
      replace: true,
    });
    return;
  }

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    next({ path: "/login", query: { redirect: to.fullPath } });
    return;
  }

  const [defaultAppPath, requiredPluginEnabled, requiredNavigationFeatureEnabled] = await Promise.all([
    to.meta.requiresWorkspace
      ? resolveDefaultAppPathForSession()
      : Promise.resolve(DEFAULT_APP_PATH),
    typeof to.meta.requiresPlugin === "string"
      ? isPluginAccessEnabled(to.meta.requiresPlugin).catch(() => false)
      : Promise.resolve(true),
    typeof to.meta.requiresNavigationFeature === "string"
      ? api
          .get<{ features: Array<{ id: string; visible: boolean }> }>(
            "/navigation-features",
          )
          .then((response) =>
            response.features.some(
              (feature) =>
                feature.id === to.meta.requiresNavigationFeature &&
                feature.visible,
            ),
          )
          .catch(() => false)
      : Promise.resolve(true),
  ]);

  if (to.meta.requiresWorkspace) {
    if (!auth.isAuthenticated) {
      next({ path: "/login", query: { redirect: to.fullPath } });
      return;
    }
    if (defaultAppPath === "/create") {
      next({ path: "/create", replace: true });
      return;
    }
  }

  if (to.meta.requiresPlugin) {
    if (!requiredPluginEnabled) {
      next({
        path: "/settings",
        query: { section: "plugins", blocked: to.meta.requiresPlugin },
        replace: true,
      });
      return;
    }
  }

  if (to.meta.requiresNavigationFeature && !requiredNavigationFeatureEnabled) {
    next({ path: defaultAppPath, replace: true });
    return;
  }

  next();
});

router.afterEach((to) => {
  const title = (to.meta?.title as string) || "ME3";
  const description =
    (to.meta?.description as string) ||
    "An assistant for coaches, educators, therapists, and creators who help people every day. Your site, calendar, and email in one place.";
  const robots = (to.meta?.robots as string) || "index,follow";
  const ogTitle = (to.meta?.ogTitle as string) || title;
  const ogDescription = (to.meta?.ogDescription as string) || description;
  const rawOgImage = (to.meta?.ogImage as string) || "/icons/icon-512.png";

  document.title = title;
  updateMetaTag("description", description);
  updateMetaTag("robots", robots);

  const canonical = `${window.location.origin}${to.path}`;
  updateLinkTag("canonical", canonical);

  const ogImage = rawOgImage.startsWith("http")
    ? rawOgImage
    : `${window.location.origin}${rawOgImage}`;

  updateMetaProperty("og:title", ogTitle);
  updateMetaProperty("og:description", ogDescription);
  updateMetaProperty("og:image", ogImage);
  updateMetaProperty("og:type", "website");
  updateMetaProperty("og:url", canonical);
  updateMetaProperty("og:site_name", "ME3");

  updateMetaTag("twitter:card", "summary_large_image");
  updateMetaTag("twitter:title", ogTitle);
  updateMetaTag("twitter:description", ogDescription);
  updateMetaTag("twitter:image", ogImage);
  updateFeatureFavicon(to.path);
});

export default router;
