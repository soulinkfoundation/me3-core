import { ref } from "vue";
import { api } from "../api";
import { useAppToast } from "./useAppToast";
import type { NewsSettings, NewsTopicChip } from "../utils/news";

// News settings shared by the settings sheet and the setup chips in chat (me3-6ptk.2). A change
// shows at once and is saved behind it; a failed save puts the old settings back.
export function useNewsSettings() {
  const { toastFromUnknown } = useAppToast();
  const settings = ref<NewsSettings | null>(null);
  const saving = ref(false);
  async function load() {
    try { settings.value = await api.get<NewsSettings>("/news/settings"); }
    catch (error) { toastFromUnknown(error, "Couldn't load your news settings"); }
  }
  async function patch(change: Record<string, unknown>, optimistic?: Partial<NewsSettings>) {
    const before = settings.value;
    if (before && optimistic) settings.value = { ...before, ...optimistic };
    saving.value = true;
    try { settings.value = await api.patch<NewsSettings>("/news/settings", change); return true; }
    catch (error) { settings.value = before; toastFromUnknown(error, "Couldn't save that"); return false; }
    finally { saving.value = false; }
  }
  const lane = (chips: NewsTopicChip[]) => chips.map(chip => ({ label: chip.label, on: chip.on }));
  function toggle(group: "work" | "mine", word: string) {
    if (!settings.value) return;
    const chips = settings.value[group].map(chip => chip.word === word ? { ...chip, on: !chip.on } : chip);
    return patch({ [group]: lane(chips) }, { [group]: chips });
  }
  function addTopic(group: "work" | "mine", label: string) {
    const text = label.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!settings.value || !text) return;
    const word = text.toLowerCase();
    const existing = settings.value[group];
    const chips = existing.some(chip => chip.word === word) ? existing.map(chip => chip.word === word ? { ...chip, on: true } : chip) : [...existing.filter(chip => chip.on), { word, label: text, on: true }, ...existing.filter(chip => !chip.on)];
    return patch({ [group]: lane(chips) }, { [group]: chips });
  }
  return { settings, saving, load, patch, toggle, addTopic };
}
