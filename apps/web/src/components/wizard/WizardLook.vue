<script setup lang="ts">
import { computed, ref } from "vue";
import type { SiteLayout } from "@me3-core/site-renderer";
import { useWizardStore } from "../../stores/wizard";
import { vibes, selectableVibeIds } from "../../styles/vibes";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { useAppToast } from "../../composables/useAppToast";

const wizard = useWizardStore();
const showFooter = ref(false);
const layouts: { id: SiteLayout; label: string }[] = [
  { id: "card", label: "Card" }, { id: "split", label: "Split" },
  { id: "cover", label: "Cover" }, { id: "minimal", label: "Minimal" },
];
const layout = computed(() => wizard.profile.layout === "classic" ? "card" : wizard.profile.layout === "portrait" ? "split" : wizard.profile.layout);
const { toastError } = useAppToast();
// Organizations set their logo in the Logo step, which uses the avatar slot.
const showLogo = computed(() => wizard.siteRole !== "organization");
const logoInput = ref<HTMLInputElement | null>(null);
const maxLogoBytes = 1_900_000;

function chooseLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    toastError("Choose a PNG, JPEG or WebP image.");
    return;
  }
  if (file.size > maxLogoBytes) {
    toastError("That logo is too large. Choose an image under 1.9 MB.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => wizard.updateProfile({ logo: String(reader.result), logoBlob: file });
  reader.onerror = () => toastError("Couldn't read that image. Please try another.");
  reader.readAsDataURL(file);
}

function removeLogo() {
  wizard.updateProfile({ logo: null, logoBlob: null });
}

const accents = ["#2b2723", "#b5522d", "#3f6b35", "#3d9b7c", "#315d86", "#87426f"];
</script>

<template>
  <div class="step-look">
    <h2>Make it yours</h2>
    <p class="section-desc">Pick a look. Everything updates live.</p>
    <fieldset v-if="showLogo"><legend>Logo</legend>
      <div class="look-logo">
        <span class="look-logo__preview" aria-hidden="true">
          <img v-if="wizard.profile.logo" :src="wizard.profile.logo" alt="" />
          <UiIcon v-else name="Image" :size="22" />
        </span>
        <div class="look-logo__body">
          <div class="look-logo__actions">
            <Button color="neutral" shape="soft" size="compact" @click="logoInput?.click()">{{ wizard.profile.logo ? "Change logo" : "Upload logo" }}</Button>
            <Button v-if="wizard.profile.logo" color="ghost" size="compact" @click="removeLogo">Remove</Button>
          </div>
          <p id="look-logo-hint" class="look-logo__hint">Shown in place of your name at the top of your site, and in the browser tab. PNG, JPEG or WebP, up to 1.9 MB.</p>
        </div>
        <input ref="logoInput" class="look-logo__input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose site logo" aria-describedby="look-logo-hint" @change="chooseLogo" />
      </div>
    </fieldset>
    <fieldset><legend>Layout</legend>
      <div class="look-layouts">
        <label v-for="choice in layouts" :key="choice.id" class="look-layout" :class="{ selected: layout === choice.id }">
          <input type="radio" name="site-layout" :value="choice.id" :checked="layout === choice.id" @change="wizard.updateProfile({ layout: choice.id })" />
          <span class="look-thumbnail" :class="`look-thumbnail--${choice.id}`" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>{{ choice.label }}</span>
        </label>
      </div>
    </fieldset>
    <fieldset><legend>Theme</legend>
      <div class="look-themes">
        <button v-for="id in selectableVibeIds" :key="id" type="button" :aria-label="`${vibes[id].name} theme`" :aria-pressed="wizard.vibe === id" @click="wizard.setVibe(id)">
          <span :style="{ background: vibes[id].colors.bg, color: vibes[id].colors.accent, fontFamily: vibes[id].fontFamily }">Aa</span>{{ vibes[id].name }}
        </button>
      </div>
    </fieldset>
    <fieldset><legend>Accent</legend>
      <div class="look-accents">
        <button type="button" class="look-default" aria-label="Theme default accent" :aria-pressed="!wizard.accentOverride" :style="{ background: `conic-gradient(${vibes[wizard.vibe].colors.accent} 0 50%, ${vibes[wizard.vibe].colors.bg} 0)` }" @click="wizard.setAccentOverride(null)" />
        <button v-for="color in accents" :key="color" type="button" :aria-label="`Use accent ${color}`" :aria-pressed="wizard.accentOverride === color" :style="{ background: color }" @click="wizard.setAccentOverride(color)" />
        <label class="look-custom"><input type="color" aria-label="Custom accent colour" :value="wizard.accentOverride || vibes[wizard.vibe].colors.accent" @input="wizard.setAccentOverride(($event.target as HTMLInputElement).value)" /></label>
      </div>
    </fieldset>
    <fieldset><legend>Appearance</legend>
      <div class="look-appearance">
        <label v-for="mode in ['auto', 'light', 'dark'] as const" :key="mode" :class="{ selected: wizard.colorMode === mode }"><input type="radio" name="site-color-mode" :value="mode" :checked="wizard.colorMode === mode" @change="wizard.setColorMode(mode)" />{{ mode === 'auto' ? 'Auto' : mode === 'light' ? 'Light' : 'Dark' }}</label>
      </div>
      <label class="look-visitor-switch"><input type="checkbox" :checked="wizard.visitorThemeToggle" @change="wizard.setVisitorThemeToggle(($event.target as HTMLInputElement).checked)" />Show a light/dark switch to visitors</label>
    </fieldset>
    <button type="button" class="look-footer-link" @click="showFooter = true"><UiIcon name="Settings" :size="16" />Customize footer</button>
    <AppDialog :open="showFooter" aria-label="Footer settings" close-on-backdrop @close="showFooter = false">
      <section class="look-footer-dialog">
        <header><h2>Footer settings</h2><button type="button" aria-label="Close footer settings" @click="showFooter = false"><UiIcon name="X" :size="20" /></button></header>
        <p>Customize or remove the footer for this Core-published site.</p>
        <label v-for="option in [{ id: 'default', label: 'Keep Powered by me3' }, { id: 'custom', label: 'Custom text and link' }, { id: 'none', label: 'No footer' }] as const" :key="option.id"><input type="radio" name="footer-mode" :value="option.id" :checked="wizard.profile.footer.mode === option.id" @change="wizard.setFooter({ mode: option.id })" />{{ option.label }}</label>
        <template v-if="wizard.profile.footer.mode === 'custom'">
          <label>Text<input type="text" :value="wizard.profile.footer.text" @input="wizard.setFooter({ text: ($event.target as HTMLInputElement).value })" /></label>
          <label>Link text<input type="text" :value="wizard.profile.footer.linkText" @input="wizard.setFooter({ linkText: ($event.target as HTMLInputElement).value })" /></label>
          <label>Link URL<input type="url" :value="wizard.profile.footer.linkUrl" placeholder="https://example.com" @input="wizard.setFooter({ linkUrl: ($event.target as HTMLInputElement).value })" /></label>
        </template>
        <button type="button" class="look-footer-done" @click="showFooter = false">Done</button>
      </section>
    </AppDialog>
  </div>
</template>

<style scoped>
fieldset { min-width: 0; margin: 24px 0; padding: 0; border: 0; }
legend { padding: 0; margin-bottom: 12px; font-size: 13px; color: var(--ui-text-muted); }
.look-logo { display: flex; align-items: center; gap: 16px; }
.look-logo__preview { display: grid; place-items: center; flex: 0 0 64px; width: 64px; height: 64px; overflow: hidden; border-radius: 16px; background: var(--ui-surface-muted); color: var(--ui-text-muted); }
.look-logo__preview img { width: 100%; height: 100%; object-fit: contain; }
.look-logo__body { display: grid; gap: 6px; min-width: 0; }
.look-logo__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.look-logo__hint { margin: 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.45; }
.look-logo__input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.look-layouts, .look-themes { display: flex; gap: 14px; overflow-x: auto; padding: 4px; margin: -4px; }
.look-layout { position: relative; display: grid; justify-items: center; gap: 8px; flex: 0 0 96px; font-size: 13px; color: var(--ui-text-muted); cursor: pointer; }
.look-layout input, .look-appearance input { position: absolute; inset: 0; z-index: 1; margin: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
.look-layout.selected { color: var(--ui-text); font-weight: 600; }
.look-thumbnail { position: relative; display: block; width: 96px; height: 120px; overflow: hidden; border-radius: 16px; background: var(--ui-surface-muted); }
.look-layout.selected .look-thumbnail { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.look-thumbnail i { position: absolute; display: block; border-radius: 3px; background: var(--ui-text-muted); opacity: .4; }
.look-thumbnail--card i:first-child { inset: 0 0 auto; height: 36px; }
.look-thumbnail--card i:nth-child(2) { width: 26px; height: 26px; top: 23px; left: 35px; border-radius: 50%; }
.look-thumbnail--card i:nth-child(3) { width: 44px; height: 6px; top: 61px; left: 26px; }
.look-thumbnail--card i:last-child { width: 64px; height: 14px; top: 86px; left: 16px; border-radius: 8px; }
.look-thumbnail--split i:first-child { width: 32px; height: 46px; top: 16px; left: 10px; border-radius: 8px; }
.look-thumbnail--split i:nth-child(2) { width: 36px; height: 7px; top: 25px; right: 10px; }
.look-thumbnail--split i:nth-child(3) { width: 64px; height: 5px; top: 74px; left: 10px; }
.look-thumbnail--split i:last-child { width: 64px; height: 14px; top: 90px; left: 10px; border-radius: 8px; }
.look-thumbnail--cover { background: var(--ui-text-muted); }
.look-thumbnail--cover i { background: var(--ui-surface); opacity: .7; }
.look-thumbnail--cover i:first-child { width: 50px; height: 8px; top: 56px; left: 12px; }
.look-thumbnail--cover i:nth-child(2) { width: 70px; height: 4px; top: 73px; left: 12px; }
.look-thumbnail--cover i:nth-child(3) { width: 70px; height: 14px; top: 91px; left: 12px; border-radius: 8px; }
.look-thumbnail--minimal i:first-child { width: 48px; height: 12px; top: 20px; left: 12px; }
.look-thumbnail--minimal i:nth-child(2) { width: 64px; height: 4px; top: 45px; left: 12px; }
.look-thumbnail--minimal i:nth-child(3) { width: 50px; height: 4px; top: 57px; left: 12px; }
.look-thumbnail--minimal i:last-child { width: 70px; height: 14px; top: 88px; left: 12px; border-radius: 8px; }
.look-themes button { display: grid; justify-items: center; gap: 8px; flex: 0 0 64px; min-height: 86px; padding: 4px; border: 0; border-radius: 12px; background: transparent; color: var(--ui-text-muted); font: 500 13px var(--font-sans); cursor: pointer; }
.look-themes button span { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; box-shadow: var(--ui-shadow-sm); font-size: 22px; }
.look-themes button[aria-pressed="true"] span { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.look-accents { display: flex; flex-wrap: wrap; gap: 10px; padding: 4px; }
.look-accents button, .look-custom { display: block; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; }
.look-accents button[aria-pressed="true"] { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.look-custom { overflow: hidden; background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red); }
.look-custom input { width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.look-appearance { display: flex; gap: 4px; padding: 4px; border-radius: 24px; background: var(--ui-surface-muted); }
.look-appearance label { position: relative; display: grid; place-items: center; flex: 1; min-height: 44px; border-radius: 20px; cursor: pointer; }
.look-appearance .selected { background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.look-visitor-switch { display: flex; align-items: center; gap: 10px; margin-top: 12px; min-height: 44px; font-size: 14px; }
.look-footer-link { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--ui-text-muted); font: inherit; cursor: pointer; }
.look-footer-dialog { display: grid; gap: 14px; width: min(480px, 100%); margin: auto; padding: 24px; box-sizing: border-box; border-radius: 24px; background: var(--ui-surface); box-shadow: var(--ui-shadow-md); }
.look-footer-dialog header { display: flex; justify-content: space-between; align-items: center; }
.look-footer-dialog h2 { margin: 0; font-size: 20px; }.look-footer-dialog p { margin: 0; color: var(--ui-text-muted); font-size: 14px; }
.look-footer-dialog label { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-height: 44px; }
.look-footer-dialog input:not([type="radio"]) { width: 100%; box-sizing: border-box; padding: 12px; border: 0; border-radius: 14px; background: var(--ui-surface-muted); color: var(--ui-text); font: inherit; }
.look-footer-dialog header button { display: grid; place-items: center; min-width: 44px; min-height: 44px; border: 0; border-radius: 50%; color: var(--ui-text); background: transparent; cursor: pointer; }
.look-footer-done { min-height: 44px; border: 0; border-radius: 24px; background: var(--ui-primary); color: var(--ui-primary-contrast); font: 600 15px var(--font-sans); cursor: pointer; }
button:focus-visible, .look-layout:focus-within .look-thumbnail, .look-appearance label:focus-within, .look-custom:focus-within { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
</style>
