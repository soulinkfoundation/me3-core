<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import UiIcon from "../UiIcon.vue";

function isEmptyEditorHtml(html: string): boolean {
  const t = html.replace(/\s/g, "");
  return t === "<p></p>" || t === "<p><br></p>" || t === "";
}

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  inputId?: string;
  maxCharacters?: number;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const showLinkModal = ref(false);
const linkUrl = ref("");
const linkError = ref<string | null>(null);

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: false,
      bulletList: false,
      orderedList: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false,
      code: false,
      strike: false,
      link: {
        openOnClick: false,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      },
    }),
    Placeholder.configure({
      placeholder: props.placeholder || "Describe this session",
    }),
  ],
  content: props.modelValue?.trim() ? props.modelValue : "<p></p>",
  editorProps: {
    attributes: {
      class: "booking-offer-description-editor__content",
      role: "textbox",
      "aria-multiline": "true",
      ...(props.inputId ? { id: props.inputId } : {}),
    },
  },
  onUpdate: ({ editor: ed }) => {
    const limit = props.maxCharacters;
    if (limit && ed.state.doc.textContent.length > limit) {
      let characters = 0;
      let cutPosition: number | null = null;
      ed.state.doc.descendants((node, position) => {
        if (!node.isText || cutPosition !== null) return;
        const length = node.text?.length || 0;
        const available = limit - characters;
        if (length > available) {
          cutPosition = position + Math.max(0, available);
          return;
        }
        characters += length;
      });
      if (cutPosition !== null) {
        ed.view.dispatch(ed.state.tr.delete(cutPosition, ed.state.doc.content.size));
        return;
      }
    }
    const html = ed.getHTML();
    emit("update:modelValue", isEmptyEditorHtml(html) ? "" : html);
  },
});

function openLinkModal() {
  linkError.value = null;
  const existing = editor.value?.getAttributes("link")?.href as
    | string
    | undefined;
  linkUrl.value = existing || "";
  showLinkModal.value = true;
}

function closeLinkModal() {
  showLinkModal.value = false;
  linkError.value = null;
  linkUrl.value = "";
}

function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^(?:\/(?!\/)|\.\.?\/|#)/.test(raw)) return raw;
  if (raw.startsWith("mailto:")) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(raw)) return `https://${raw}`;
  return null;
}

function applyLink() {
  linkError.value = null;
  const normalized = normalizeUrl(linkUrl.value);
  if (!normalized) {
    linkError.value =
      "Enter a valid URL, an internal path (such as /about), or mailto:";
    return;
  }

  editor.value
    ?.chain()
    .focus()
    .extendMarkRange("link")
    .setLink({ href: normalized })
    .run();

  closeLinkModal();
}

function removeLink() {
  editor.value?.chain().focus().unsetLink().run();
  closeLinkModal();
}

watch(
  () => props.modelValue,
  (next) => {
    if (!editor.value) return;
    const incoming = next ?? "";
    const cur = editor.value.getHTML();
    const curEmitted = isEmptyEditorHtml(cur) ? "" : cur;
    if (curEmitted === incoming) return;
    editor.value.commands.setContent(incoming.trim() ? incoming : "<p></p>");
  },
);

onBeforeUnmount(() => {
  editor.value?.destroy();
});
</script>

