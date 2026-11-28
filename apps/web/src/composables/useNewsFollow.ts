import { computed, ref } from "vue";
import { api } from "../api";
import {
  MAX_NEWS_FOLLOWS, NEWS_YOUTUBE_MESSAGE, cardFromResolved, readFollowCards, readYouTubeReturn, resolveYouTubeChannels, toPick,
  youtubeAddedNote, youtubeMessage, type NewsFollowCard, type NewsFollowPick, type NewsResolved, type NewsYouTubeChannel, type NewsYouTubeReturn,
} from "../utils/news-follow";

// "Who do you follow?" on the web (me3-6ptk.10, .11): the faces, someone else by name or link, and
// Connect YouTube. Picks stay in the page until the caller saves them with the rest of the order.
// The YouTube sign-in runs in a pop-up on ME3 Cloud; its return page (on this origin) sends back a
// one-time handoff, and the channel list is collected once and kept only while the owner picks.
const SIGN_IN_WAIT_MS = 5 * 60_000;

export function useNewsFollow() {
  const list = ref<NewsFollowCard[]>([]);
  const follows = ref<NewsFollowPick[]>([]);
  const loading = ref(false);
  const failed = ref(false);
  const ownBusy = ref(false);
  const ownNote = ref("");
  const youtubeBusy = ref(false);
  const youtubeNote = ref("");
  const youtubeChannels = ref<NewsYouTubeChannel[] | null>(null);
  const room = computed(() => Math.max(0, MAX_NEWS_FOLLOWS - follows.value.length));
  let signIn = 0;

  function keep(card: NewsFollowCard) {
    if (!list.value.some(entry => entry.id === card.id)) list.value = [card, ...list.value];
    if (follows.value.some(entry => entry.id === card.id) || follows.value.length >= MAX_NEWS_FOLLOWS) return false;
    follows.value = [...follows.value, toPick(card)];
    return true;
  }

  async function load(current: NewsFollowPick[] = []) {
    follows.value = current.slice(0, MAX_NEWS_FOLLOWS);
    loading.value = true; failed.value = false;
    try {
      list.value = readFollowCards(await api.get("/news/follow"));
      // Voices already followed stay picked, even ones Soup no longer suggests.
      for (const card of list.value) if (card.following && !follows.value.some(entry => entry.id === card.id) && follows.value.length < MAX_NEWS_FOLLOWS) follows.value = [...follows.value, toPick(card)];
    } catch { failed.value = true; }
    finally { loading.value = false; }
  }

  function toggle(card: NewsFollowCard) {
    if (follows.value.some(entry => entry.id === card.id)) follows.value = follows.value.filter(entry => entry.id !== card.id);
    else if (follows.value.length < MAX_NEWS_FOLLOWS) follows.value = [...follows.value, toPick(card)];
  }

  const resolve = async (queries: string[]) => (await api.post<{ results: NewsResolved[] }>("/news/follow/resolve", { queries })).results || [];

  async function addOwn(query: string) {
    const value = query.trim();
    if (!value || ownBusy.value) return false;
    ownBusy.value = true; ownNote.value = "";
    try {
      const found = (await api.post<{ results: NewsResolved[] }>("/news/follow/resolve", { query: value })).results?.[0];
      const card = found ? cardFromResolved(found, "Added by you") : null;
      if (!card) { ownNote.value = found?.reason || "Couldn’t find that one."; return false; }
      keep(card);
      ownNote.value = `Added ${card.name}.`;
      return true;
    } catch {
      ownNote.value = "Couldn’t look that up just now. Try again in a moment.";
      return false;
    } finally { ownBusy.value = false; }
  }

  /** Waits for this sign-in's answer from the pop-up, or gives up after the handoff would have expired. */
  function awaitReturn(state: string): Promise<NewsYouTubeReturn> {
    return new Promise(resolveReturn => {
      const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(NEWS_YOUTUBE_MESSAGE) : null;
      const done = (result: NewsYouTubeReturn) => {
        window.removeEventListener("message", onMessage);
        channel?.close();
        window.clearTimeout(timer);
        resolveReturn(result);
      };
      const onMessage = (event: MessageEvent) => { const result = readYouTubeReturn(event.data, event.origin, window.location.origin, state); if (result) done(result); };
      const onChannel = (event: MessageEvent) => { const result = readYouTubeReturn(event.data, window.location.origin, window.location.origin, state); if (result) done(result); };
      window.addEventListener("message", onMessage);
      channel?.addEventListener("message", onChannel);
      const timer = window.setTimeout(() => done(null), SIGN_IN_WAIT_MS);
    });
  }

  async function connectYouTube() {
    const attempt = ++signIn;
    youtubeNote.value = "";
    // Opened straight from the click, so the browser lets it through; it is pointed at Google once Core answers.
    const popup = window.open("", NEWS_YOUTUBE_MESSAGE, "popup,width=520,height=700");
    if (!popup) { youtubeNote.value = "Your browser blocked the YouTube window. Allow pop-ups for ME3 and try again."; return; }
    youtubeBusy.value = true;
    try {
      const start = await api.post<{ url: string; state: string }>("/news/follow/youtube/start", { app: "web" });
      popup.location.href = start.url;
      const result = await awaitReturn(start.state);
      if (attempt !== signIn) return;
      if (!result) { youtubeNote.value = "YouTube didn’t connect. Try again."; return; }
      if ("error" in result) { youtubeNote.value = youtubeMessage(result.error); return; }
      const channels = (await api.post<{ channels: NewsYouTubeChannel[] }>("/news/follow/youtube/collect", { state: start.state, handoff: result.handoff })).channels || [];
      if (!channels.length) { youtubeNote.value = youtubeMessage("youtube_no_subscriptions"); return; }
      youtubeChannels.value = channels;
    } catch (error) {
      if (!popup.closed) popup.close();
      if (attempt === signIn) youtubeNote.value = error instanceof Error && error.message ? error.message : "YouTube didn’t connect. Try again.";
    } finally {
      if (attempt === signIn) youtubeBusy.value = false;
    }
  }

  async function addYouTube(picked: NewsYouTubeChannel[]) {
    youtubeChannels.value = null;
    if (!picked.length) return;
    youtubeBusy.value = true; youtubeNote.value = "";
    try {
      const { cards, quiet, failed: stopped } = await resolveYouTubeChannels(picked, resolve);
      let added = 0;
      for (const card of cards) if (keep(card)) added++;
      youtubeNote.value = youtubeAddedNote(added, quiet, stopped);
    } finally { youtubeBusy.value = false; }
  }

  return { list, follows, loading, failed, room, ownBusy, ownNote, youtubeBusy, youtubeNote, youtubeChannels, load, toggle, addOwn, connectYouTube, addYouTube };
}
