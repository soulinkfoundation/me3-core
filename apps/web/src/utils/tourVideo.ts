// The ME3 walkthrough video: Home's Get set up "Watch the tour" step and Account's Tour button.
// Set `desktop` to an MP4 URL to switch both on; while it is empty they stay hidden.
// `mobile` is optional: phones use it when set, otherwise the desktop recording.
export const TOUR_VIDEO = { desktop: "", mobile: "", minutes: 3 };

export const TOUR_WATCHED_KEY = "me3.home.tourWatched";
/** Share of the video that counts as watched. */
export const TOUR_WATCHED_SHARE = 0.8;

export function tourVideoUrl(narrow: boolean, video = TOUR_VIDEO): string {
  return (narrow && video.mobile) || video.desktop;
}

export function hasTourVideo(video = TOUR_VIDEO): boolean {
  return Boolean(video.desktop);
}