<template>
  <div class="booking-offer-description-editor">
    <div v-if="editor" class="booking-offer-description-editor__toolbar">
      <button
        type="button"
        class="booking-offer-description-editor__btn booking-offer-description-editor__btn--text"
        :class="{ active: editor?.isActive('bold') }"
        title="Bold"
        aria-label="Bold"
        @click="editor?.chain().focus().toggleBold().run()"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        class="booking-offer-description-editor__btn booking-offer-description-editor__btn--text"
        :class="{ active: editor?.isActive('italic') }"
        title="Italic"
        aria-label="Italic"
        @click="editor?.chain().focus().toggleItalic().run()"
      >
        <em>I</em>
      </button>
      <button
        type="button"
        class="booking-offer-description-editor__btn"
        :class="{ active: editor?.isActive('link') }"
        title="Link"
        aria-label="Add or edit link"
        @click="openLinkModal"
      >
        <UiIcon name="Link" :size="16" aria-hidden="true" />
      </button>
    </div>

    <div class="booking-offer-description-editor__surface">
      <EditorContent v-if="editor" :editor="editor" />
    </div>

    <div
      v-if="showLinkModal"
      class="booking-offer-description-editor__overlay"
      @click.self="closeLinkModal"
    >
      <div
        class="booking-offer-description-editor__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-offer-link-title"
      >
        <h4 id="booking-offer-link-title">Add link</h4>
        <input
          v-model="linkUrl"
          type="text"
          placeholder="https://example.com"
          @keyup.enter="applyLink"
          @keyup.esc="closeLinkModal"
        />
        <p v-if="linkError" class="booking-offer-description-editor__error">
          {{ linkError }}
        </p>
        <div class="booking-offer-description-editor__modal-actions">
          <button type="button" class="btn-cancel" @click="closeLinkModal">
            Cancel
          </button>
          <button
            v-if="editor?.isActive('link')"
            type="button"
            class="btn-remove"
            @click="removeLink"
          >
            Remove
          </button>
          <button type="button" class="btn-save" @click="applyLink">
            Save
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.booking-offer-description-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ui-text, var(--color-text));
}

.booking-offer-description-editor__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.booking-offer-description-editor__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  cursor: pointer;
}

.booking-offer-description-editor__btn:hover {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.booking-offer-description-editor__btn.active {
  border-color: var(--ui-accent, var(--color-accent));
  background: color-mix(
    in oklab,
    var(--ui-accent, var(--color-accent)) 14%,
    var(--ui-surface, var(--color-bg))
  );
  color: var(--ui-text, var(--color-text));
}

.booking-offer-description-editor__btn--text {
  font-size: 0.85rem;
}

.booking-offer-description-editor__surface {
  min-height: 72px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 8px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
}

.booking-offer-description-editor__surface :deep(.tiptap) {
  padding: 10px 12px;
  min-height: 52px;
  outline: none;
  font-size: 0.95rem;
  line-height: 1.45;
  color: var(--ui-text, var(--color-text));
}

.booking-offer-description-editor__surface :deep(.tiptap p.is-editor-empty:first-child::before) {
  color: var(--ui-text-muted, var(--color-text-muted));
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

.booking-offer-description-editor__surface :deep(.tiptap a) {
  color: var(--ui-accent, var(--color-accent));
  text-decoration: underline;
}

.booking-offer-description-editor__overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.45);
}

.booking-offer-description-editor__modal {
  width: 100%;
  max-width: 380px;
  padding: 16px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-lg, 10px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  box-shadow: var(--ui-shadow-md, 0 12px 40px rgba(0, 0, 0, 0.18));
}

.booking-offer-description-editor__modal h4 {
  margin: 0 0 10px;
  font-size: 1rem;
  font-weight: 600;
}

.booking-offer-description-editor__modal input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 6px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font-size: 0.95rem;
}

.booking-offer-description-editor__modal input::placeholder {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.booking-offer-description-editor__error {
  margin: 8px 0 0;
  font-size: 0.85rem;
  color: var(--ui-danger, #b91c1c);
}

.booking-offer-description-editor__modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}

.booking-offer-description-editor__modal-actions button {
  padding: 6px 12px;
  border-radius: var(--ui-radius-sm, 6px);
  border: 1px solid transparent;
  font-size: 0.9rem;
  cursor: pointer;
}

.btn-cancel {
  background: var(--ui-surface, var(--color-bg));
  border-color: var(--ui-border, var(--color-border)) !important;
  color: var(--ui-text, var(--color-text));
}

.btn-remove {
  border-color: color-mix(
    in oklab,
    var(--ui-danger, #b91c1c) 36%,
    var(--ui-border, var(--color-border))
  ) !important;
  background: color-mix(
    in oklab,
    var(--ui-danger, #b91c1c) 10%,
    var(--ui-surface, var(--color-bg))
  );
  color: var(--ui-danger, #b91c1c);
}

.btn-save {
  background: var(--ui-accent, var(--color-accent));
  color: var(--ui-accent-contrast, var(--color-accent-contrast));
}
</style>
