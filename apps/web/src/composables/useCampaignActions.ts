import { computed, ref } from "vue";
import { api } from "../api";
import {
  cancelCampaignMessage,
  deleteCampaignMessage,
  type CampaignStatus,
} from "../utils/campaigns";
import { useAppToast } from "./useAppToast";

type CampaignRef = { id: string; subject: string; status: CampaignStatus };
type PendingAction = { kind: "cancel" | "delete"; campaign: CampaignRef };

/**
 * Cancel and delete ask in an in-app dialog first. Pages bind `dialog` to ConfirmationDialog and
 * pass callbacks that update their own state once the server has done it.
 */
export function useCampaignActions(handlers: {
  cancelled?: (id: string) => void | Promise<void>;
  deleted?: (id: string) => void | Promise<void>;
}) {
  const { toastFromUnknown } = useAppToast();
  const pending = ref<PendingAction | null>(null);
  const busy = ref(false);

  const dialog = computed(() => {
    const action = pending.value;
    if (!action) return null;
    return action.kind === "cancel"
      ? {
          title: "Cancel this campaign?",
          message: cancelCampaignMessage(action.campaign),
          confirmLabel: "Cancel campaign",
          cancelLabel: "Keep it",
        }
      : {
          title: "Delete this campaign?",
          message: deleteCampaignMessage(action.campaign),
          confirmLabel: "Delete",
          cancelLabel: "Keep it",
        };
  });

  function askCancel(campaign: CampaignRef) {
    pending.value = { kind: "cancel", campaign };
  }

  function askDelete(campaign: CampaignRef) {
    pending.value = { kind: "delete", campaign };
  }

  function dismiss() {
    if (!busy.value) pending.value = null;
  }

  async function confirm() {
    const action = pending.value;
    if (!action || busy.value) return;
    busy.value = true;
    const id = action.campaign.id;
    try {
      if (action.kind === "cancel") {
        await api.post(`/email/campaigns/${encodeURIComponent(id)}/cancel`);
        await handlers.cancelled?.(id);
      } else {
        await api.delete(`/email/campaigns/${encodeURIComponent(id)}`);
        await handlers.deleted?.(id);
      }
      pending.value = null;
    } catch (caught) {
      toastFromUnknown(
        caught,
        action.kind === "cancel" ? "Couldn't cancel the campaign." : "Couldn't delete the campaign.",
      );
    } finally {
      busy.value = false;
    }
  }

  function isBusy(id: string) {
    return busy.value && pending.value?.campaign.id === id;
  }

  return { dialog, busy, askCancel, askDelete, dismiss, confirm, isBusy };
}
