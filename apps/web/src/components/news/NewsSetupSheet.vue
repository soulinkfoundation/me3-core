<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppDialog from "../AppDialog.vue";
import UiIcon from "../UiIcon.vue";
import NewsFollow from "./NewsFollow.vue";
import NewsPantry from "./NewsPantry.vue";
import { ApiError, api, searchLocations, type LocationSearchResult } from "../../api";
import { useNewsFollow } from "../../composables/useNewsFollow";
import type { NewsFeelingId, NewsPaper, NewsTopicChip } from "../../utils/news";
import { readFollowPicks } from "../../utils/news-follow";
import {
  NEWS_FEELINGS, NEWS_SETUP_STEPS, NEWS_SETUP_TITLES, newsCookSteps, newsDishEmoji, newsReceiptLines, newsSetupBack, newsSetupOrder, newsSetupOrderWithoutBase,
  newsTastedTotal, newsTownName, readNewsBase, toggleNewsFeeling, type NewsPantryLane, type NewsSetupSettings, type NewsSetupStep,
} from "../../utils/news-setup";

// The Morning News setup sheet on the web (me3-6ptk.13), ported from iOS: ME3 takes your order to
// The Human Soup and cooks your paper. The kitchen look (awning, cream walls, chalkboard menu, a
// receipt on gingham, a deli LED sign) is kept to this sheet. Mock-up: docs/design/mockups/morning-news-setup.
const emit = defineEmits<{ close: []; finished: [paper: NewsPaper] }>();

const step = ref<NewsSetupStep>("intro");
const settings = ref<NewsSetupSettings | null>(null);
const loadFailed = ref(false);
const error = ref("");
const base = ref<NewsFeelingId[]>([]);
const work = ref<NewsTopicChip[]>([]);
const mine = ref<NewsTopicChip[]>([]);
const townText = ref("");
const townCountry = ref<string | null>(null);
const townChosen = ref(false);
const townOpen = ref(false);
const townResults = ref<LocationSearchResult[]>([]);
const townLookupDown = ref(false);
const workText = ref("");
const missionText = ref("");
const savingProfile = ref(false);
const pantryLane = ref<NewsPantryLane | null>(null);
const time = ref("07:00");
const notify = ref(true);
const timesOpen = ref(false);
const torn = ref(false);
const cookStep = ref(0);
const cooked = ref<NewsPaper | null>(null);
const cookFailed = ref(false);
const tasted = ref(0);
const follow = useNewsFollow();
const body = ref<HTMLElement | null>(null);
const workInput = ref<HTMLInputElement | null>(null);
let followLoaded = false;
let alive = true;
onBeforeUnmount(() => { alive = false; window.clearTimeout(townTimer); townAbort?.abort(); });

const TIMES = ["06:30", "06:45", "07:00", "07:30", "08:00", "08:30"];
const times = computed(() => [...new Set([...TIMES, time.value])].sort());
const reduceMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

const title = computed(() => step.value === "cooking" && cooked.value ? "Your first paper is ready" : NEWS_SETUP_TITLES[step.value]);
const stepIndex = computed(() => NEWS_SETUP_STEPS.indexOf(step.value));
const showProgress = computed(() => stepIndex.value >= 1 && stepIndex.value <= 5);
const back = computed(() => settings.value ? newsSetupBack(step.value) : null);
const cookingBusy = computed(() => step.value === "cooking" && !cooked.value && !cookFailed.value);
const profileReady = computed(() => Boolean(townText.value.trim() && workText.value.trim()));
const dishesOn = computed(() => [...work.value, ...mine.value].filter(chip => chip.on).map(chip => chip.label));
const follows = computed(() => follow.follows.value);
const receipt = computed(() => newsReceiptLines({ base: base.value, dishes: dishesOn.value, follows: follows.value, city: settings.value?.city ?? null, time: time.value }));
const cookSteps = computed(() => newsCookSteps({ paper: cooked.value, base: base.value, dishes: dishesOn.value, city: settings.value?.city ?? null }));
const courses = computed(() => [
  { lane: "work" as const, title: "For your work", fallback: "💼", chips: work.value },
  { lane: "mine" as const, title: "Just for you", fallback: "💛", chips: mine.value },
]);
const pantryChips = computed({
  get: () => pantryLane.value === "work" ? work.value : mine.value,
  set: chips => { if (pantryLane.value === "work") work.value = chips; else if (pantryLane.value === "mine") mine.value = chips; },
});

function go(next: NewsSetupStep) {
  error.value = "";
  step.value = next;
  void nextTick(() => { if (body.value) body.value.scrollTop = 0; });
}
function goBack() { if (back.value) go(back.value); }
// The Escape key and the close button. While the paper cooks the sheet stays; once it is cooked, closing reads it.
function requestClose() {
  if (cookingBusy.value) return;
  if (step.value === "cooking") finish(); else emit("close");
}
function finish() {
  if (cooked.value) emit("finished", cooked.value); else emit("close");
}

