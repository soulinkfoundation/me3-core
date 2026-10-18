<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { useRouter } from "vue-router";
import { api } from "../../api";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { useAppToast } from "../../composables/useAppToast";
import {
  isFreshAuthenticationRequired, paymentApprovalView, paymentHandOver, paymentReauthLocation,
  type PaymentApprovalLike, type PaymentRecord,
} from "../../utils/agentPayments";

/**
 * Payment approval (agent.html, "Pay a deposit"). Shows the whole immutable proposal before
 * Approve. Approving needs a recent sign-in; when the server asks for one the owner signs in
 * again and approves themselves on return. Nothing here retries a decision automatically.
 */
const props = defineProps<{ approval: PaymentApprovalLike; returnedFromSignIn?: boolean; headingId?: string }>();
const emit = defineEmits<{ resolved: [decision: "approved" | "declined"]; receipt: [paymentId: string] }>();
const router = useRouter();
const { toastSuccess } = useAppToast();
const fallbackHeadingId = useId();
const titleId = computed(() => props.headingId || fallbackHeadingId);

const view = computed(() => paymentApprovalView(props.approval));
const step = ref<"review" | "reauth" | "handover" | "declined">("review");
const busy = ref<"" | "approved" | "declined">("");
const error = ref("");
const payment = ref<PaymentRecord | null>(null);
const handOver = computed(() => payment.value ? paymentHandOver(payment.value) : null);

async function decide(decision: "approved" | "declined") {
  const card = view.value;
  if (!card || busy.value) return;
  busy.value = decision; error.value = "";
  try {
    await api.post(`/assistant/approvals/${encodeURIComponent(card.approvalId)}`, { decision });
    if (decision === "declined") { step.value = "declined"; toastSuccess("Payment declined"); emit("resolved", decision); return; }
    // The server hands the purchase over exactly once; read it back rather than assuming.
    payment.value = (await api.get<{ payment: PaymentRecord }>(`/payments/${encodeURIComponent(card.proposalId)}`).catch(() => null))?.payment ?? null;
    step.value = "handover";
    emit("resolved", decision);
  } catch (caught) {
    if (decision === "approved" && isFreshAuthenticationRequired(caught)) { step.value = "reauth"; return; }
    error.value = caught instanceof Error ? caught.message : "Couldn't save this decision. Try again.";
  } finally { busy.value = ""; }
}

function signInAgain() {
  if (view.value) void router.push(paymentReauthLocation(view.value));
}
</script>

