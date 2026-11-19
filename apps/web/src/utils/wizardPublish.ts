import { ref, type InjectionKey } from "vue";

/** The site editor's publish (with its checks), for sheets inside a step that publish first. Resolves true when live. */
export const WIZARD_PUBLISH_KEY: InjectionKey<() => Promise<boolean>> = Symbol("wizardPublish");

/**
 * The Publish step's Web address sheet. Publishing re-renders the step, so whether the sheet is open
 * and the domain waiting to connect live here, not in the step.
 */
export const domainSheetOpen = ref(false);
export const domainToConnect = ref("");