async function load() {
  loadFailed.value = false;
  try {
    const loaded = await api.get<NewsSetupSettings>("/news/settings?profile=1");
    if (!alive) return;
    settings.value = loaded;
    work.value = loaded.work; mine.value = loaded.mine;
    base.value = readNewsBase(loaded.base);
    time.value = loaded.time; notify.value = loaded.notify;
    townText.value = loaded.city ?? ""; townChosen.value = Boolean(loaded.city);
    workText.value = loaded.profile?.work ?? ""; missionText.value = loaded.profile?.mission ?? "";
    follow.follows.value = readFollowPicks(loaded.follows);
    // Owners coming back to change their order skip the intro.
    if (loaded.setUp && step.value === "intro") step.value = "profile";
  } catch { if (alive) loadFailed.value = true; }
}
onMounted(load);

// Profile: where you live, what you do and, if you like, your mission.
let townTimer: number | undefined;
let townAbort: AbortController | null = null;
function onTownInput() {
  townChosen.value = false; townCountry.value = null;
  window.clearTimeout(townTimer); townAbort?.abort();
  const text = townText.value.trim();
  if (text.length < 2) { townResults.value = []; return; }
  townTimer = window.setTimeout(async () => {
    const abort = townAbort = new AbortController();
    try {
      const found = await searchLocations(text, { limit: 6, signal: abort.signal });
      if (abort.signal.aborted || !alive) return;
      townResults.value = found; townLookupDown.value = false;
    } catch {
      if (abort.signal.aborted || !alive) return;
      townResults.value = []; townLookupDown.value = true;
    }
  }, 300);
}
function chooseTown(result: LocationSearchResult) {
  window.clearTimeout(townTimer); townAbort?.abort();
  townText.value = newsTownName(result);
  townCountry.value = result.countryCode ?? null;
  townChosen.value = true; townResults.value = [];
  workInput.value?.focus();
}
function onTownFocusOut(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) townOpen.value = false;
}

/**
 * Saves the form to the owner's ME3 before moving on: the town to News, what they do to News (an
 * older ME3 gets it as a work topic instead) and the mission to their Mission.
 */
async function saveProfileThenBase() {
  const current = settings.value;
  if (!current || !profileReady.value || savingProfile.value) return;
  savingProfile.value = true; error.value = "";
  const town = townText.value.trim(), job = workText.value.trim(), mission = missionText.value.trim();
  const profile = { work: current.profile?.work ?? null, mission: current.profile?.mission ?? null, goals: current.profile?.goals ?? [] };
  try {
    if (town !== current.city) {
      // A town goes with its country, so "Dublin" is the one in Ireland; a ME3 that refuses the country still takes the town.
      try { await api.patch("/news/settings", { city: town, ...(townCountry.value ? { country: townCountry.value } : {}) }); }
      catch (failure) { if (!townCountry.value) throw failure; await api.patch("/news/settings", { city: town }); }
      current.city = town;
    }
    if (job !== profile.work) {
      try { await api.patch("/news/settings", { occupation: job }); profile.work = job; }
      catch (failure) {
        if (!(failure instanceof ApiError && failure.status === 400)) throw failure;
        const word = job.toLowerCase();
        if (!work.value.some(chip => chip.word === word)) work.value = [{ word, label: job.slice(0, 40), on: true }, ...work.value];
      }
    }
    if (mission && mission !== profile.mission) {
      await api.put("/mission-control/mission", { statement: mission });
      profile.mission = mission;
    }
    settings.value = { ...current, profile };
    go("base");
  } catch {
    settings.value = { ...current, profile };
    error.value = "Couldn’t save that. Check your connection and try again.";
  } finally { savingProfile.value = false; }
}

function flip(lane: NewsPantryLane, word: string) {
  const flipped = (chips: NewsTopicChip[]) => chips.map(chip => chip.word === word ? { ...chip, on: !chip.on } : chip);
  if (lane === "work") work.value = flipped(work.value); else mine.value = flipped(mine.value);
}

watch(step, next => {
  if (next !== "follow" || followLoaded) return;
  followLoaded = true;
  void follow.load(follow.follows.value);
});

// Receipt and cooking: tear off to place the order, then build the first paper straight away.
async function placeOrder() {
  if (torn.value) return;
  torn.value = true; error.value = "";
  const order = newsSetupOrder({ work: work.value, mine: mine.value, base: base.value, time: time.value, notify: notify.value, follows: follows.value });
  try {
    try { await api.patch("/news/settings", order); }
    // A ME3 from before feelings takes the order without them.
    catch (failure) { if (!(failure instanceof ApiError && failure.status === 400)) throw failure; await api.patch("/news/settings", newsSetupOrderWithoutBase(order)); }
  } catch {
    torn.value = false;
    error.value = "Couldn’t place your order. Try again.";
    return;
  }
  await wait(reduceMotion() ? 0 : 450);
  if (!alive) return;
  go("cooking");
  await cook();
}

