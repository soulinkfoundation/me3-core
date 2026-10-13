import { ref } from "vue";
import { api } from "../api";
import { useAppToast } from "./useAppToast";

// The owner's Soulink personal invite link. Friends who join with it are
// Linked, so they appear in People with the Soulink badge.
const inviteUrl = ref<string | null>(null);
const available = ref<boolean | null>(null);
let pending: Promise<string | null> | null = null;

export function useSoulinkInvite() {
  const { toastSuccess, toastError } = useAppToast();

  function load(): Promise<string | null> {
    if (inviteUrl.value) return Promise.resolve(inviteUrl.value);
    pending ||= api
      .get<{ ok: boolean; url: string }>("/soulink/invite-link")
      .then((response) => {
        inviteUrl.value = response.url;
        available.value = true;
        return response.url;
      })
      .catch(() => {
        available.value = false;
        return null;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  async function share(): Promise<void> {
    const url = await load();
    if (!url) {
      toastError("Connect Soulink in Settings to invite friends.");
      return;
    }
    const text = "Join me on Soulink";
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: text, text, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess("Invite link copied");
    } catch {
      toastSuccess(`Your invite link: ${url}`);
    }
  }

  return { available, load, share };
}

export function resetSoulinkInvite() {
  inviteUrl.value = null;
  available.value = null;
  pending = null;
}
