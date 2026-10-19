import { createRouter, createWebHistory } from "vue-router";
import { beginAppLoading } from "./composables/useAppLoading";
import { routes } from "vue-router/auto-routes";
import { useAuthStore } from "./stores/auth";
import { api } from "./api";
import { useSitesStore } from "./stores/sites";
import { useWizardStore } from "./stores/wizard";
import { updateFeatureFavicon } from "./utils/favicon";
import { DEFAULT_APP_PATH } from "./utils/navigation";
import { resolveAuthenticatedLoginRedirect } from "./utils/loginRedirect";
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

// The app loading bar covers each navigation, including lazy route chunks.
let releaseNavigationLoading: (() => void) | null = null;
function endNavigationLoading() {
  releaseNavigationLoading?.();
  releaseNavigationLoading = null;
}
router.onError(endNavigationLoading);

// Navigation guard
router.beforeEach(async (to, _from, next) => {
  releaseNavigationLoading ??= beginAppLoading();
  // The public homepage is rendered by the Worker, outside the owner SPA.
  if (to.path === "/") {
    if (import.meta.env.DEV) next({ path: "/login", query: to.query, hash: to.hash });
    else window.location.assign(to.fullPath);
    return;
  }
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
  // A payment approval needs a recent sign-in, so a signed-in owner may sign in again.
  if (to.path === "/login" && auth.isAuthenticated && to.query.reauth !== "payment") {
    const redirect = resolveAuthenticatedLoginRedirect(to.query.redirect, {
      origin: window.location.origin,
      hostname: window.location.hostname,
      dev: import.meta.env.DEV,
    });
    if (redirect) {
      next(redirect);
      return;
    }
    next({ path: DEFAULT_APP_PATH });
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

  // Agent context and activity moved from a Chat dialog to the Your agent page.
  if ((to.path === "/assistant" || to.path === "/assistant/") && to.query.settings) {
    next({ path: "/agent", replace: true });
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

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    next({ path: "/login", query: { redirect: to.fullPath } });
    return;
  }

  const [requiredPluginEnabled, requiredNavigationFeatureEnabled] = await Promise.all([
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
    next({ path: DEFAULT_APP_PATH, replace: true });
    return;
  }

  next();
});

router.afterEach((to) => {
  endNavigationLoading();
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
