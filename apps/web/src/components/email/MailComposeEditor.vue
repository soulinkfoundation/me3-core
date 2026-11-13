<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import UiIcon from "../UiIcon.vue";
import {
  mailEditorHtmlToMarkdown,
  mailMarkdownToEditorHtml,
  pastedHtmlNeedsMarkdown,
} from "./mailComposeMarkdown";
import { looksLikeMailMarkdown } from "../../../../../shared/mail-markdown";

// Rich editor for compose. The body is stored as light Markdown so agent
// drafts, AI assist and the send path all share one format; pasting rich text
// (or Markdown) keeps bold, italics, lists and links.

const props = withDefaults(
  defineProps<{ modelValue: string; placeholder?: string; ariaLabel?: string }>(),
  { placeholder: "Write your message…", ariaLabel: "Message" },
);
const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();

let lastEmitted = props.modelValue;

const editor = useEditor({
  content: mailMarkdownToEditorHtml(props.modelValue),
  extensions: [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      heading: { levels: [2, 3] },
      strike: false,
      underline: false,
      link: false,
    }),
    Link.configure({
      openOnClick: false,
      autolink: false,
      defaultProtocol: "https",
      // Only linkify URLs that carry their own protocol, so pasted links such
      // as <a href="https://me3.app">me3.app</a> keep their real href.
      shouldAutoLink: (url) => /^(https?:\/\/|mailto:)/i.test(url),
    }),
    Placeholder.configure({ placeholder: () => props.placeholder }),
  ],
  editorProps: {
    attributes: {
      class: "mail-compose-editor__content",
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": props.ariaLabel,
    },
    handlePaste(_view, event) {
      const data = event.clipboardData;
      const text = data?.getData("text/plain") || "";
      const html = data?.getData("text/html") || "";
      if (!text || !looksLikeMailMarkdown(text)) return false;
      if (html && !pastedHtmlNeedsMarkdown(html)) return false;
      event.preventDefault();
      editor.value?.chain().focus().insertContent(mailMarkdownToEditorHtml(text)).run();
      return true;
    },
  },
  onUpdate: ({ editor: activeEditor }) => {
    lastEmitted = activeEditor.isEmpty ? "" : mailEditorHtmlToMarkdown(activeEditor.getHTML());
    emit("update:modelValue", lastEmitted);
  },
});

watch(
  () => props.modelValue,
  (value) => {
    if (!editor.value || value === lastEmitted) return;
    lastEmitted = value;
    editor.value.commands.setContent(mailMarkdownToEditorHtml(value), { emitUpdate: false });
  },
);

function editLink() {
  if (!editor.value) return;
  const current = editor.value.getAttributes("link").href || "";
  const href = window.prompt("Link URL", current);
  if (href === null) return;
  if (!href.trim()) {
    editor.value.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  editor.value.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
}

function focus() {
  editor.value?.commands.focus("end");
}

defineExpose({ focus });

onBeforeUnmount(() => editor.value?.destroy());
</script>

<template>
  <div class="mail-compose-editor">
    <EditorContent v-if="editor" :editor="editor" class="mail-compose-editor__scroll" />
    <div v-if="editor" class="mail-compose-editor__toolbar" role="toolbar" aria-label="Text formatting">
      <button type="button" :class="{ 'is-active': editor.isActive('bold') }" aria-label="Bold" title="Bold (⌘B)" @click="editor.chain().focus().toggleBold().run()">
        <UiIcon name="Bold" :size="16" aria-hidden="true" />
      </button>
      <button type="button" :class="{ 'is-active': editor.isActive('italic') }" aria-label="Italic" title="Italic (⌘I)" @click="editor.chain().focus().toggleItalic().run()">
        <UiIcon name="Italic" :size="16" aria-hidden="true" />
      </button>
      <span class="mail-compose-editor__divider" aria-hidden="true" />
      <button type="button" :class="{ 'is-active': editor.isActive('bulletList') }" aria-label="Bulleted list" title="Bulleted list" @click="editor.chain().focus().toggleBulletList().run()">
        <UiIcon name="List" :size="16" aria-hidden="true" />
      </button>
      <button type="button" :class="{ 'is-active': editor.isActive('orderedList') }" aria-label="Numbered list" title="Numbered list" @click="editor.chain().focus().toggleOrderedList().run()">
        <UiIcon name="ListOrdered" :size="16" aria-hidden="true" />
      </button>
      <button type="button" :class="{ 'is-active': editor.isActive('link') }" aria-label="Link" title="Link" @click="editLink">
        <UiIcon name="Link" :size="16" aria-hidden="true" />
      </button>
      <button type="button" :class="{ 'is-active': editor.isActive('blockquote') }" aria-label="Quote" title="Quote" @click="editor.chain().focus().toggleBlockquote().run()">
        <UiIcon name="TextQuote" :size="16" aria-hidden="true" />
      </button>
      <span class="mail-compose-editor__divider" aria-hidden="true" />
      <button type="button" aria-label="Clear formatting" title="Clear formatting" @click="editor.chain().focus().unsetAllMarks().clearNodes().run()">
        <UiIcon name="RemoveFormatting" :size="16" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.mail-compose-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.mail-compose-editor__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

:deep(.mail-compose-editor__content) {
  box-sizing: border-box;
  min-height: 100%;
  padding: 14px 2px;
  outline: none;
  color: var(--ui-text, var(--color-text));
  font-size: 15px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

:deep(.mail-compose-editor__content p) {
  margin: 0 0 12px;
}

:deep(.mail-compose-editor__content ul),
:deep(.mail-compose-editor__content ol) {
  margin: 0 0 12px;
  padding-left: 24px;
}

:deep(.mail-compose-editor__content li > p) {
  margin: 0 0 4px;
}

:deep(.mail-compose-editor__content blockquote) {
  margin: 0 0 12px;
  padding-left: 12px;
  border-left: 3px solid var(--ui-border, var(--color-border));
  color: var(--ui-text-muted, var(--color-text-muted));
}

:deep(.mail-compose-editor__content h2),
:deep(.mail-compose-editor__content h3) {
  margin: 16px 0 8px;
  line-height: 1.3;
}

:deep(.mail-compose-editor__content h2) { font-size: 19px; }
:deep(.mail-compose-editor__content h3) { font-size: 16px; }

:deep(.mail-compose-editor__content a) {
  color: var(--ui-accent, var(--color-accent));
}

:deep(.mail-compose-editor__content > :last-child) {
  margin-bottom: 0;
}

:deep(.mail-compose-editor__content p.is-editor-empty:first-child::before) {
  float: left;
  height: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  content: attr(data-placeholder);
  pointer-events: none;
}

.mail-compose-editor__toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 0 0;
  border-top: 1px solid var(--ui-border, var(--color-border));
}

.mail-compose-editor__toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
  cursor: pointer;
}

.mail-compose-editor__toolbar button:hover {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text, var(--color-text));
}

.mail-compose-editor__toolbar button.is-active {
  background: var(--ui-accent-soft, rgba(34, 152, 116, 0.14));
  color: var(--ui-accent-strong, var(--ui-accent, #229874));
}

.mail-compose-editor__toolbar button:focus-visible {
  outline: 2px solid var(--ui-accent, var(--color-accent));
  outline-offset: 1px;
}

.mail-compose-editor__divider {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--ui-border, var(--color-border));
}
</style>
