<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { storeToRefs } from "pinia";
import {
  useWizardStore,
  type WizardBookingConfig,
  type WizardBookingDuration,
  type WizardBookingOffer,
  type WizardBookingPricing,
  type WizardBookingType,
  type WizardClassOffer,
  type WizardPaymentMethod,
  type WizardRetreatOffer,
} from "../../stores/wizard";
import { useSitesStore } from "../../stores/sites";
import { useAuthStore } from "../../stores/auth";
import InlineRichTextEditor from "./BookingOfferDescriptionEditor.vue";
import PaymentCollectionFields from "./PaymentCollectionFields.vue";
import BookingAvailabilityEditor, {
  type BookingAvailability,
} from "../booking/BookingAvailabilityEditor.vue";
import TimezonePicker from "../booking/TimezonePicker.vue";
import UiIcon from "../UiIcon.vue";
import { useAppToast } from "../../composables/useAppToast";
import { getTimeZoneDisplayLabel, listSupportedTimeZones } from "../../utils/timezone";

const wizard = useWizardStore();
const sites = useSitesStore();
const auth = useAuthStore();
const { profile } = storeToRefs(wizard);
const { toastError, toastSuccess, toastFromUnknown } = useAppToast();

const activeBookingType = ref<WizardBookingType | null>(null);
const activeOfferId = ref<string | null>(null);
const activeClassOfferId = ref<string | null>(null);
const activeRetreatOfferId = ref<string | null>(null);
const showAddTypeMenu = ref(false);
const isSendingBookingConfirmationTest = ref(false);

const enabledBookingTypes = computed(() => {
  const types: Array<{ type: WizardBookingType; label: string }> = [];
  if (profile.value.booking.oneToOneEnabled) {
    types.push({ type: "one_to_one", label: "1:1" });
  }
  if (profile.value.booking.classEnabled) {
    types.push({ type: "class", label: "Classes" });
  }
  if (profile.value.booking.retreatEnabled) {
    types.push({ type: "retreat", label: "Retreats" });
  }
  return types;
});

const hasBookingTypes = computed(() => enabledBookingTypes.value.length > 0);
const bookingOffers = computed(() => profile.value.booking.offers);
const classOffers = computed(() => profile.value.booking.classOffers);
const retreatOffers = computed(() => profile.value.booking.retreatOffers);

