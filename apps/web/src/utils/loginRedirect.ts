export interface LoginRedirectOptions {
  origin: string;
  hostname: string;
  dev: boolean;
  setupIncomplete?: boolean;
}

export interface ProfileSetupPathOptions {
  sitesLoaded: boolean;
  hasProfileSite: boolean;
  onboardingStartStep?: 2 | 3 | null;
  defaultPath: string;
}

export function resolveProfileSetupPath(
  options: ProfileSetupPathOptions,
): string {
  if (options.onboardingStartStep === 2 || options.onboardingStartStep === 3) {
    return "/create";
  }
  if (!options.sitesLoaded || options.hasProfileSite) {
    return options.defaultPath;
  }
  return "/create";
}

export function normalizeSafeLoginRedirect(
  raw: unknown,
  options: LoginRedirectOptions,
): string | null {
  if (typeof raw !== "string") return null;
  const redirect = raw.trim();
  if (!redirect) return null;

  if (redirect.startsWith("/") && !redirect.startsWith("//")) {
    return redirect;
  }

  try {
    const parsed = new URL(redirect);
    const sameHost = parsed.hostname === options.hostname;
    const devLocalhost =
      options.dev && ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (
      (sameHost || devLocalhost) &&
      ["http:", "https:"].includes(parsed.protocol)
    ) {
      return parsed.toString();
    }
  } catch {
    // Fall through to unsafe.
  }

  return null;
}

export function resolveAuthenticatedLoginRedirect(
  raw: unknown,
  options: LoginRedirectOptions,
): string | null {
  const redirect = normalizeSafeLoginRedirect(raw, options);
  if (!redirect) return null;
  if (redirect.startsWith("/")) return redirect;

  try {
    const parsed = new URL(redirect);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function resolveMe3OAuthRedirect(
  raw: unknown,
  options: LoginRedirectOptions,
): string {
  if (options.setupIncomplete) return "/create";

  return normalizeSafeLoginRedirect(raw, options) || "/login";
}
