/** Banner crop shape per site layout. Kept free of Vue for tests. */

export type BannerCropSpec = { aspectRatio: number; maxWidth: number; fixed: boolean; title: string; hint: string };

const STRIP: BannerCropSpec = { aspectRatio: 3, maxWidth: 1200, fixed: true, title: "Crop the site banner", hint: "" };
// The Cover hero fills the first screen: about 16:10 on desktop, cropped to the middle on phones.
const COVER: BannerCropSpec = {
  aspectRatio: 16 / 10,
  maxWidth: 2400,
  fixed: false,
  title: "Crop the cover photo",
  hint: "It fills the first screen. Phones show the middle, so keep the subject centred.",
};

export function bannerCropSpec(layout: string | null | undefined): BannerCropSpec {
  return layout === "cover" ? COVER : STRIP;
}

/** Strip banners keep their fixed 1200x400; Cover photos are never upscaled or wider than needed. */
export function bannerOutputSize(spec: BannerCropSpec, cropWidth: number): { width: number; height: number } {
  const width = spec.fixed || !(cropWidth > 0) ? spec.maxWidth : Math.max(1, Math.round(Math.min(spec.maxWidth, cropWidth)));
  return { width, height: Math.round(width / spec.aspectRatio) };
}
