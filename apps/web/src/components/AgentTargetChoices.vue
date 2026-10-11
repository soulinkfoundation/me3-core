<script setup lang="ts">
import Button from "./Button.vue";
import { targetChoiceRequest, type AgentTargetPresentation } from "../utils/agentTargetChoices";
defineProps<{ presentation: AgentTargetPresentation; busy?: boolean }>();
const emit = defineEmits<{ choose: [candidateId: string] }>();
</script>

<template>
  <section class="target-choices" aria-label="Choose a record">
    <h3>{{ presentation.actionLabel }}</h3>
    <dl v-if="presentation.changes.length" class="target-fields">
      <template v-for="(field, index) in presentation.changes" :key="index">
        <dt>{{ field.label }}</dt><dd>{{ field.value }}</dd>
      </template>
    </dl>
    <p v-if="presentation.status === 'pending'">Choose the record to use for this change.</p>
    <p v-else role="status">{{ presentation.status === 'selected' ? 'Choice submitted.' : 'This choice is no longer available. Ask ME3 to show fresh choices.' }}</p>
    <ol class="target-records">
      <li v-for="candidate in presentation.candidates" :key="candidate.id">
        <strong>{{ candidate.option }}. {{ candidate.label }}</strong>
        <dl class="target-fields">
          <template v-for="(field, index) in candidate.fields" :key="index">
            <dt>{{ field.label }}</dt><dd>{{ field.value }}</dd>
          </template>
        </dl>
        <Button size="small" :disabled="busy || !targetChoiceRequest(presentation, candidate.id)"
          :aria-label="`Choose option ${candidate.option}: ${candidate.label}`"
          @click="emit('choose', candidate.id)">Choose {{ candidate.option }}</Button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.target-choices { margin-top: 1rem; color: var(--ui-text); }
h3 { font-size: 1rem; margin: 0 0 .5rem; }
p { font-size: .875rem; color: var(--ui-text-muted); }
.target-records { list-style: none; padding: 0; margin: .75rem 0 0; }
.target-records li { padding: .875rem 0; border-top: 1px solid var(--ui-border); }
.target-fields { display: grid; grid-template-columns: minmax(6rem, 1fr) 2fr; gap: .25rem .75rem; font-size: .875rem; }
dt { color: var(--ui-text-muted); } dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
