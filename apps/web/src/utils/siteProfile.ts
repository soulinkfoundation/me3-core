export function cloneSiteProfile<T extends object>(profile: T): T {
  return JSON.parse(JSON.stringify(profile)) as T;
}

export function withoutCurrentSiteImage<T extends { logo?: string; avatar?: string }>(profile: T): T {
  const next = cloneSiteProfile(profile);
  if (next.logo) delete next.logo;
  else delete next.avatar;
  return next;
}