async function cook() {
  cookStep.value = 0; cooked.value = null; cookFailed.value = false; tasted.value = 0;
  const pace = reduceMotion() ? 50 : 1100;
  let stopped = false;
  const ticker = (async () => {
    for (let next = 1; next <= 5; next++) {
      await wait(pace);
      // The last step waits for the paper itself.
      if (stopped || !alive || (next === 5 && !cooked.value)) return;
      cookStep.value = next;
      tasted.value = Math.min(tasted.value + 180 + Math.floor(Math.random() * 241), 1800);
    }
  })();
  try {
    const paper = (await api.post<{ paper: NewsPaper }>("/news/build", {})).paper;
    if (!alive) return;
    cooked.value = paper;
    await ticker;
    cookStep.value = 6; tasted.value = newsTastedTotal(paper, tasted.value);
  } catch {
    stopped = true;
    cookFailed.value = true;
  }
}
</script>

<template>
  <AppDialog open class="news-kitchen" aria-label="Set up your morning paper" @close="requestClose">
    <section class="setup" :class="`is-${step}`" data-testid="news-setup">
      <div class="setup__awning" aria-hidden="true" />
      <header class="setup__head">
        <button v-if="back" type="button" class="setup__icon" aria-label="Back" data-testid="news-setup-back" @click="goBack"><UiIcon name="ChevronLeft" :size="20" /></button>
        <span v-else class="setup__icon-space" />
        <h2 v-if="title">{{ title }}</h2><span v-else />
        <button v-if="step !== 'cooking'" type="button" class="setup__icon" aria-label="Close" @click="requestClose"><UiIcon name="X" :size="20" /></button>
        <span v-else class="setup__icon-space" />
      </header>
      <div v-if="showProgress" class="setup__progress" aria-hidden="true"><span v-for="index in 5" :key="index" :class="{ 'is-on': index <= stepIndex }" /></div>

      <div ref="body" class="setup__body">
        <div v-if="!settings" class="setup__loading">
          <template v-if="loadFailed"><p>Couldn’t reach your ME3 just now.</p><button type="button" class="kitchen-btn" @click="load">Try again</button></template>
          <span v-else class="setup__spinner" role="status" aria-label="Loading" />
        </div>

        <template v-else>
          <div v-if="step === 'intro'" class="intro">
            <h3><span>ME3 gets the scoop</span><em>in The Human Soup</em></h3>
            <p>thehumansoup.ai is a source for news, podcasts and other content made by humans.</p>
            <div class="intro__art">
              <img class="intro__chef" src="/images/news/chef-me3.webp" alt="" width="461" height="640" />
              <img class="intro__cauldron" src="/images/news/soup-cauldron.webp" alt="The Human Soup’s cauldron, with little robot agents diving into the soup" width="500" height="490" />
            </div>
          </div>

          <div v-else-if="step === 'profile'" class="profile">
            <p class="setup__lead">This fills in your ME3 profile, so ME3 can make the paper yours.</p>
            <form class="profile__card" @submit.prevent="saveProfileThenBase">
              <div class="profile__town" @focusin="townOpen = true" @focusout="onTownFocusOut">
                <label class="profile__field">
                  <span class="profile__emoji" aria-hidden="true">📍</span>
                  <span class="profile__text"><span class="profile__label">Where you live</span>
                    <input v-model="townText" type="text" maxlength="80" placeholder="Your town, like Galway" autocomplete="address-level2" autocapitalize="words" spellcheck="false" data-testid="news-setup-town" @input="onTownInput" />
                  </span>
                </label>
                <ul v-if="townOpen && !townChosen && townResults.length" class="profile__towns" aria-label="Towns">
                  <li v-for="result in townResults.slice(0, 4)" :key="result.id">
                    <button type="button" @click="chooseTown(result)"><span>{{ result.locality || result.label }}</span><small v-if="result.locality">{{ result.label }}</small></button>
                  </li>
                </ul>
                <p v-else-if="townOpen && townLookupDown && townText.trim().length >= 2" class="profile__note">Can’t look up towns just now. ME3 will use what you typed.</p>
              </div>
              <label class="profile__field">
                <span class="profile__emoji" aria-hidden="true">💼</span>
                <span class="profile__text"><span class="profile__label">What you do</span>
                  <input ref="workInput" v-model="workText" type="text" maxlength="80" placeholder="Your work, like nurse or founder" autocomplete="organization-title" data-testid="news-setup-work" />
                </span>
              </label>
              <label class="profile__field">
                <span class="profile__emoji" aria-hidden="true">🧭</span>
                <span class="profile__text"><span class="profile__label">Your mission <span class="profile__optional">· optional</span></span>
                  <textarea v-model="missionText" rows="2" maxlength="600" placeholder="What you’re working towards" data-testid="news-setup-mission" />
                </span>
              </label>
              <button type="submit" hidden />
            </form>
            <p v-if="!profileReady" class="profile__hint">Add where you live and what you do to go on.</p>
          </div>

          <div v-else-if="step === 'base'" class="base">
            <p class="setup__lead">They say you are what you eat. Same goes for the content you consume. Let’s get you feeling tip top, shall we?</p>
            <div class="base__tiles">
              <button v-for="feeling in NEWS_FEELINGS" :key="feeling.id" type="button" class="tile" :class="[`tile--${feeling.id}`, { 'is-on': base.includes(feeling.id) }]" :aria-pressed="base.includes(feeling.id)" :aria-label="`${feeling.name}, ${feeling.line}`" :data-testid="`news-feeling-${feeling.id}`" @click="base = toggleNewsFeeling(base, feeling.id)">
                <span class="tile__emoji" aria-hidden="true">{{ feeling.emoji }}</span>
                <span class="tile__name">{{ feeling.name }}</span>
                <span class="tile__line">{{ feeling.line }}</span>
                <span v-if="base.includes(feeling.id)" class="tile__badge">{{ base[0] === feeling.id ? '1st' : '2nd' }}</span>
              </button>
            </div>
          </div>

          <div v-else-if="step === 'sauce'" class="sauce">
            <p class="setup__lead">ME3 picked these from your profile. Tap to change, or add more.</p>
            <div class="board">
              <section v-for="course in courses" :key="course.lane" class="board__course" :aria-label="course.title">
                <h3>{{ course.title }}</h3>
                <div class="board__dishes">
                  <button v-for="chip in course.chips" :key="chip.word" type="button" class="dish" :class="chip.on ? 'is-on' : 'is-off'" :aria-pressed="chip.on" :aria-label="chip.label" @click="flip(course.lane, chip.word)">
                    <span class="dish__plate"><span aria-hidden="true">{{ newsDishEmoji(chip.label, course.fallback) }}</span><span v-if="chip.on" class="dish__tick" aria-hidden="true"><UiIcon name="Check" :size="11" /></span></span>
                    <span class="dish__label">{{ chip.label }}</span>
                  </button>
                  <button type="button" class="dish dish--add" :aria-label="`Add to ${course.title}`" :data-testid="`news-setup-add-${course.lane}`" @click="pantryLane = course.lane">
                    <span class="dish__plate"><span aria-hidden="true">+</span></span>
                    <span class="dish__label">Add</span>
                  </button>
                </div>
              </section>
              <p class="board__local"><span aria-hidden="true">📍</span> Plus local news and weather for {{ settings.city || 'your town' }}</p>
            </div>
          </div>

          <div v-else-if="step === 'follow'" class="follow">
            <NewsFollow :state="follow" pick-class="news-kitchen" />
          </div>

          <div v-else-if="step === 'receipt'" class="order">
            <div class="receipt">
              <p class="receipt__brand">THE HUMAN SOUP</p>
              <p class="receipt__for">Order for {{ workText.trim() || 'you' }} · Table {{ townText.trim() }}</p>
              <template v-for="(line, index) in receipt" :key="index">
                <hr v-if="line.rule" />
                <p v-else class="receipt__line" :class="{ 'is-sub': line.sub, 'is-strong': line.strong }"><span>{{ line.key }}</span><i aria-hidden="true" /><span>{{ line.value }}</span></p>
              </template>
              <button type="button" class="receipt__tear" :class="{ 'is-torn': torn }" :disabled="torn" aria-label="Place order with ME3" data-testid="news-setup-place-order" @click="placeOrder">
                <span class="receipt__scissors" aria-hidden="true">✂</span>
                <strong>PLACE ORDER WITH ME3</strong><span class="receipt__hand" aria-hidden="true">tap to tear</span>
              </button>
            </div>
            <button type="button" class="order__time" :aria-expanded="timesOpen" @click="timesOpen = !timesOpen">Ready at {{ time }} · change</button>
            <div v-if="timesOpen" class="order__options">
              <label>Ready at <select v-model="time"><option v-for="choice in times" :key="choice" :value="choice">{{ choice }}</option></select></label>
              <label><input v-model="notify" type="checkbox" /> Let me know when it’s ready</label>
            </div>
          </div>

          <div v-else class="cooking">
            <div class="cooking__art" aria-hidden="true">
              <img class="cooking__cauldron" src="/images/news/soup-cauldron.webp" alt="" width="500" height="490" />
              <img class="cooking__chef" :class="{ 'is-in': cookStep > 0 }" src="/images/news/chef-me3.webp" alt="" width="461" height="640" />
            </div>
            <div class="led" role="img" :aria-label="`${tasted} stories tasted`"><span class="led__label">STORIES<br />TASTED</span><span class="led__num">{{ String(tasted).padStart(4, '0') }}</span></div>
            <ol class="cooking__steps">
              <li v-for="(item, index) in cookSteps" :key="index" :class="{ 'is-done': index < cookStep, 'is-now': index === cookStep }" :aria-current="index === cookStep ? 'step' : undefined">
                <span class="cooking__dot" aria-hidden="true"><UiIcon v-if="index < cookStep" name="Check" :size="12" /></span>
                <span class="cooking__text"><span>{{ item.title }}</span><small>{{ item.detail }}</small></span>
              </li>
            </ol>
            <p v-if="cooked" class="setup__sr" role="status">Your first paper is ready.</p>
          </div>
        </template>
      </div>

      <p v-if="error" class="setup__error" role="alert">{{ error }}</p>
      <!-- Kept above the button, outside the scrolling steps, so a failed build is never off screen. -->
      <p v-else-if="step === 'cooking' && cookFailed" class="setup__error setup__error--quiet" role="alert">The kitchen is busy. Your first paper will be ready at {{ time }}.</p>
      <footer v-if="settings && step !== 'receipt'" class="setup__foot">
        <button v-if="step === 'intro'" type="button" class="kitchen-btn" data-testid="news-setup-start" @click="go('profile')">Start</button>
        <button v-else-if="step === 'profile'" type="button" class="kitchen-btn" :disabled="!profileReady || savingProfile" data-testid="news-setup-profile-next" @click="saveProfileThenBase">{{ savingProfile ? 'Saving…' : 'Next' }}</button>
        <button v-else-if="step === 'base'" type="button" class="kitchen-btn" :disabled="!base.length" data-testid="news-setup-base-next" @click="go('sauce')">{{ base.length ? 'Ooohh, that’s more like it!' : 'Pick a feeling' }}</button>
        <button v-else-if="step === 'sauce'" type="button" class="kitchen-btn" :disabled="!dishesOn.length" data-testid="news-setup-sauce-next" @click="go('follow')">{{ dishesOn.length ? 'Next' : 'Pick at least one dish' }}</button>
        <button v-else-if="step === 'follow'" type="button" class="kitchen-btn" data-testid="news-setup-follow-next" @click="go('receipt')">{{ follows.length ? 'Next' : 'Skip for now' }}</button>
        <button v-else type="button" class="kitchen-btn" :disabled="cookingBusy" data-testid="news-setup-read" @click="finish">{{ cooked ? 'Read my paper' : cookFailed ? 'Close' : 'Cooking…' }}</button>
      </footer>
    </section>
    <NewsPantry v-model:chips="pantryChips" :lane="pantryLane" @close="pantryLane = null" />
  </AppDialog>