function parseRetreatWallDateTime(
  date: string | undefined,
  time: string | undefined,
): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;

  const timestamp = Date.parse(`${date}T${time}:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function deriveRetreatDurationDays(offer: Partial<WizardRetreatOffer> | null) {
  const startMs = parseRetreatWallDateTime(offer?.startDate, offer?.startTime);
  const endMs = parseRetreatWallDateTime(offer?.endDate, offer?.endTime);

  if (startMs !== null && endMs !== null && endMs > startMs) {
    return Math.max(1, Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000)));
  }

  if (
    typeof offer?.durationDays === "number" &&
    Number.isFinite(offer.durationDays) &&
    offer.durationDays >= 1
  ) {
    return Math.round(offer.durationDays);
  }

  return 1;
}

watch(
  enabledBookingTypes,
  (types) => {
    if (!types.length) {
      activeBookingType.value = null;
      return;
    }
    if (
      !activeBookingType.value ||
      !types.some((t) => t.type === activeBookingType.value)
    ) {
      activeBookingType.value = types[0]?.type || null;
    }
  },
  { immediate: true },
);

watch(
  () => bookingOffers.value.map((offer) => offer.id),
  (offerIds) => {
    if (!activeOfferId.value || !offerIds.includes(activeOfferId.value)) {
      activeOfferId.value = offerIds[0] || null;
    }
  },
  { immediate: true },
);

watch(
  () => classOffers.value.map((offer) => offer.id),
  (offerIds) => {
    if (
      !activeClassOfferId.value ||
      !offerIds.includes(activeClassOfferId.value)
    ) {
      activeClassOfferId.value = offerIds[0] || null;
    }
  },
  { immediate: true },
);

watch(
  () => retreatOffers.value.map((offer) => offer.id),
  (offerIds) => {
    if (
      !activeRetreatOfferId.value ||
      !offerIds.includes(activeRetreatOfferId.value)
    ) {
      activeRetreatOfferId.value = offerIds[0] || null;
    }
  },
  { immediate: true },
);

const bookingHeadingTitle = computed({
  get: () => profile.value.booking.title || "",
  set: (val: string) => wizard.setBooking({ title: val }),
});

const bookingHeadingDescription = computed({
  get: () => profile.value.booking.description || "",
  set: (val: string) => wizard.setBooking({ description: val }),
});

function offerDescriptionText(value?: string): string {
  return (value || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>\s*<p(?:\s[^>]*)?>/gi, "\n")
    .replace(/<\/?(?:p|div)(?:\s[^>]*)?>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

const bookingBufferTime = computed({
  get: () => profile.value.booking.bufferTime,
  set: (val: WizardBookingConfig["bufferTime"]) =>
    wizard.setBooking({ bufferTime: val }),
});

const bookingTimezone = computed({
  get: () => profile.value.booking.timezone,
  set: (val: string) => wizard.setBooking({ timezone: val }),
});

const bookingAvailability = computed({
  get: () => profile.value.booking.availability as BookingAvailability,
  set: (availability: BookingAvailability) =>
    wizard.setBooking({
      availability: {
        ...profile.value.booking.availability,
        ...availability,
      },
    }),
});

const activeOffer = computed(() => {
  if (!activeOfferId.value) return bookingOffers.value[0] || null;
  return (
    bookingOffers.value.find((offer) => offer.id === activeOfferId.value) ||
    bookingOffers.value[0] ||
    null
  );
});

function updateActiveOffer(updates: Partial<WizardBookingOffer>) {
  if (!activeOffer.value) return;
  wizard.updateBookingOffer(activeOffer.value.id, updates);
}

const activeOfferTitle = computed({
  get: () => activeOffer.value?.title || "",
  set: (val: string) => updateActiveOffer({ title: val }),
});

const activeOfferDescription = computed({
  get: () => offerDescriptionText(activeOffer.value?.description),
  set: (val: string) => updateActiveOffer({ description: val }),
});

const activeOfferDuration = computed({
  get: () => activeOffer.value?.duration || 30,
  set: (val: WizardBookingDuration) => updateActiveOffer({ duration: val }),
});

const activeOfferPriceMode = computed({
  get: () => (activeOffer.value?.pricing?.enabled ? "paid" : "free"),
  set: (val: "free" | "paid") => {
    if (!activeOffer.value) return;
    if (val === "free") {
      wizard.setBookingOfferPricing(activeOffer.value.id, null);
      return;
    }
    wizard.setBookingOfferPricing(activeOffer.value.id, {
      enabled: true,
      suggestedAmount: activeOffer.value.pricing?.suggestedAmount ?? 50,
      currency: activeOffer.value.pricing?.currency ?? "USD",
      minimumAmount: 5,
      allowFree: false,
    });
  },
});

const activeOfferPriceAmount = computed({
  get: () => activeOffer.value?.pricing?.suggestedAmount ?? 50,
  set: (val: number) => {
    if (!activeOffer.value) return;
    wizard.setBookingOfferPricing(activeOffer.value.id, {
      suggestedAmount: Math.max(5, val),
    });
  },
});

const activeOfferPriceCurrency = computed({
  get: () => activeOffer.value?.pricing?.currency ?? "USD",
  set: (val: WizardBookingPricing["currency"]) => {
    if (!activeOffer.value) return;
    wizard.setBookingOfferPricing(activeOffer.value.id, { currency: val });
  },
});

const activeOfferPaymentMethod = computed({
  get: () => activeOffer.value?.pricing?.paymentMethod ?? "stripe",
  set: (val: WizardPaymentMethod) => {
    if (!activeOffer.value) return;
    wizard.setBookingOfferPricing(activeOffer.value.id, { paymentMethod: val });
  },
});

const activeOfferPaymentInstructions = computed({
  get: () => activeOffer.value?.pricing?.paymentInstructions ?? "",
  set: (val: string) => {
    if (!activeOffer.value) return;
    wizard.setBookingOfferPricing(activeOffer.value.id, {
      paymentInstructions: val,
    });
  },
});

const activeClassOffer = computed(() => {
  if (!activeClassOfferId.value) return classOffers.value[0] || null;
  return (
    classOffers.value.find((offer) => offer.id === activeClassOfferId.value) ||
    classOffers.value[0] ||
    null
  );
});

function updateActiveClassOffer(updates: Partial<WizardClassOffer>) {
  if (!activeClassOffer.value) return;
  wizard.updateClassOffer(activeClassOffer.value.id, updates);
}

const activeClassOfferTitle = computed({
  get: () => activeClassOffer.value?.title || "",
  set: (val: string) => updateActiveClassOffer({ title: val }),
});

const activeClassOfferDescription = computed({
  get: () => offerDescriptionText(activeClassOffer.value?.description),
  set: (val: string) => updateActiveClassOffer({ description: val }),
});

const activeClassOfferDuration = computed({
  get: () => activeClassOffer.value?.duration || 60,
  set: (val: WizardBookingDuration) =>
    updateActiveClassOffer({ duration: val }),
});

const activeClassOfferTimezone = computed({
  get: () =>
    activeClassOffer.value?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC",
  set: (val: string) => updateActiveClassOffer({ timezone: val }),
});

const activeClassOfferFrequency = computed({
  get: () => activeClassOffer.value?.recurrence.frequency || "weekly",
  set: (val: "weekly" | "biweekly") =>
    updateActiveClassOffer({
      recurrence: {
        ...(activeClassOffer.value?.recurrence || {
          weekday: "monday",
          startTime: "18:00",
          startDate: "",
        }),
        frequency: val,
      },
    }),
});

const activeClassOfferWeekday = computed({
  get: () => activeClassOffer.value?.recurrence.weekday || "monday",
  set: (val: WizardClassOffer["recurrence"]["weekday"]) =>
    updateActiveClassOffer({
      recurrence: {
        ...(activeClassOffer.value?.recurrence || {
          frequency: "weekly",
          startTime: "18:00",
          startDate: "",
        }),
        weekday: val,
      },
    }),
});

const activeClassOfferStartTime = computed({
  get: () => activeClassOffer.value?.recurrence.startTime || "18:00",
  set: (val: string) =>
    updateActiveClassOffer({
      recurrence: {
        ...(activeClassOffer.value?.recurrence || {
          frequency: "weekly",
          weekday: "monday",
          startDate: "",
        }),
        startTime: val,
      },
    }),
});

const activeClassOfferStartDate = computed({
  get: () => activeClassOffer.value?.recurrence.startDate || "",
  set: (val: string) =>
    updateActiveClassOffer({
      recurrence: {
        ...(activeClassOffer.value?.recurrence || {
          frequency: "weekly",
          weekday: "monday",
          startTime: "18:00",
          startDate: "",
        }),
        startDate: val,
      },
    }),
});

const activeClassOfferPriceMode = computed({
  get: () => (activeClassOffer.value?.pricing?.enabled ? "paid" : "free"),
  set: (val: "free" | "paid") => {
    if (!activeClassOffer.value) return;
    if (val === "free") {
      wizard.setClassOfferPricing(activeClassOffer.value.id, null);
      return;
    }
    wizard.setClassOfferPricing(activeClassOffer.value.id, {
      enabled: true,
      suggestedAmount: activeClassOffer.value.pricing?.suggestedAmount ?? 25,
      currency: activeClassOffer.value.pricing?.currency ?? "USD",
      minimumAmount: 5,
      allowFree: false,
    });
  },
});

const activeClassOfferPriceAmount = computed({
  get: () => activeClassOffer.value?.pricing?.suggestedAmount ?? 25,
  set: (val: number) => {
    if (!activeClassOffer.value) return;
    wizard.setClassOfferPricing(activeClassOffer.value.id, {
      suggestedAmount: Math.max(5, val),
    });
  },
});

const activeClassOfferPriceCurrency = computed({
  get: () => activeClassOffer.value?.pricing?.currency ?? "USD",
  set: (val: WizardBookingPricing["currency"]) => {
    if (!activeClassOffer.value) return;
    wizard.setClassOfferPricing(activeClassOffer.value.id, { currency: val });
  },
});

const activeClassOfferPaymentMethod = computed({
  get: () => activeClassOffer.value?.pricing?.paymentMethod ?? "stripe",
  set: (val: WizardPaymentMethod) => {
    if (!activeClassOffer.value) return;
    wizard.setClassOfferPricing(activeClassOffer.value.id, {
      paymentMethod: val,
    });
  },
});

const activeClassOfferPaymentInstructions = computed({
  get: () => activeClassOffer.value?.pricing?.paymentInstructions ?? "",
  set: (val: string) => {
    if (!activeClassOffer.value) return;
    wizard.setClassOfferPricing(activeClassOffer.value.id, {
      paymentInstructions: val,
    });
  },
});

const activeClassCapacityEnabled = computed({
  get: () => activeClassOffer.value?.capacity !== null,
  set: (val: boolean) => {
    if (!activeClassOffer.value) return;
    updateActiveClassOffer({
      capacity: val ? activeClassOffer.value.capacity || 12 : null,
    });
  },
});

const activeClassCapacity = computed({
  get: () => activeClassOffer.value?.capacity ?? 12,
  set: (val: number) => {
    if (!activeClassOffer.value) return;
    updateActiveClassOffer({ capacity: Math.max(1, Math.round(val || 1)) });
  },
});

const activeRetreatOffer = computed(() => {
  if (!activeRetreatOfferId.value) return retreatOffers.value[0] || null;
  return (
    retreatOffers.value.find(
      (offer) => offer.id === activeRetreatOfferId.value,
    ) ||
    retreatOffers.value[0] ||
    null
  );
});

function updateActiveRetreatOffer(updates: Partial<WizardRetreatOffer>) {
  if (!activeRetreatOffer.value) return;
  wizard.updateRetreatOffer(activeRetreatOffer.value.id, updates);
}

const activeRetreatOfferTitle = computed({
  get: () => activeRetreatOffer.value?.title || "",
  set: (val: string) => updateActiveRetreatOffer({ title: val }),
});

const activeRetreatOfferDescription = computed({
  get: () => offerDescriptionText(activeRetreatOffer.value?.description),
  set: (val: string) => updateActiveRetreatOffer({ description: val }),
});

const activeRetreatDurationDays = computed({
  get: () => deriveRetreatDurationDays(activeRetreatOffer.value),
  set: () => {},
});

const activeRetreatStartDate = computed({
  get: () => activeRetreatOffer.value?.startDate || "",
  set: (val: string) => updateActiveRetreatOffer({ startDate: val }),
});

const activeRetreatStartTime = computed({
  get: () => activeRetreatOffer.value?.startTime || "09:00",
  set: (val: string) => updateActiveRetreatOffer({ startTime: val }),
});

const activeRetreatEndDate = computed({
  get: () => activeRetreatOffer.value?.endDate || "",
  set: (val: string) => updateActiveRetreatOffer({ endDate: val }),
});

const activeRetreatEndTime = computed({
  get: () => activeRetreatOffer.value?.endTime || "17:00",
  set: (val: string) => updateActiveRetreatOffer({ endTime: val }),
});

const activeRetreatOfferTimezone = computed({
  get: () =>
    activeRetreatOffer.value?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC",
  set: (val: string) => updateActiveRetreatOffer({ timezone: val }),
});

const activeRetreatOfferPriceMode = computed({
  get: () => (activeRetreatOffer.value?.pricing?.enabled ? "paid" : "free"),
  set: (val: "free" | "paid") => {
    if (!activeRetreatOffer.value) return;
    if (val === "free") {
      wizard.setRetreatOfferPricing(activeRetreatOffer.value.id, null);
      return;
    }
    wizard.setRetreatOfferPricing(activeRetreatOffer.value.id, {
      enabled: true,
      suggestedAmount: activeRetreatOffer.value.pricing?.suggestedAmount ?? 25,
      currency: activeRetreatOffer.value.pricing?.currency ?? "USD",
      minimumAmount: 5,
      allowFree: false,
    });
  },
});

const activeRetreatOfferPriceAmount = computed({
  get: () => activeRetreatOffer.value?.pricing?.suggestedAmount ?? 25,
  set: (val: number) => {
    if (!activeRetreatOffer.value) return;
    wizard.setRetreatOfferPricing(activeRetreatOffer.value.id, {
      suggestedAmount: Math.max(5, val),
    });
  },
});

const activeRetreatOfferPriceCurrency = computed({
  get: () => activeRetreatOffer.value?.pricing?.currency ?? "USD",
  set: (val: WizardBookingPricing["currency"]) => {
    if (!activeRetreatOffer.value) return;
    wizard.setRetreatOfferPricing(activeRetreatOffer.value.id, {
      currency: val,
    });
  },
});

const activeRetreatOfferPaymentMethod = computed({
  get: () => activeRetreatOffer.value?.pricing?.paymentMethod ?? "stripe",
  set: (val: WizardPaymentMethod) => {
    if (!activeRetreatOffer.value) return;
    wizard.setRetreatOfferPricing(activeRetreatOffer.value.id, {
      paymentMethod: val,
    });
  },
});

const activeRetreatOfferPaymentInstructions = computed({
  get: () => activeRetreatOffer.value?.pricing?.paymentInstructions ?? "",
  set: (val: string) => {
    if (!activeRetreatOffer.value) return;
    wizard.setRetreatOfferPricing(activeRetreatOffer.value.id, {
      paymentInstructions: val,
    });
  },
});

const activeRetreatCapacityEnabled = computed({
  get: () => activeRetreatOffer.value?.capacity !== null,
  set: (val: boolean) => {
    if (!activeRetreatOffer.value) return;
    updateActiveRetreatOffer({
      capacity: val ? activeRetreatOffer.value.capacity || 12 : null,
    });
  },
});

const activeRetreatCapacity = computed({
  get: () => activeRetreatOffer.value?.capacity ?? 12,
  set: (val: number) => {
    if (!activeRetreatOffer.value) return;
    updateActiveRetreatOffer({ capacity: Math.max(1, Math.round(val || 1)) });
  },
});

const bookingTypeOptions = computed(() => [
  {
    type: "one_to_one" as const,
    label: "1:1",
    enabled: profile.value.booking.oneToOneEnabled,
  },
  {
    type: "class" as const,
    label: "Class",
    enabled: profile.value.booking.classEnabled,
  },
  {
    type: "retreat" as const,
    label: "Retreat",
    enabled: profile.value.booking.retreatEnabled,
  },
]);

const availableBookingTypeOptions = computed(() =>
  bookingTypeOptions.value.filter((option) => !option.enabled),
);

const weekdayOptions = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
] as const;

const timezones = listSupportedTimeZones().map((value) => ({
  value,
  label: getTimeZoneDisplayLabel(value),
}));

function formatTimezoneLabel(timezone: string): string {
  return getTimeZoneDisplayLabel(timezone);
}

const timezoneOptions = computed(() => {
  const seen = new Set<string>();
  const options = [...timezones];
  const currentValues = [
    profile.value.booking.timezone,
    ...profile.value.booking.classOffers.map((offer) => offer.timezone),
    ...profile.value.booking.retreatOffers.map((offer) => offer.timezone),
  ].filter((value): value is string => Boolean(value));

  for (const value of currentValues) {
    if (seen.has(value) || options.some((option) => option.value === value))
      continue;
    seen.add(value);
    options.unshift({ value, label: formatTimezoneLabel(value) });
  }

  return options;
});

const bookingConfirmationTestInbox = computed(
  () => auth.user?.email?.trim() || "",
);
const bookingConfirmationTestRecipient = ref("");

watch(
  bookingConfirmationTestInbox,
  (email) => {
    if (!bookingConfirmationTestRecipient.value) {
      bookingConfirmationTestRecipient.value = email;
    }
  },
  { immediate: true },
);

const normalizedBookingConfirmationTestRecipient = computed(() =>
  bookingConfirmationTestRecipient.value.trim().toLowerCase(),
);
const bookingConfirmationTestRecipientIsValid = computed(() =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    normalizedBookingConfirmationTestRecipient.value,
  ),
);

const bookingConfirmationTestUsername = computed(() => wizard.username.trim());

const bookingConfirmationTestDetails = computed(() => {
  if (activeBookingType.value === "class" && activeClassOffer.value) {
    return {
      title: activeClassOffer.value.title || "Class booking",
      durationMinutes: activeClassOffer.value.duration || 60,
      timezone: activeClassOffer.value.timezone || bookingTimezone.value,
      pricing: activeClassOffer.value.pricing,
    };
  }
  if (activeBookingType.value === "retreat" && activeRetreatOffer.value) {
    return {
      title: activeRetreatOffer.value.title || "Retreat booking",
      durationMinutes: activeRetreatDurationDays.value * 24 * 60,
      timezone: activeRetreatOffer.value.timezone || bookingTimezone.value,
      pricing: activeRetreatOffer.value.pricing,
    };
  }
  return {
    title: activeOffer.value?.title || "Book a session",
    durationMinutes: activeOffer.value?.duration || 60,
    timezone: bookingTimezone.value,
    pricing: activeOffer.value?.pricing,
  };
});

const bookingConfirmationMessage = computed({
  get: () => profile.value.booking.confirmationEmail.message,
  set: (message: string) =>
    wizard.setBooking({
      confirmationEmail: {
        ...profile.value.booking.confirmationEmail,
        message,
      },
    }),
});

const bookingConfirmationSendHostCopy = computed({
  get: () => profile.value.booking.confirmationEmail.sendHostCopy !== false,
  set: (sendHostCopy: boolean) =>
    wizard.setBooking({
      confirmationEmail: {
        ...profile.value.booking.confirmationEmail,
        sendHostCopy,
      },
    }),
});

const bookingConfirmationTestTokenPreview = computed(() => ({
  guestName: "Test Guest",
  bookingTitle: bookingConfirmationTestDetails.value.title,
}));

const canSendBookingConfirmationTest = computed(
  () =>
    Boolean(bookingConfirmationTestInbox.value) &&
    Boolean(bookingConfirmationTestUsername.value) &&
    bookingConfirmationTestRecipientIsValid.value &&
    hasBookingTypes.value,
);

async function sendBookingConfirmationTest() {
  if (isSendingBookingConfirmationTest.value) return;

  const siteUsername = bookingConfirmationTestUsername.value;
  if (!siteUsername) {
    toastError("Claim your username before sending a test email.");
    return;
  }
  if (!bookingConfirmationTestInbox.value) {
    toastError("Sign in to send a test email.");
    return;
  }
  if (!bookingConfirmationTestRecipientIsValid.value) {
    toastError("Enter a valid test recipient email address.");
    return;
  }

  isSendingBookingConfirmationTest.value = true;
  try {
    const details = bookingConfirmationTestDetails.value;
    const response = await sites.sendBookingConfirmationTest(siteUsername, {
      to: normalizedBookingConfirmationTestRecipient.value,
      bookingTitle: details.title,
      durationMinutes: details.durationMinutes,
      timezone: details.timezone,
      siteName: profile.value.name || siteUsername,
      message: bookingConfirmationMessage.value,
      paymentMethod: details.pricing?.paymentMethod,
      amountDue: details.pricing?.suggestedAmount,
      currency: details.pricing?.currency,
      paymentInstructions: details.pricing?.paymentInstructions,
    });
    toastSuccess(`Test email sent to ${response.sentTo}.`);
  } catch (error) {
    toastFromUnknown(error, "Failed to send test email");
  } finally {
    isSendingBookingConfirmationTest.value = false;
  }
}

function selectBookingType(type: WizardBookingType) {
  activeBookingType.value = type;
  showAddTypeMenu.value = false;
}

function enableBookingType(type: WizardBookingType) {
  wizard.enableBookingType(type);
  activeBookingType.value = type;
  showAddTypeMenu.value = false;
}

function disableBookingType(type: WizardBookingType) {
  wizard.disableBookingType(type);
}

function addOffer() {
  const newOfferId = wizard.addBookingOffer();
  activeOfferId.value = newOfferId;
}

function removeOffer(offerId: string) {
  wizard.removeBookingOffer(offerId);
}

function addClassOffer() {
  const newOfferId = wizard.addClassOffer();
  activeClassOfferId.value = newOfferId;
}

function removeClassOffer(offerId: string) {
  wizard.removeClassOffer(offerId);
}

function addRetreatOffer() {
  const newOfferId = wizard.addRetreatOffer();
  activeRetreatOfferId.value = newOfferId;
}

function removeRetreatOffer(offerId: string) {
  wizard.removeRetreatOffer(offerId);
}

const TAB_LABEL_MAX = 12;

function compactTabLabel(
  input: { title?: string | null },
  fallback: string,
): string {
  const value = input.title?.trim();
  if (!value) return fallback;
  return value.length > TAB_LABEL_MAX
    ? `${value.slice(0, TAB_LABEL_MAX - 1)}…`
    : value;
}

onMounted(() => {
  wizard.setBooking({ enabled: true });
});
</script>

<template>
  <div class="step-bookings">
    <h2>Accept Bookings</h2>
    <p class="section-desc">
      Add the kinds of bookings you want to offer, then configure each one with
      the simplest setup that fits.
    </p>

    <div class="config-fields">
      <div class="section-heading">
        <label class="section-label">Booking types</label>
        <div class="type-actions">
          <div class="add-type-menu-wrap">
            <button
              type="button"
              class="offer-tab-add"
              @click="showAddTypeMenu = !showAddTypeMenu"
            >
              <UiIcon name="Plus" :size="18" aria-hidden="true" />
              <span>Add</span>
            </button>

            <div v-if="showAddTypeMenu" class="type-dropdown">
              <button
                v-for="option in availableBookingTypeOptions"
                :key="option.type"
                type="button"
                class="type-dropdown-item"
                @click="enableBookingType(option.type)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!hasBookingTypes" class="empty-bookings-state">
        <p class="empty-bookings-title">No booking types yet</p>
        <p class="empty-bookings-copy">
          Use the + Add button to add a new booking type.
        </p>
      </div>

      <template v-else>
        <div class="booking-heading-fields">
          <div class="form-group">
            <label for="booking-heading-title">Booking section title</label>
            <input
              id="booking-heading-title"
              v-model="bookingHeadingTitle"
              type="text"
              placeholder="e.g. Book a session"
              maxlength="100"
            />
          </div>
          <div class="form-group">
            <label for="booking-heading-description">Short intro</label>
            <InlineRichTextEditor
              v-model="bookingHeadingDescription"
              input-id="booking-heading-description"
              :max-characters="300"
              placeholder="Help people understand what these sessions are for"
            />
          </div>
        </div>

        <div
          class="booking-type-tabs"
          role="tablist"
          aria-label="Booking types"
        >
          <div
            v-for="item in enabledBookingTypes"
            :key="item.type"
            class="offer-tab-item"
            :class="{ active: item.type === activeBookingType }"
          >
            <button
              type="button"
              class="offer-tab"
              :aria-selected="item.type === activeBookingType"
              @click="selectBookingType(item.type)"
            >
              {{ item.label }}
            </button>
            <button
              type="button"
              class="offer-tab-remove"
              :aria-label="`Remove ${item.label}`"
              @click.stop.prevent="disableBookingType(item.type)"
            >
              <UiIcon name="X" :size="14" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div
          v-if="activeBookingType === 'one_to_one'"
          class="booking-type-panel"
        >
          <div class="offer-editor-card">
            <div class="section-heading">
              <label class="section-label">1:1 offers</label>
            </div>
            <div class="offer-tabs-bar">
              <div class="offer-tablist" role="tablist" aria-label="1:1 offers">
                <div
                  v-for="(offer, index) in bookingOffers"
                  :key="offer.id"
                  class="offer-tab-item"
                  :class="{ active: offer.id === activeOfferId }"
                >
                  <button
                    type="button"
                    class="offer-tab"
                    :aria-selected="offer.id === activeOfferId"
                    @click="activeOfferId = offer.id"
                  >
                    {{ compactTabLabel(offer, `Offer ${index + 1}`) }}
                  </button>
                  <button
                    v-if="bookingOffers.length > 1"
                    type="button"
                    class="offer-tab-remove"
                    aria-label="Remove this offer"
                    @click.stop.prevent="removeOffer(offer.id)"
                  >
                    <UiIcon name="X" :size="14" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <button
                type="button"
                class="offer-tab-add"
                @click.prevent.stop="addOffer"
              >
                <UiIcon name="Plus" :size="18" aria-hidden="true" />
                <span>Add offer</span>
              </button>
            </div>

            <div v-if="activeOffer" class="offer-tab-panel-body">
              <div class="form-row offer-primary-row">
                <div class="form-group offer-title-field">
                  <label :for="`booking-offer-title-${activeOffer.id}`"
                    >Title</label
                  >
                  <input
                    :id="`booking-offer-title-${activeOffer.id}`"
                    v-model="activeOfferTitle"
                    type="text"
                    maxlength="100"
                    placeholder="e.g. 60-min private session"
                  />
                </div>

                <div class="form-group offer-duration-field">
                  <label :for="`booking-offer-duration-${activeOffer.id}`"
                    >Duration</label
                  >
                  <select
                    :id="`booking-offer-duration-${activeOffer.id}`"
                    v-model="activeOfferDuration"
                  >
                    <option :value="15">15 minutes</option>
                    <option :value="30">30 minutes</option>
                    <option :value="45">45 minutes</option>
                    <option :value="60">60 minutes</option>
                    <option :value="75">75 minutes</option>
                    <option :value="90">90 minutes</option>
                    <option :value="120">120 minutes</option>
                  </select>
                </div>

                <div class="form-group offer-price-field">
                  <label class="offer-price-field-label">Price</label>
                  <div class="offer-price-btns">
                    <button
                      type="button"
                      class="offer-price-btn"
                      :class="{ active: activeOfferPriceMode === 'free' }"
                      @click="activeOfferPriceMode = 'free'"
                    >
                      Free
                    </button>
                    <button
                      type="button"
                      class="offer-price-btn"
                      :class="{ active: activeOfferPriceMode === 'paid' }"
                      @click="activeOfferPriceMode = 'paid'"
                    >
                      Paid
                    </button>
                  </div>
                </div>
              </div>

              <div class="form-group">
                <label :for="`booking-offer-description-${activeOffer.id}`">
                  Description
                </label>
                <textarea
                  :id="`booking-offer-description-${activeOffer.id}`"
                  v-model="activeOfferDescription"
                  rows="3"
                  placeholder="Briefly describe what this session includes"
                />
              </div>

              <div
                v-if="activeOfferPriceMode === 'paid'"
                class="pricing-editor"
              >
                <div class="form-row">
                  <div class="form-group">
                    <label :for="`booking-offer-price-${activeOffer.id}`"
                      >Price</label
                    >
                    <input
                      :id="`booking-offer-price-${activeOffer.id}`"
                      v-model.number="activeOfferPriceAmount"
                      type="number"
                      min="5"
                      step="1"
                    />
                  </div>
                  <div class="form-group">
                    <label :for="`booking-offer-currency-${activeOffer.id}`">
                      Currency
                    </label>
                    <select
                      :id="`booking-offer-currency-${activeOffer.id}`"
                      v-model="activeOfferPriceCurrency"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="CAD">CAD (C$)</option>
                      <option value="AUD">AUD (A$)</option>
                      <option value="CHF">CHF (Fr.)</option>
                      <option value="SGD">SGD (S$)</option>
                      <option value="INR">INR (₹)</option>
                      <option value="PKR">PKR (Rs)</option>
                    </select>
                  </div>
                </div>
                <PaymentCollectionFields
                  v-model="activeOfferPaymentMethod"
                  v-model:instructions="activeOfferPaymentInstructions"
                  :input-id="`booking-offer-${activeOffer.id}`"
                />
              </div>
            </div>
          </div>

          <!-- Weekly windows apply to 1:1 only; classes use each class’s day & start time. -->
          <BookingAvailabilityEditor
            v-model:availability="bookingAvailability"
            v-model:buffer-time="bookingBufferTime"
            v-model:timezone="bookingTimezone"
            :timezone-options="timezoneOptions"
            description="When you’re open for private sessions. This does not apply to classes or retreats — each has its own schedule in its tab."
          />
        </div>

        <div
          v-else-if="activeBookingType === 'class'"
          class="booking-type-panel"
        >
          <div class="offer-editor-card">
            <div class="section-heading">
              <label class="section-label">Classes</label>
            </div>
            <div class="offer-tabs-bar">
              <div class="offer-tablist" role="tablist" aria-label="Classes">
                <div
                  v-for="(offer, index) in classOffers"
                  :key="offer.id"
                  class="offer-tab-item"
                  :class="{ active: offer.id === activeClassOfferId }"
                >
                  <button
                    type="button"
                    class="offer-tab"
                    :aria-selected="offer.id === activeClassOfferId"
                    @click="activeClassOfferId = offer.id"
                  >
                    {{ compactTabLabel(offer, `Class ${index + 1}`) }}
                  </button>
                  <button
                    v-if="classOffers.length > 1"
                    type="button"
                    class="offer-tab-remove"
                    aria-label="Remove this class"
                    @click.stop.prevent="removeClassOffer(offer.id)"
                  >
                    <UiIcon name="X" :size="14" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <button
                type="button"
                class="offer-tab-add"
                @click.prevent.stop="addClassOffer"
              >
                <UiIcon name="Plus" :size="18" aria-hidden="true" />
                <span>Add class</span>
              </button>
            </div>

            <div v-if="activeClassOffer" class="offer-tab-panel-body">
              <div class="form-row offer-primary-row">
                <div class="form-group offer-title-field">
                  <label :for="`class-offer-title-${activeClassOffer.id}`"
                    >Title</label
                  >
                  <input
                    :id="`class-offer-title-${activeClassOffer.id}`"
                    v-model="activeClassOfferTitle"
                    type="text"
                    maxlength="100"
                    placeholder="e.g. Tuesday Evening Yoga"
                  />
                </div>

                <div class="form-group offer-duration-field">
                  <label :for="`class-offer-duration-${activeClassOffer.id}`">
                    Duration
                  </label>
                  <select
                    :id="`class-offer-duration-${activeClassOffer.id}`"
                    v-model="activeClassOfferDuration"
                  >
                    <option :value="15">15 minutes</option>
                    <option :value="30">30 minutes</option>
                    <option :value="45">45 minutes</option>
                    <option :value="60">60 minutes</option>
                    <option :value="75">75 minutes</option>
                    <option :value="90">90 minutes</option>
                    <option :value="120">120 minutes</option>
                  </select>
                </div>

                <div class="form-group offer-price-field">
                  <label class="offer-price-field-label">Price</label>
                  <div class="offer-price-btns">
                    <button
                      type="button"
                      class="offer-price-btn"
                      :class="{ active: activeClassOfferPriceMode === 'free' }"
                      @click="activeClassOfferPriceMode = 'free'"
                    >
                      Free
                    </button>
                    <button
                      type="button"
                      class="offer-price-btn"
                      :class="{ active: activeClassOfferPriceMode === 'paid' }"
                      @click="activeClassOfferPriceMode = 'paid'"
                    >
                      Paid
                    </button>
                  </div>
                </div>
              </div>

              <div class="form-group">
                <label :for="`class-offer-description-${activeClassOffer.id}`">
                  Description
                </label>
                <textarea
                  :id="`class-offer-description-${activeClassOffer.id}`"
                  v-model="activeClassOfferDescription"
                  rows="3"
                  placeholder="Briefly describe what this class includes"
                />
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label :for="`class-offer-weekday-${activeClassOffer.id}`">
                    Day
                  </label>
                  <select
                    :id="`class-offer-weekday-${activeClassOffer.id}`"
                    v-model="activeClassOfferWeekday"
                  >
                    <option
                      v-for="weekday in weekdayOptions"
                      :key="weekday.value"
                      :value="weekday.value"
                    >
                      {{ weekday.label }}
                    </option>
                  </select>
                </div>

                <div class="form-group">
                  <label :for="`class-offer-start-time-${activeClassOffer.id}`">
                    Starts at
                  </label>
                  <input
                    :id="`class-offer-start-time-${activeClassOffer.id}`"
                    v-model="activeClassOfferStartTime"
                    type="time"
                  />
                </div>

                <div class="form-group">
                  <label :for="`class-offer-frequency-${activeClassOffer.id}`">
                    Repeats
                  </label>
                  <select
                    :id="`class-offer-frequency-${activeClassOffer.id}`"
                    v-model="activeClassOfferFrequency"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 weeks</option>
                  </select>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label :for="`class-offer-start-date-${activeClassOffer.id}`">
                    First session date <span class="optional-label">(optional)</span>
                  </label>
                  <input
                    :id="`class-offer-start-date-${activeClassOffer.id}`"
                    v-model="activeClassOfferStartDate"
                    type="date"
                  />
                </div>

                <div class="form-group">
                  <TimezonePicker
                    :id="`class-offer-timezone-${activeClassOffer.id}`"
                    label="Timezone"
                    :model-value="activeClassOfferTimezone"
                    :options="timezoneOptions"
                    @update:model-value="activeClassOfferTimezone = $event"
                  />
                </div>

                <div class="form-group">
                  <label class="checkbox-inline">
                    <input
                      v-model="activeClassCapacityEnabled"
                      type="checkbox"
                    />
                    <span>Use space limit</span>
                  </label>
                  <input
                    v-if="activeClassCapacityEnabled"
                    v-model.number="activeClassCapacity"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Spaces"
                  />
                </div>
              </div>

              <div
                v-if="activeClassOfferPriceMode === 'paid'"
                class="pricing-editor"
              >
                <div class="form-row">
                  <div class="form-group">
                    <label :for="`class-offer-price-${activeClassOffer.id}`"
                      >Price</label
                    >
                    <input
                      :id="`class-offer-price-${activeClassOffer.id}`"
                      v-model.number="activeClassOfferPriceAmount"
                      type="number"
                      min="5"
                      step="1"
                    />
                  </div>
                  <div class="form-group">
                    <label :for="`class-offer-currency-${activeClassOffer.id}`">
                      Currency
                    </label>
                    <select
                      :id="`class-offer-currency-${activeClassOffer.id}`"
                      v-model="activeClassOfferPriceCurrency"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="CAD">CAD (C$)</option>
                      <option value="AUD">AUD (A$)</option>
                      <option value="CHF">CHF (Fr.)</option>
                      <option value="SGD">SGD (S$)</option>
                      <option value="INR">INR (₹)</option>
                      <option value="PKR">PKR (Rs)</option>
                    </select>
                  </div>
                </div>
                <PaymentCollectionFields
                  v-model="activeClassOfferPaymentMethod"
                  v-model:instructions="activeClassOfferPaymentInstructions"
                  :input-id="`class-offer-${activeClassOffer.id}`"
                />
              </div>
            </div>
          </div>
        </div>

        <div
          v-else-if="activeBookingType === 'retreat'"
          class="booking-type-panel"
        >
          <div class="offer-editor-card">
            <div class="section-heading">
              <label class="section-label">Retreats</label>
            </div>
            <div class="offer-tabs-bar">
              <div class="offer-tablist" role="tablist" aria-label="Retreats">
                <div
                  v-for="(offer, index) in retreatOffers"
                  :key="offer.id"
                  class="offer-tab-item"
                  :class="{ active: offer.id === activeRetreatOfferId }"
                >
                  <button
                    type="button"
                    class="offer-tab"
                    :aria-selected="offer.id === activeRetreatOfferId"
                    @click="activeRetreatOfferId = offer.id"
                  >
                    {{ compactTabLabel(offer, `Retreat ${index + 1}`) }}
                  </button>
                  <button
                    v-if="retreatOffers.length > 1"
                    type="button"
                    class="offer-tab-remove"
                    aria-label="Remove this retreat"
                    @click.stop.prevent="removeRetreatOffer(offer.id)"
                  >
                    <UiIcon name="X" :size="14" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <button
                type="button"
                class="offer-tab-add"
                @click.prevent.stop="addRetreatOffer"
              >
                <UiIcon name="Plus" :size="18" aria-hidden="true" />
                <span>Add retreat</span>
              </button>
            </div>

            <div v-if="activeRetreatOffer" class="offer-tab-panel-body">
              <div class="form-row offer-primary-row">
                <div class="form-group offer-title-field">
                  <label :for="`retreat-offer-title-${activeRetreatOffer.id}`"
                    >Title</label
                  >
                  <input
                    :id="`retreat-offer-title-${activeRetreatOffer.id}`"
                    v-model="activeRetreatOfferTitle"
                    type="text"
                    maxlength="100"
                    placeholder="e.g. Spring weekend immersion"
                  />
                </div>

                <div class="form-group offer-duration-field">
                  <label
                    :for="`retreat-duration-days-${activeRetreatOffer.id}`"
                  >
                    Duration (days, derived)
                  </label>
                  <input
                    :id="`retreat-duration-days-${activeRetreatOffer.id}`"
                    :value="activeRetreatDurationDays"
                    type="number"
                    min="1"
                    step="1"
                    readonly
                  />
                </div>

                <div class="form-group offer-price-field">
                  <label class="offer-price-field-label">Price</label>
                  <div class="offer-price-btns">
                    <button
                      type="button"
                      class="offer-price-btn"
                      :class="{
                        active: activeRetreatOfferPriceMode === 'free',
                      }"
                      @click="activeRetreatOfferPriceMode = 'free'"
                    >
                      Free
                    </button>
                    <button
                      type="button"
                      class="offer-price-btn"
                      :class="{
                        active: activeRetreatOfferPriceMode === 'paid',
                      }"
                      @click="activeRetreatOfferPriceMode = 'paid'"
                    >
                      Paid
                    </button>
                  </div>
                </div>
              </div>

              <div class="form-group">
                <label
                  :for="`retreat-offer-description-${activeRetreatOffer.id}`"
                >
                  Description
                </label>
                <textarea
                  :id="`retreat-offer-description-${activeRetreatOffer.id}`"
                  v-model="activeRetreatOfferDescription"
                  rows="3"
                  placeholder="Briefly describe what’s included"
                />
              </div>

              <p class="field-hint">
                Start and end use calendar dates and times in the retreat’s
                timezone (for booking and reminders).
              </p>

              <div class="form-row retreat-schedule-row">
                <div class="form-group">
                  <label :for="`retreat-start-date-${activeRetreatOffer.id}`">
                    Start date
                  </label>
                  <input
                    :id="`retreat-start-date-${activeRetreatOffer.id}`"
                    v-model="activeRetreatStartDate"
                    type="date"
                  />
                </div>
                <div class="form-group retreat-schedule-time">
                  <label :for="`retreat-start-time-${activeRetreatOffer.id}`">
                    Start time
                  </label>
                  <input
                    :id="`retreat-start-time-${activeRetreatOffer.id}`"
                    v-model="activeRetreatStartTime"
                    type="time"
                  />
                </div>
                <div class="form-group">
                  <label :for="`retreat-end-date-${activeRetreatOffer.id}`">
                    End date
                  </label>
                  <input
                    :id="`retreat-end-date-${activeRetreatOffer.id}`"
                    v-model="activeRetreatEndDate"
                    type="date"
                  />
                </div>
                <div class="form-group retreat-schedule-time">
                  <label :for="`retreat-end-time-${activeRetreatOffer.id}`">
                    End time
                  </label>
                  <input
                    :id="`retreat-end-time-${activeRetreatOffer.id}`"
                    v-model="activeRetreatEndTime"
                    type="time"
                  />
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <TimezonePicker
                    :id="`retreat-offer-timezone-${activeRetreatOffer.id}`"
                    label="Timezone"
                    :model-value="activeRetreatOfferTimezone"
                    :options="timezoneOptions"
                    @update:model-value="activeRetreatOfferTimezone = $event"
                  />
                </div>

                <div class="form-group">
                  <label class="checkbox-inline">
                    <input
                      v-model="activeRetreatCapacityEnabled"
                      type="checkbox"
                    />
                    <span>Use space limit</span>
                  </label>
                  <input
                    v-if="activeRetreatCapacityEnabled"
                    v-model.number="activeRetreatCapacity"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Spaces"
                  />
                </div>
              </div>

              <div
                v-if="activeRetreatOfferPriceMode === 'paid'"
                class="pricing-editor"
              >
                <div class="form-row">
                  <div class="form-group">
                    <label :for="`retreat-offer-price-${activeRetreatOffer.id}`"
                      >Price</label
                    >
                    <input
                      :id="`retreat-offer-price-${activeRetreatOffer.id}`"
                      v-model.number="activeRetreatOfferPriceAmount"
                      type="number"
                      min="5"
                      step="1"
                    />
                  </div>
                  <div class="form-group">
                    <label
                      :for="`retreat-offer-currency-${activeRetreatOffer.id}`"
                    >
                      Currency
                    </label>
                    <select
                      :id="`retreat-offer-currency-${activeRetreatOffer.id}`"
                      v-model="activeRetreatOfferPriceCurrency"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="CAD">CAD (C$)</option>
                      <option value="AUD">AUD (A$)</option>
                      <option value="CHF">CHF (Fr.)</option>
                      <option value="SGD">SGD (S$)</option>
                      <option value="INR">INR (₹)</option>
                      <option value="PKR">PKR (Rs)</option>
                    </select>
                  </div>
                </div>
                <PaymentCollectionFields
                  v-model="activeRetreatOfferPaymentMethod"
                  v-model:instructions="activeRetreatOfferPaymentInstructions"
                  :input-id="`retreat-offer-${activeRetreatOffer.id}`"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="confirmation-email-section">
          <div class="confirmation-email-header">
            <div>
              <h3 class="confirmation-email-title">
                Booking confirmation emails
              </h3>
              <p class="confirmation-email-lead">
                ME3 always emails the customer their booking details, even when
                the optional message below is blank. Emails use your account
                sender;
                <RouterLink class="confirmation-email-inline-link" to="/account?section=mailbox">
                  see sender settings
                </RouterLink>.
              </p>
            </div>
          </div>

          <label class="checkbox-inline confirmation-email-copy-toggle">
            <input v-model="bookingConfirmationSendHostCopy" type="checkbox" />
            <span>Send me a copy of each booking confirmation</span>
          </label>

          <div class="form-group">
            <label for="booking-confirmation-message">
              Additional message (optional)
            </label>
            <textarea
              id="booking-confirmation-message"
              v-model="bookingConfirmationMessage"
              class="confirmation-email-textarea"
              rows="5"
              maxlength="8000"
              placeholder="Add directions, preparation notes, links, or other next steps."
            ></textarea>
          </div>

          <div class="confirmation-email-test-controls">
            <div class="confirmation-email-test-field">
              <label for="booking-confirmation-test-recipient">
                Send a test to
              </label>
              <input
                id="booking-confirmation-test-recipient"
                v-model="bookingConfirmationTestRecipient"
                type="email"
                inputmode="email"
                autocomplete="email"
                maxlength="254"
                placeholder="name@example.com"
                :aria-invalid="
                  bookingConfirmationTestRecipient &&
                  !bookingConfirmationTestRecipientIsValid
                    ? 'true'
                    : undefined
                "
                :aria-describedby="
                  bookingConfirmationTestRecipient &&
                  !bookingConfirmationTestRecipientIsValid
                    ? 'booking-confirmation-test-error booking-confirmation-test-help'
                    : 'booking-confirmation-test-help'
                "
                @keyup.enter="sendBookingConfirmationTest"
              />
            </div>
            <button
              class="offer-tab-add confirmation-email-test-button"
              type="button"
              :disabled="
                isSendingBookingConfirmationTest ||
                !canSendBookingConfirmationTest
              "
              @click="sendBookingConfirmationTest"
            >
              <UiIcon name="Mail" :size="16" aria-hidden="true" />
              <span>{{
                isSendingBookingConfirmationTest ? "Sending..." : "Send test"
              }}</span>
            </button>
          </div>
          <p
            v-if="
              bookingConfirmationTestRecipient &&
              !bookingConfirmationTestRecipientIsValid
            "
            id="booking-confirmation-test-error"
            class="confirmation-email-test-error"
            role="alert"
          >
            Enter a valid email address.
          </p>
          <p
            id="booking-confirmation-test-help"
            class="confirmation-email-test-note"
          >
            {{
              !bookingConfirmationTestInbox
                ? "Sign in to send a test."
                : !bookingConfirmationTestUsername
                  ? "Claim your username first."
                  : "The test includes the selected booking type’s generated details, payment details when applicable, and your optional message."
            }}
            Test values:
            <code>{{ bookingConfirmationTestTokenPreview.guestName }}</code
            >,
            <code>{{ bookingConfirmationTestTokenPreview.bookingTitle }}</code>
          </p>
          <p class="confirmation-email-tokens" v-pre>
            Placeholders:
            <code>{{ guestName }}</code
            >, <code>{{ guestEmail }}</code
            >, <code>{{ bookingTitle }}</code
            >, <code>{{ bookingTime }}</code
            >, <code>{{ siteName }}</code
            >, <code>{{ hostName }}</code
            >, <code>{{ hostEmail }}</code>
          </p>
        </div>

      </template>
    </div>

  </div>
</template>

<style scoped>
.step-bookings h2 {
  font-size: 28px;
  margin-bottom: 8px;
}

.section-desc,
.subsection-desc,
.field-hint,
.empty-bookings-copy {
  color: var(--color-text-muted);
  font-size: 14px;
}

.section-desc {
  margin-bottom: 24px;
}

.config-fields {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 12px;
}

.config-fields > div:first-of-type {
  padding: 10px 10px 0;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-label {
  display: block;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 6px;
}

.type-actions,
.add-type-menu-wrap {
  position: relative;
}

.type-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 10;
  min-width: 180px;
  padding: 6px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08);
}

.type-dropdown-item {
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
}

.type-dropdown-item:hover:not(.disabled) {
  background: rgba(0, 0, 0, 0.04);
}

.type-dropdown-item.disabled {
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.empty-bookings-state,
.monetize-section {
  padding: 20px;
  border-top: 1px solid var(--color-border);
}

.confirmation-email-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 18px;
  padding: 16px 20px 20px;
  border-top: 1px solid var(--ui-border, var(--color-border));
  background: var(--ui-surface-muted, rgba(0, 0, 0, 0.03));
}

.confirmation-email-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.confirmation-email-title {
  margin: 0 0 4px;
  font-size: 16px;
  color: var(--ui-text, var(--color-text));
}

.confirmation-email-lead,
.confirmation-email-test-note,
.confirmation-email-tokens {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.45;
}

.confirmation-email-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.confirmation-email-test-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
}

.confirmation-email-test-field {
  display: grid;
  gap: 6px;
}

.confirmation-email-test-field label {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  font-weight: 500;
}

.confirmation-email-test-field input {
  width: 100%;
  box-sizing: border-box;
  min-height: 44px;
  padding: 10px 14px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 14px;
}

.confirmation-email-test-field input:focus-visible {
  outline: 2px solid var(--ui-accent, var(--color-primary));
  outline-offset: 2px;
}

.confirmation-email-test-error {
  margin: -6px 0 0;
  color: var(--color-danger, #b42318);
  font-size: 12px;
}

.confirmation-email-test-button {
  min-height: 44px;
}

.confirmation-email-test-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.confirmation-email-copy-toggle {
  width: fit-content;
}

.confirmation-email-textarea {
  min-height: 112px;
}

.confirmation-email-inline-link {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.confirmation-email-inline-link:hover {
  color: var(--ui-text, var(--color-text));
}

.confirmation-email-test-note code,
.confirmation-email-tokens code {
  padding: 1px 4px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: 4px;
  background: var(--ui-surface, var(--color-bg));
  font-size: 11px;
}

.offer-editor-card {
  padding: 0 20px;
}

.booking-heading-fields {
  padding: 0 20px;
}

.empty-bookings-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 8px;
}

.booking-type-tabs,
.offer-tabs-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

/* Top-level 1:1 / Classes: reads as a tab row (underline), not floating pill buttons */
.booking-type-tabs {
  gap: 4px;
  align-items: flex-end;
  border-bottom: 1px solid var(--color-border);
  padding: 0 2px;
}

.booking-type-tabs .offer-tab-item {
  border: none;
  border-radius: 0;
  background: transparent;
  overflow: visible;
  margin-bottom: -1px;
}

.booking-type-tabs .offer-tab-item:not(.active) {
  border-bottom: 2px solid transparent;
}

.booking-type-tabs .offer-tab-item.active {
  background: transparent;
  border-bottom: 2px solid var(--color-text);
}

.booking-type-tabs .offer-tab-item:not(.active) .offer-tab,
.booking-type-tabs .offer-tab-item:not(.active) .offer-tab-remove {
  color: var(--color-text-muted);
}

.booking-type-tabs .offer-tab-item.active .offer-tab,
.booking-type-tabs .offer-tab-item.active .offer-tab-remove {
  color: var(--color-text);
}

.offer-tablist {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
}

.offer-tab-item {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-bg);
}

.offer-tabs-bar .offer-tab-item.active {
  background: #232428;
  border-color: #232428;
}

.offer-tab {
  border: none;
  background: transparent;
  padding: 8px 12px;
  color: var(--color-text-muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.offer-tabs-bar .offer-tab-item.active .offer-tab,
.offer-tabs-bar .offer-tab-item.active .offer-tab-remove {
  color: #fff;
}

.offer-tab-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.offer-tab-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.booking-type-panel,
.offer-tab-panel-body {
  margin-top: 18px;
}

.booking-heading-fields,
.pricing-editor {
  margin-top: 16px;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

/* Retreat start/end: one row; compact time columns so dates + times fit */
.form-row.retreat-schedule-row {
  grid-template-columns:
    minmax(0, 1fr) minmax(5.75rem, 6.75rem) minmax(0, 1fr)
    minmax(5.75rem, 6.75rem);
  gap: 12px;
  align-items: end;
}

.form-row.retreat-schedule-row .retreat-schedule-time input[type="time"] {
  width: 100%;
  max-width: 6.75rem;
  padding-inline: 10px;
}

.offer-primary-row {
  align-items: end;
}

.offer-title-field {
  grid-column: span 1;
}

.form-group {
  margin-bottom: 12px;
}

.form-group label,
.offer-price-field-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}

.form-group input[type="text"],
.form-group input[type="number"],
.form-group input[type="date"],
.form-group input[type="time"],
.form-group textarea,
.form-group select {
  width: 100%;
  padding: 10px 14px;
  font-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
}

.form-group textarea {
  resize: vertical;
}

.offer-price-btns {
  display: flex;
  min-height: 42px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.offer-price-btn {
  flex: 1;
  border: none;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.offer-price-btn + .offer-price-btn {
  border-left: 1px solid var(--color-border);
}

.offer-price-btn.active {
  background: #232428;
  color: #fff;
}

.checkbox-row,
.checkbox-inline {
  display: inline-flex !important;
  align-items: center;
  gap: 8px;
}

.checkbox-label {
  font-size: 14px;
  color: var(--color-text);
}

.payments-checkbox-row {
  margin: 12px 0 6px;
}

@media (max-width: 720px) {
  .confirmation-email-header {
    flex-direction: column;
  }

  .confirmation-email-actions {
    justify-content: flex-start;
  }

  .confirmation-email-test-controls {
    grid-template-columns: 1fr;
  }

  .confirmation-email-test-button {
    justify-content: center;
  }

  .form-row:not(.retreat-schedule-row) {
    grid-template-columns: 1fr;
  }

  .form-row.retreat-schedule-row {
    grid-template-columns: 1fr;
  }
}
</style>
