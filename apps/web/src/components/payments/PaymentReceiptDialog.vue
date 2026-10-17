<script setup lang="ts">
import { useId } from "vue";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import PaymentReceiptPanel from "./PaymentReceiptPanel.vue";
import type { PaymentRecord } from "../../utils/agentPayments";

defineProps<{ paymentId: string | null }>();
const emit = defineEmits<{ close: []; changed: [payment: PaymentRecord] }>();
const headingId = useId();
</script>

<template>
  <AppDialog :open="Boolean(paymentId)" :labelled-by="headingId" close-on-backdrop @close="emit('close')">
    <div v-if="paymentId" class="payment-receipt-dialog">
      <Button class="payment-receipt-dialog__close" color="ghost" shape="soft" size="large" icon-only aria-label="Close payment" @click="emit('close')"><UiIcon name="X" :size="20" /></Button>
      <PaymentReceiptPanel :payment-id="paymentId" :heading-id="headingId" @changed="emit('changed', $event)" />
    </div>
  </AppDialog>
</template>

<style scoped>
.payment-receipt-dialog { position: relative; box-sizing: border-box; width: min(560px, 100%); max-height: min(88vh, 900px); overflow-y: auto; padding: 20px 20px 24px; border-radius: var(--ui-radius-lg); background: var(--ui-surface); box-shadow: var(--ui-shadow-md); }
.payment-receipt-dialog__close { position: absolute; top: 10px; right: 10px; }
.payment-receipt-dialog :deep(.payment-receipt__head) { padding-right: 44px; }
@media (max-width: 640px) { .payment-receipt-dialog { border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; padding: 18px; } }
</style>