</template>

<!-- The Soup kitchen's colours and type, kept to this sheet and the dialogs it opens. The shared
     --ui-* roles are pointed at them so the pieces reused inside (NewsFollow, the YouTube pick) match. -->
<style>
.news-kitchen {
  --k-walls: #fbf3e3; --k-surface: #fffaf0; --k-muted: #f1e4c9; --k-ink: #2a1f17; --k-ink-muted: #75644f; --k-line: rgba(42, 31, 23, .14); --k-line-strong: rgba(42, 31, 23, .28);
  --k-tomato: #d24a2c; --k-awning: #fffaf0; --k-gingham: rgba(210, 74, 44, .16);
  --k-t-hopeful: #e6f2d3; --k-t-motivated: #fde9c8; --k-t-know: #dfe6f3; --k-t-connected: #f6dfd6;
  --k-board: #1d4239; --k-wood: #9a6236; --k-wood-dark: #5e3a1f; --k-chalk: #f4efe2;
  --k-paper: #fffdf6; --k-paper-ink: #2a1f17; --k-paper-rule: #d9cdb4; --k-paper-muted: #7d6f5b; --k-led: #ff5a36;
  --k-display: ui-serif, "New York", "Iowan Old Style", Georgia, "Times New Roman", serif;
  --k-hand: "Noteworthy", "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive;
  --k-chalk-font: "Chalkduster", "Noteworthy", "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive;
  --k-receipt: "Courier New", Courier, ui-monospace, monospace;
  --ui-bg: var(--k-walls); --ui-surface: var(--k-surface); --ui-surface-muted: var(--k-muted); --ui-text: var(--k-ink); --ui-text-muted: var(--k-ink-muted);
  --ui-border: var(--k-line); --ui-border-strong: var(--k-line-strong); --ui-focus: var(--k-ink); --ui-accent: var(--k-ink);
}
:root[data-theme="dark"] .news-kitchen {
  --k-walls: #17120e; --k-surface: #241c16; --k-muted: #2e241c; --k-ink: #f3e8d6; --k-ink-muted: #b3a28d; --k-line: rgba(243, 232, 214, .14); --k-line-strong: rgba(243, 232, 214, .28);
  --k-tomato: #e8603f; --k-awning: #e9dcc4; --k-gingham: rgba(232, 96, 63, .16);
  --k-t-hopeful: #26331a; --k-t-motivated: #3a2d14; --k-t-know: #1d2636; --k-t-connected: #3a241d;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) .news-kitchen {
    --k-walls: #17120e; --k-surface: #241c16; --k-muted: #2e241c; --k-ink: #f3e8d6; --k-ink-muted: #b3a28d; --k-line: rgba(243, 232, 214, .14); --k-line-strong: rgba(243, 232, 214, .28);
    --k-tomato: #e8603f; --k-awning: #e9dcc4; --k-gingham: rgba(232, 96, 63, .16);
    --k-t-hopeful: #26331a; --k-t-motivated: #3a2d14; --k-t-know: #1d2636; --k-t-connected: #3a241d;
  }
}
.news-kitchen .kitchen-btn { flex: none; display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 100%; min-height: 52px; padding: 0 20px; border: 1.5px solid var(--k-line-strong); border-radius: 999px; background: var(--k-muted); color: var(--k-ink); font: inherit; font-size: 16px; font-weight: 600; cursor: pointer; }
.news-kitchen .kitchen-btn:disabled { opacity: .5; cursor: default; }
.news-kitchen .kitchen-btn:not(:disabled):active { opacity: .75; }
.news-kitchen .kitchen-btn:focus-visible { outline: 2px solid var(--k-ink); outline-offset: 2px; }
</style>

