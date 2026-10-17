<script setup lang="ts">
import { ref, watch } from "vue";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import type { MailboxRule } from "./brief";

/** "How ME3 handles mail": the owner's plain-language rules, each removable. */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const { toastFromUnknown } = useAppToast();
const rules = ref<MailboxRule[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    rules.value = (await api.get<{ rules: MailboxRule[] }>("/mailbox/rules")).rules;
  } catch (error) {
    toastFromUnknown(error, "Rules could not be loaded");
  } finally {
    loading.value = false;
  }
}

async function remove(rule: MailboxRule) {
  rules.value = rules.value.filter((candidate) => candidate.id !== rule.id);
  try {
    await api.delete(`/mailbox/rules/${encodeURIComponent(rule.id)}`);
  } catch (error) {
    toastFromUnknown(error, "The rule could not be removed");
    await load();
  }
}

watch(() => props.open, (open) => { if (open) void load(); }, { immediate: true });
</script>

<template>
  <AppDialog :open="open" class="rules-modal" labelled-by="mail-rules-title" @close="emit('close')">
    <section class="rules-modal__card">
      <header class="rules-modal__head">
        <h2 id="mail-rules-title">How ME3 handles mail</h2>
        <Button color="ghost" shape="soft" size="compact" icon-only type="button" aria-label="Close" @click="emit('close')">
          <UiIcon name="X" :size="16" aria-hidden="true" />
        </Button>
      </header>
      <p class="rules-modal__intro">
        ME3 files receipts to Accounts, summarises newsletters, archives automated notifications and shows you the rest in the Brief. Your rules run first. Sends always need your OK.
      </p>
      <h3>Your rules</h3>
      <p v-if="loading && rules.length === 0" class="rules-modal__muted">Loading…</p>
      <p v-else-if="rules.length === 0" class="rules-modal__muted">
        No rules yet. Open a conversation and choose “Always archive this sender” from More.
      </p>
      <ul v-else class="rules-modal__list">
        <li v-for="rule in rules" :key="rule.id">
          <span class="rules-modal__rule">
            <strong>{{ rule.label }}</strong>
            <small>{{ rule.matchValue }}</small>
          </span>
          <button type="button" class="rules-modal__remove" @click="remove(rule)">Remove</button>
        </li>
      </ul>
    </section>
  </AppDialog>
</template>

<style scoped>
.rules-modal__card {
  width: min(100%, 480px);
  padding: 20px;
  border-radius: var(--ui-radius-lg, 16px);
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-md, 0 20px 60px rgba(17, 17, 17, 0.18));
}

.rules-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.rules-modal__head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
}

.rules-modal__intro,
.rules-modal__muted {
  margin: 12px 0 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ui-text-muted, var(--color-text-muted));
}

h3 {
  margin: 20px 0 6px;
  font-size: 13px;
  font-weight: 650;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.rules-modal__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.rules-modal__list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  border-top: 1px solid var(--ui-border, var(--color-border));
}

.rules-modal__rule {
  display: grid;
  min-width: 0;
}

.rules-modal__rule strong {
  font-weight: 500;
}

.rules-modal__rule small {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.rules-modal__remove {
  flex-shrink: 0;
  min-height: 36px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}

.rules-modal__remove:hover {
  color: var(--ui-danger, #db1f1f);
}
</style>
