import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api";

export type ContactSource =
  | "booking"
  | "manual"
  | "agent"
  | "import"
  | "outreach"
  | "soulink";

export type ContactRelationship =
  | "client"
  | "prospect"
  | "contact";

export type ContactCloseness =
  | "very_close"
  | "close"
  | "acquaintance";

export type ContactStatus = "active" | "archived" | "dormant";
export type ContactMetadata = {
  closeness?: ContactCloseness | null;
  avatarUrl?: string | null;
  me3Url?: string | null;
  soulinkLinkId?: string | null;
  soulinkNodeId?: string | null;
  soulinkChatUrl?: string | null;
  soulinkOrigin?: string | null;
  soulinkSourceChatId?: string | null;
  soulinkStreamChannelId?: string | null;
  soulinkContextLabel?: string | null;
  soulinkSourceChatTitle?: string | null;
  soulinkSourceChatKind?: string | null;
  soulinkStatus?: string | null;
  soulinkLastActiveAt?: string | null;
} & Record<string, unknown>;

export type Contact = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: ContactSource;
  sourceRef: string | null;
  relationship: ContactRelationship;
  closeness: ContactCloseness | null;
  status: ContactStatus;
  notes: string | null;
  lastInteractionAt: string | null;
  socialHandles: Record<string, string>;
  metadata: ContactMetadata | null;
  createdAt: string;
  updatedAt: string;
  bookingCount: number;
  lastBookingAt: string | null;
  isClose: boolean;
  closeSince: string | null;
  isClient: boolean;
  lastInTouchAt: string | null;
};

export type ContactSummary = {
  total: number;
  clients: number;
  contacts: number;
  active: number;
  archived: number;
};

export type ContactInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  source?: ContactSource;
  relationship?: ContactRelationship;
  closeness?: ContactCloseness | null;
  status?: ContactStatus;
  notes?: string | null;
  lastInteractionAt?: string | null;
  socialHandles?: Record<string, string>;
  metadata?: ContactMetadata | null;
};

type ContactsResponse = {
  contacts: Contact[];
  summary: ContactSummary;
};

const emptySummary = (): ContactSummary => ({
  total: 0,
  clients: 0,
  contacts: 0,
  active: 0,
  archived: 0,
});

export const useContactsStore = defineStore("contacts", () => {
  const contacts = ref<Contact[]>([]);
  const summary = ref<ContactSummary>(emptySummary());
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  async function fetchContacts(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      const response = await api.get<ContactsResponse>("/contacts");
      contacts.value = response.contacts;
      summary.value = response.summary;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to load contacts";
    } finally {
      loading.value = false;
    }
  }

  async function createContact(input: ContactInput): Promise<Contact | null> {
    saving.value = true;
    error.value = null;

    try {
      const response = await api.post<{ ok: boolean; contact: Contact }>("/contacts", input);
      await fetchContacts();
      return response.contact;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to create contact";
      return null;
    } finally {
      saving.value = false;
    }
  }

  async function updateContact(
    contactId: string,
    input: Partial<ContactInput>,
  ): Promise<Contact | null> {
    saving.value = true;
    error.value = null;

    try {
      const response = await api.put<{ ok: boolean; contact: Contact }>(
        `/contacts/${contactId}`,
        input,
      );
      await fetchContacts();
      return response.contact;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to update contact";
      return null;
    } finally {
      saving.value = false;
    }
  }

  async function markInTouch(contactId: string): Promise<Contact | null> {
    error.value = null;
    try {
      const response = await api.post<{ ok: boolean; contact: Contact }>(
        `/contacts/${contactId}/in-touch`,
      );
      replaceContact(response.contact);
      return response.contact;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to save";
      return null;
    }
  }

  function replaceContact(contact: Contact) {
    const index = contacts.value.findIndex((entry) => entry.id === contact.id);
    if (index >= 0) contacts.value.splice(index, 1, { ...contacts.value[index], ...contact });
  }

  return {
    contacts,
    summary,
    loading,
    saving,
    error,
    fetchContacts,
    createContact,
    updateContact,
    markInTouch,
  };
});