<style scoped>
.setup { position: relative; display: flex; flex-direction: column; box-sizing: border-box; width: min(460px, 100%); height: min(860px, calc(100dvh - 48px)); overflow: hidden; border-radius: 28px; background: var(--k-walls); color: var(--k-ink); box-shadow: var(--ui-shadow-md); font-size: 16px; line-height: 1.4; }
/* The order sits on its tablecloth from the awning to the bottom of the sheet. */
.setup.is-receipt { background: linear-gradient(90deg, var(--k-gingham) 50%, transparent 50%) 0 0 / 30px 30px, linear-gradient(var(--k-gingham) 50%, transparent 50%) 0 0 / 30px 30px, var(--k-walls); }
@media (max-width: 640px) { .setup { width: 100%; height: 100dvh; border-radius: 0; } }
.setup :focus-visible { outline: 2px solid var(--k-ink); outline-offset: 2px; }

/* The striped awning with a scalloped hem, as on thehumansoup.ai. */
.setup__awning { position: relative; flex: none; height: 58px; filter: drop-shadow(0 4px 0 color-mix(in srgb, var(--k-ink) 10%, transparent)); }
.setup__awning::before, .setup__awning::after { content: ""; position: absolute; left: 0; right: 0; }
.setup__awning::before { top: 0; height: 45px; background: repeating-linear-gradient(90deg, var(--k-tomato) 0 26px, var(--k-awning) 26px 52px); }
.setup__awning::after { top: 32px; height: 26px; background: radial-gradient(circle at 13px 13px, var(--k-tomato) 12.6px, transparent 13px) 0 0 / 52px 26px repeat-x, radial-gradient(circle at 13px 13px, var(--k-awning) 12.6px, transparent 13px) 26px 0 / 52px 26px repeat-x; }