<template>
  <section v-if="view" class="pay-card" :aria-labelledby="titleId" data-testid="payment-approval">
    <template v-if="step === 'handover'">
      <div class="pay-card__head">
        <span class="pay-card__emoji" aria-hidden="true">💳</span>
        <span class="pay-card__stack"><h3 :id="titleId" class="pay-card__title">Now pay on your device</h3><span class="pay-card__sub">{{ view.total }} to {{ view.merchantName }} · approved</span></span>
      </div>
      <p class="pay-card__text">{{ handOver?.instructions ?? (view.network ? `${view.network.sellerName} couldn't start the checkout, so nothing was bought. ME3 will tell you what happened in Chat.` : `Open ${view.merchantName} on your own device and pay ${view.total}. ME3 does not charge you.`) }}</p>
      <p v-if="view.checkoutWarning" class="pay-card__warning" role="alert"><UiIcon name="CircleAlert" :size="16" />{{ view.checkoutWarning }}</p>
      <div class="pay-card__btns">
        <Button color="ghost" shape="soft" @click="emit('receipt', view.proposalId)">Receipt</Button>
        <Button v-if="handOver" class="pay-card__primary" color="primary" shape="soft" :href="handOver.openUrl" target="_blank" rel="noopener noreferrer"><UiIcon name="ExternalLink" :size="18" />Open checkout</Button>
      </div>
      <p class="pay-card__fine">{{ view.howItWorks }}</p>
    </template>

    <template v-else-if="step === 'declined'">
      <div class="pay-card__head">
        <span class="pay-card__emoji" aria-hidden="true">💳</span>
        <span class="pay-card__stack"><h3 :id="titleId" class="pay-card__title">Payment declined</h3><span class="pay-card__sub">{{ view.total }} to {{ view.merchantName }} · nothing was bought</span></span>
      </div>
    </template>

    <template v-else>
      <div class="pay-card__head">
        <span class="pay-card__emoji" aria-hidden="true">💳</span>
        <span class="pay-card__stack">
          <h3 :id="titleId" class="pay-card__title">Approve a payment</h3>
          <span class="pay-card__sub">To <a v-if="view.merchantHref" :href="view.merchantHref" target="_blank" rel="noopener noreferrer">{{ view.merchantName }}</a><template v-else>{{ view.merchantName }}</template><template v-if="view.merchantHost"> · {{ view.merchantHost }}</template></span>
        </span>
      </div>
      <div class="pay-card__stack">
        <span class="pay-card__amount">{{ view.total }}</span>
        <span v-if="view.refundPolicy" class="pay-card__sub">{{ view.refundPolicy }}</span>
      </div>

      <p v-if="view.network" class="pay-card__network"><UiIcon name="Shield" :size="16" />On the ME3 network · price and time checked live with {{ view.network.sellerName }}</p>
      <dl class="pay-card__facts">
        <div v-if="view.purpose"><dt>For</dt><dd>{{ view.purpose }}</dd></div>
        <div><dt>Items</dt><dd><span v-for="(item, index) in view.items" :key="index" class="pay-card__item">{{ item.quantity }} × {{ item.name }}<template v-if="item.options"> · {{ item.options }}</template></span></dd></div>
        <div><dt>Total</dt><dd>{{ view.amount }} {{ view.currency }}</dd></div>
        <div><dt>Refunds</dt><dd>{{ view.refundPolicy ?? "The merchant didn't show a refund policy." }}</dd></div>
        <div><dt>Checkout</dt><dd>
          <template v-if="view.network">{{ view.network.sellerName }}'s secure checkout, held for 15 minutes after you approve.</template>
          <a v-else-if="view.checkoutHref" :href="view.checkoutHref" target="_blank" rel="noopener noreferrer">{{ view.checkoutHref }}</a>
          <template v-else>You'll pay on {{ view.merchantName }}'s own site.</template>
        </dd></div>
        <div v-if="view.network"><dt>Shared</dt><dd>{{ view.network.sharesNotice }}<template v-if="view.network.sharesWith"><br><span class="pay-card__sub">{{ view.network.sharesWith }}</span></template></dd></div>
        <div v-if="view.remainingLimit"><dt>Your limit</dt><dd>{{ view.remainingLimit }}</dd></div>
      </dl>
      <p v-if="view.checkoutWarning" class="pay-card__warning" role="alert"><UiIcon name="CircleAlert" :size="16" />{{ view.checkoutWarning }}</p>
      <p class="pay-card__fine">{{ view.howItWorks }}</p>

      <div v-if="step === 'reauth'" class="pay-card__reauth" role="status">
        <UiIcon name="Lock" :size="18" />
        <span>For your safety, sign in again before approving a payment. You'll come back here to approve it yourself.</span>
      </div>
      <p v-else-if="returnedFromSignIn" class="pay-card__reauth" role="status"><UiIcon name="Check" :size="18" /><span>You're signed in again. Check the details, then approve.</span></p>
      <p v-if="error" class="pay-card__error" role="alert">{{ error }}</p>

      <div class="pay-card__btns">
        <Button color="ghost" shape="soft" :disabled="Boolean(busy)" @click="decide('declined')">{{ busy === 'declined' ? 'Declining…' : 'Decline' }}</Button>
        <Button v-if="step === 'reauth'" class="pay-card__primary" color="primary" shape="soft" @click="signInAgain">Sign in again</Button>
        <Button v-else class="pay-card__primary" color="primary" shape="soft" :disabled="Boolean(busy) || !view.pending" @click="decide('approved')">{{ busy === 'approved' ? 'Approving…' : `Approve ${view.total}` }}</Button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.pay-card { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; width: 100%; padding: 16px; border-radius: 20px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-sm); }
.pay-card__head { display: flex; align-items: center; gap: 12px; }
.pay-card__emoji { font-size: 26px; line-height: 1; }
.pay-card__stack { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pay-card__title { margin: 0; font-size: 16px; font-weight: 600; }
.pay-card__sub { color: var(--ui-text-muted); font-size: 14px; overflow-wrap: anywhere; }
.pay-card__amount { font-size: 34px; font-weight: 700; line-height: 1.1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.pay-card a { color: var(--ui-accent-strong, var(--ui-accent)); font-weight: 600; overflow-wrap: anywhere; }
.pay-card__facts { margin: 0; }
.pay-card__facts > div { display: grid; grid-template-columns: 96px 1fr; gap: 12px; padding: 9px 0; box-shadow: inset 0 1px 0 var(--ui-border); }
.pay-card__facts dt { color: var(--ui-text-muted); font-size: 13px; }
.pay-card__facts dd { margin: 0; font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; }
.pay-card__item { display: block; }
.pay-card__network { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--ui-text-muted); font-size: 13px; }
.pay-card__network :deep(svg) { flex: 0 0 auto; color: var(--ui-accent); }
.pay-card__text { margin: 0; font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
.pay-card__fine { margin: 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.45; }
.pay-card__warning { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 10px 12px; border-radius: var(--ui-radius-md); background: var(--ui-danger-soft, color-mix(in srgb, var(--ui-danger, #e5484d) 16%, transparent)); color: var(--ui-text); font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }
.pay-card__warning :deep(svg) { flex: 0 0 auto; margin-top: 2px; color: var(--ui-danger, #e5484d); }
.pay-card__reauth { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 10px 12px; border-radius: var(--ui-radius-md); background: var(--ui-accent-soft); color: var(--ui-text); font-size: 14px; line-height: 1.4; }
.pay-card__reauth :deep(svg) { flex: 0 0 auto; margin-top: 1px; color: var(--ui-accent); }
.pay-card__error { margin: 0; color: var(--ui-danger, #e5484d); font-weight: 600; font-size: 14px; }
.pay-card__btns { display: flex; gap: 8px; }
.pay-card__btns :deep(.me3-btn) { min-height: 44px; }
.pay-card__primary { flex: 1; }
.pay-card__primary :deep(svg), .pay-card__btns :deep(svg) { margin-right: 6px; }
@media (max-width: 420px) { .pay-card__facts > div { grid-template-columns: 1fr; gap: 2px; } }
</style>
