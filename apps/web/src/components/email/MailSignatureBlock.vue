<script setup lang="ts">
import { computed, ref } from "vue";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import MailComposeEditor from "./MailComposeEditor.vue";
import { api } from "../../api";
import { renderMailMarkdownFragment } from "../../../../../shared/mail-markdown";

// The owner's signature under a compose or reply editor. It is added when the
// mail is saved or sent, can be left off one email, and edited in place.

const props = defineProps<{ signature: string | null; included: boolean }>();
const emit = defineEmits<{
  (event: "update:included", value: boolean): void;
  (event: "saved", value: string | null): void;
}>();

const editing = ref(false);
const draft = ref("");
const saving = ref(false);
const error = ref("");

const previewHtml = computed(() =>
  props.signature ? renderMailMarkdownFragment(props.signature, { inlineStyles: false }) : "",
);

function openEditor() {
  draft.value = props.signature || "";
  error.value = "";
  editing.value = true;
}

async function save() {
  saving.value = true;
  error.value = "";
  try {
    const result = await api.put<{ signature: string | null }>("/mailbox/signature", {
      signature: draft.value,
    });
    emit("saved", result.signature);
    emit("update:included", Boolean(result.signature));
    editing.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "The signature could not be saved.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mail-signature">
    <template v-if="signature && included">
      <!-- Rendered from escaped Markdown by the shared mail renderer. -->
      <div class="mail-signature__preview" v-html="previewHtml" />
      <div class="mail-signature__actions">
        <button type="button" class="mail-signature__link" @click="openEditor">Edit signature</button>
        <button type="button" class="mail-signature__link" @click="emit('update:included', false)">Leave off this email</button>
      </div>
    </template>
    <div v-else class="mail-signature__actions">
      <button v-if="signature" type="button" class="mail-signature__link" @click="emit('update:included', true)">
        <UiIcon name="Plus" :size="13" aria-hidden="true" />
        Add signature
      </button>
      <button v-else type="button" class="mail-signature__link" @click="openEditor">
        <UiIcon name="Plus" :size="13" aria-hidden="true" />
        Create a signature
      </button>
    </div>

    <AppDialog :open="editing" class="mail-signature-dialog" labelled-by="mail-signature-title" @close="editing = false">
      <form class="mail-signature-dialog__card" @submit.prevent="save">
        <h2 id="mail-signature-title">Email signature</h2>
        <p class="mail-signature-dialog__hint">Added to new emails, replies and forwards. You can leave it off any email.</p>
        <div class="mail-signature-dialog__editor">
          <MailComposeEditor v-model="draft" placeholder="Your name, business and website" aria-label="Signature" />
        </div>
        <p v-if="error" class="mail-signature-dialog__error" role="alert">{{ error }}</p>
        <footer class="mail-signature-dialog__actions">
          <Button color="outline" shape="soft" size="compact" type="button" :disabled="saving" @click="editing = false">Cancel</Button>
          <Button color="primary" shape="soft" size="compact" type="submit" :disabled="saving">
            {{ saving ? "Saving…" : "Save signature" }}
          </Button>
        </footer>
      </form>
    </AppDialog>
  </div>
</template>

<style scoped>
.mail-signature {
  display: grid;
  gap: 4px;
}

.mail-signature__preview {
  padding-left: 2px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 14px;
  line-height: 1.5;
}

.mail-signature__preview :deep(p),
.mail-signature__preview :deep(ul),
.mail-signature__preview :deep(ol) {
  margin: 0 0 4px;
}

.mail-signature__preview :deep(a) {
  color: inherit;
}

.mail-signature__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
}

.mail-signature__link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.mail-signature__link:hover {
  color: var(--ui-text, var(--color-text));
  text-decoration: underline;
}

.mail-signature__link:focus-visible {
  outline: 2px solid var(--ui-accent, var(--color-accent));
  outline-offset: 1px;
}

.mail-signature-dialog__card {
  display: grid;
  gap: 12px;
  width: min(100%, 520px);
  box-sizing: border-box;
  padding: 18px 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  box-shadow: 0 20px 60px rgba(17, 17, 17, 0.18);
}

.mail-signature-dialog__card h2 {
  margin: 0;
  font-size: 18px;
}

.mail-signature-dialog__hint {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.mail-signature-dialog__editor {
  padding: 0 12px 6px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: 10px;
}

.mail-signature-dialog__editor :deep(.mail-compose-editor__content) {
  min-height: 110px;
  padding: 10px 0;
}

.mail-signature-dialog__error {
  margin: 0;
  color: var(--ui-danger, #c2410c);
  font-size: 13px;
}

.mail-signature-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