.setup__head { flex: none; display: grid; grid-template-columns: 40px minmax(0, 1fr) 40px; align-items: center; gap: 4px; padding: 12px 12px 0; }
.setup__head h2 { margin: 0; font-family: var(--k-display); font-size: 22px; font-weight: 800; line-height: 1.15; text-align: center; text-wrap: balance; }
.setup__icon, .setup__icon-space { width: 40px; height: 40px; }
.setup__icon { display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: var(--k-surface); box-shadow: inset 0 0 0 1px var(--k-line); color: var(--k-ink); cursor: pointer; }
.setup__progress { flex: none; display: flex; gap: 4px; padding: 12px 24px 0; }
.setup__progress span { flex: 1; height: 3px; border-radius: 3px; background: var(--k-line); }
.setup__progress span.is-on { background: var(--k-ink); }
.setup__body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; padding: 18px 16px 20px; }
.setup__body > * { flex: 1 0 auto; }
.setup__lead { margin: 0; color: var(--k-ink-muted); }
.setup__loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 300px; color: var(--k-ink-muted); }
.setup__loading p { margin: 0; }
.setup__spinner { width: 24px; height: 24px; border-radius: 50%; border: 2.5px solid var(--k-line-strong); border-top-color: var(--k-ink); animation: setup-spin .8s linear infinite; }
@keyframes setup-spin { to { transform: rotate(360deg); } }
.setup__error { flex: none; margin: 0 16px; padding: 10px 14px; border-radius: 14px; background: var(--k-surface); box-shadow: inset 0 0 0 1.5px var(--k-tomato); font-size: 14px; }
.setup__foot { flex: none; padding: 10px 16px calc(14px + env(safe-area-inset-bottom, 0px)); }
.setup__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.setup__error--quiet { box-shadow: inset 0 0 0 1px var(--k-line-strong); font-size: 15px; }
/* Each step fades in as it arrives. A plain animation, so it still shows if the page is in the background. */
.setup__body > * { animation: setup-in .2s ease; }
@keyframes setup-in { from { opacity: 0; } }

/* Intro: the pictures shrink to fit a short screen. */
.intro { display: flex; flex-direction: column; align-items: center; gap: 14px; padding-top: 8px; text-align: center; }
.intro h3 { margin: 0; font-family: var(--k-display); font-size: clamp(26px, 8vw, 32px); line-height: 1.15; }
.intro h3 span, .intro h3 em { display: block; }
.intro h3 span { font-weight: 800; }
.intro h3 em { font-weight: 600; }
.intro p { margin: 0; max-width: 300px; color: var(--k-ink-muted); }
.intro__art { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding-top: 12px; }
.intro__chef { position: relative; z-index: 1; width: min(120px, 17dvh); height: auto; }
.intro__cauldron { width: min(270px, 36dvh, 78%); height: auto; margin-top: -26px; }

/* Profile */
.profile { display: flex; flex-direction: column; gap: 14px; }
.profile__card { border-radius: 20px; background: var(--k-surface); box-shadow: 0 2px 6px color-mix(in srgb, var(--k-ink) 6%, transparent); }
.profile__card > * + * { box-shadow: inset 0 1px 0 var(--k-line); }
.profile__field { display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; cursor: text; }
.profile__emoji { flex: none; width: 28px; padding-top: 2px; font-size: 22px; text-align: center; }
.profile__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.profile__label { font-size: 15px; font-weight: 600; }
.profile__optional { font-weight: 400; color: var(--k-ink-muted); }
.profile__field input, .profile__field textarea { width: 100%; margin: 0; padding: 0; border: 0; outline: 0; background: transparent; box-shadow: none; color: var(--k-ink); font: inherit; font-size: 16px; resize: none; }
.profile__field :is(input, textarea):focus-visible { outline: none; }
.profile__field :is(input, textarea)::placeholder { color: var(--k-ink-muted); opacity: .8; }
.profile__field:focus-within .profile__label { text-decoration: underline; text-underline-offset: 3px; }
.profile__towns { margin: 0; padding: 0 0 6px; list-style: none; }
.profile__towns button { display: flex; flex-direction: column; gap: 1px; width: 100%; padding: 8px 16px 8px 56px; border: 0; background: none; color: var(--k-ink); font: inherit; text-align: left; cursor: pointer; }
.profile__towns button:hover { background: var(--k-muted); }
.profile__towns small { overflow: hidden; color: var(--k-ink-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.profile__note { margin: 0; padding: 0 16px 10px 56px; color: var(--k-ink-muted); font-size: 12px; }
.profile__hint { margin: 0; color: var(--k-ink-muted); font-size: 13px; text-align: center; }

/* Base: the tiles grow into the space the sheet has, up to a point. */
.base { display: flex; flex-direction: column; gap: 22px; }
.base__tiles { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: minmax(168px, 1fr); gap: 12px; max-height: 500px; }
.tile { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 16px; border: 0; border-radius: 22px; color: var(--k-ink); font: inherit; text-align: left; cursor: pointer; }
.tile--hopeful { background: var(--k-t-hopeful); } .tile--motivated { background: var(--k-t-motivated); } .tile--know { background: var(--k-t-know); } .tile--connected { background: var(--k-t-connected); }
.tile.is-on { box-shadow: inset 0 0 0 2.5px var(--k-ink); }
.tile__emoji { margin-bottom: auto; padding-bottom: 12px; font-size: 46px; line-height: 1; }
.tile__name { font-family: var(--k-display); font-size: 20px; font-weight: 800; }
.tile__line { color: var(--k-ink-muted); font-size: 13px; line-height: 1.3; }
.tile__badge { position: absolute; top: 12px; right: 12px; display: grid; place-items: center; height: 26px; padding: 0 8px; border-radius: 13px; background: var(--k-ink); color: var(--k-walls); font-size: 12px; font-weight: 700; }

/* Sauce: the chalkboard menu takes the rest of the sheet. */
.sauce { display: flex; flex-direction: column; gap: 18px; }
.board { flex: 1; display: flex; flex-direction: column; gap: 26px; padding: 24px 14px 18px; border: 9px solid var(--k-wood); border-radius: 6px; outline: 2px solid var(--k-wood-dark); outline-offset: -2px; background: var(--k-board); box-shadow: 0 8px 10px rgba(42, 31, 23, .35); color: var(--k-chalk); }
.board :focus-visible { outline-color: var(--k-chalk); }
.board__course h3 { margin: 0 0 14px; font-family: var(--k-chalk-font); font-size: 21px; font-weight: 400; text-align: center; }
.board__dishes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 4px; }
.dish { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; padding: 0; border: 0; background: none; color: var(--k-chalk); font: inherit; cursor: pointer; }
.dish__plate { position: relative; display: grid; place-items: center; width: 62px; max-width: 100%; aspect-ratio: 1; border-radius: 50%; background: color-mix(in srgb, var(--k-chalk) 10%, transparent); font-size: 30px; line-height: 1; }
.dish.is-on .dish__plate { box-shadow: inset 0 0 0 2px var(--k-chalk); }
.dish.is-off .dish__plate { background: color-mix(in srgb, var(--k-chalk) 5%, transparent); }
.dish.is-off .dish__plate > span { filter: grayscale(1); opacity: .45; }
.dish--add .dish__plate { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--k-chalk) 60%, transparent); font-size: 26px; }
.dish__tick { position: absolute; right: -3px; bottom: -1px; display: grid; place-items: center; width: 19px; height: 19px; border-radius: 50%; background: var(--k-chalk); box-shadow: 0 0 0 2px var(--k-board); color: var(--k-board); }
.dish__label { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 100%; padding-bottom: 2px; font-family: var(--k-hand); font-size: 13px; font-weight: 700; line-height: 1.3; text-align: center; overflow-wrap: anywhere; opacity: .65; }
.dish.is-on .dish__label { opacity: 1; }
.board__local { margin: auto 0 0; padding-top: 12px; border-top: 1px solid color-mix(in srgb, var(--k-chalk) 25%, transparent); font-family: var(--k-hand); font-size: 15px; font-weight: 700; text-align: center; opacity: .7; }

.follow :deep(.news-follow) { padding-top: 0; }
.follow :deep(.news-follow__lead) { font-size: 16px; }
.follow :deep(.news-follow__field) { box-shadow: inset 0 0 0 1px var(--k-line); background: var(--k-surface); }
.follow :deep(.news-follow__medium) { background: var(--k-surface); box-shadow: inset 0 0 0 1px var(--k-line); }
.follow :deep(.news-follow__medium.is-on) { background: var(--k-ink); box-shadow: none; }

/* Receipt: always paper, whatever the theme. */
.order { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.receipt { align-self: stretch; margin-top: 6px; padding: 18px 16px 0; background: var(--k-paper); box-shadow: 0 8px 10px rgba(42, 31, 23, .22); color: var(--k-paper-ink); font-family: var(--k-receipt); font-size: 13px; transform: rotate(-1deg); }
.receipt p { margin: 0; }
.receipt__brand { font-size: 14px; font-weight: 700; letter-spacing: 1.2px; text-align: center; }
.receipt__for { margin-top: 3px; color: var(--k-paper-muted); font-size: 11px; text-align: center; }
.receipt hr { height: 0; margin: 8px 0; border: 0; border-top: 1px dashed var(--k-paper-rule); }
.receipt__line { display: flex; align-items: baseline; gap: 6px; padding: 1.5px 0; }
.receipt__line span:first-child { flex: none; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.receipt__line i { flex: 1; min-width: 12px; border-bottom: 1.5px dotted var(--k-paper-rule); transform: translateY(-3px); }
.receipt__line span:last-child { text-align: right; }
.receipt__line.is-sub { padding-left: 14px; color: var(--k-paper-muted); font-size: 12px; }
.receipt__line.is-strong span:last-child, .receipt__line.is-strong:not(.is-sub) span:first-child { font-weight: 700; }
.receipt__tear { position: relative; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: center; gap: 4px 10px; width: calc(100% + 32px); margin: 10px -16px 0; padding: 18px 12px; border: 0; border-top: 2px dashed var(--k-paper-ink); background: var(--k-paper); color: var(--k-paper-ink); font: inherit; font-size: 15px; letter-spacing: .6px; cursor: pointer; transition: transform .4s ease-in, opacity .4s ease-in; }
.receipt__tear:hover:not(:disabled) { background: #f6efdc; }
.receipt__tear:focus-visible { outline: 2px solid var(--k-paper-ink); outline-offset: -4px; }
.receipt__tear.is-torn { opacity: 0; transform: translateY(40px) rotate(4deg); }
.receipt__scissors { position: absolute; top: -12px; left: 6px; padding: 0 2px; background: var(--k-paper); font-size: 15px; line-height: 1; transform: rotate(-90deg); }
.receipt__hand { color: var(--k-paper-muted); font-family: var(--k-hand); font-weight: 700; letter-spacing: 0; }
.order__time { padding: 6px 14px; border: 0; border-radius: 999px; background: var(--k-walls); color: var(--k-ink); font: inherit; font-size: 15px; cursor: pointer; }
.order__options { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; border-radius: 16px; background: var(--k-walls); font-size: 15px; }
.order__options label { display: flex; align-items: center; gap: 8px; }
.order__options select { padding: 6px 8px; border: 0; border-radius: 10px; background: var(--k-muted); color: var(--k-ink); font: inherit; }
.order__options input { width: 18px; height: 18px; margin: 0; accent-color: var(--k-ink); }

/* Cooking */
.cooking { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.cooking__art { position: relative; align-self: stretch; height: 200px; }
.cooking__cauldron { position: absolute; right: 0; bottom: 0; width: 200px; height: auto; }
.cooking__chef { position: absolute; left: 0; bottom: 24px; width: 88px; height: auto; transition: transform .9s cubic-bezier(.34, 1.56, .64, 1); }
.cooking__chef.is-in { transform: translateX(36px); }
.led { display: flex; align-items: center; gap: 10px; padding: 6px 7px 6px 12px; border-radius: 12px; background: #2a1f17; box-shadow: 0 3px 0 var(--k-wood-dark); }
.led__label { color: var(--k-paper); font-family: var(--k-receipt); font-size: 9px; font-weight: 700; letter-spacing: 1.4px; line-height: 1.25; }
.led__num { padding: 2px 8px; border-radius: 6px; background: #140d09; color: var(--k-led); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 26px; font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1.2; text-shadow: 0 0 6px color-mix(in srgb, var(--k-led) 70%, transparent); }
.cooking__steps { align-self: stretch; display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; list-style: none; }
.cooking__steps li { display: flex; align-items: flex-start; gap: 10px; color: var(--k-ink-muted); }
.cooking__dot { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--k-line-strong); }
.cooking__steps li.is-now .cooking__dot { box-shadow: inset 0 0 0 2px var(--k-ink); }
.cooking__steps li.is-done .cooking__dot { background: var(--k-ink); box-shadow: none; color: var(--k-walls); }
.cooking__text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.cooking__steps li.is-done .cooking__text > span, .cooking__steps li.is-now .cooking__text > span { color: var(--k-ink); }
.cooking__steps li.is-now .cooking__text > span { font-weight: 600; }
.cooking__text small { font-size: 13px; }

@media (prefers-reduced-motion: reduce) {
  .cooking__chef { transition: none; }
  .setup__body > * { animation: none; }
  .receipt__tear { transition: opacity .01s; }
  .receipt__tear.is-torn { transform: none; }
  .setup__spinner { animation-duration: 2.4s; }
}
</style>
