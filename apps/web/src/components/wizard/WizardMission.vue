<script setup lang="ts">
import { computed } from "vue";
import { useWizardStore } from "../../stores/wizard";
import UiIcon from "../UiIcon.vue";

const wizard = useWizardStore();
const isOrganization = computed(() => wizard.siteRole === "organization");

const DEFAULT_BUSINESS = {
  positioningStatement: "",
  audience: "",
  primaryProblem: "",
  solution: "",
  targetMarket: "",
  primaryOutcome: "",
};

function updateBusiness(updates: Partial<typeof DEFAULT_BUSINESS>) {
  const currentBusiness = {
    ...DEFAULT_BUSINESS,
    ...(wizard.profile.business || {}),
  };
  const nextBusiness = {
    ...currentBusiness,
    ...updates,
  };
  const sourceChanged =
    "audience" in updates ||
    "primaryProblem" in updates ||
    "solution" in updates;

  if (sourceChanged) {
    nextBusiness.positioningStatement = "";
    nextBusiness.targetMarket = "";
    nextBusiness.primaryOutcome = "";
  }

  wizard.updateProfile({
    business: nextBusiness,
  });
}

const businessAudience = computed({
  get: () => wizard.profile.business?.audience || "",
  set: (val: string) => {
    updateBusiness({
      audience: val,
    });
  },
});

const businessPrimaryProblem = computed({
  get: () => wizard.profile.business?.primaryProblem || "",
  set: (val: string) => {
    updateBusiness({
      primaryProblem: val,
    });
  },
});

const businessSolution = computed({
  get: () => wizard.profile.business?.solution || "",
  set: (val: string) => {
    updateBusiness({
      solution: val,
    });
  },
});

</script>

<template>
  <div class="step-mission">
    <h2>Who you help</h2>
    <p class="step-desc">
      {{
        isOrganization
          ? "Define who this site serves and how so ME3 can describe the organization clearly."
          : "Define who you help and how so ME3 can understand your work and support your goals."
      }}
    </p>

    <section class="business-positioning-card">
      <div class="business-positioning-header">
        <div>
          <h3>{{ isOrganization ? "Who this site helps and how" : "Who you help and how" }}</h3>
          <p>
            Answer three short questions. ME3 uses them to understand your
            work and describe it clearly.
          </p>
        </div>
      </div>

      <div class="positioning-builder">
        <div class="business-clarity-fields">
          <label class="business-clarity-field" for="business-audience">
            <span>{{ isOrganization ? "Who does this site help?" : "Who do you help?" }}</span>
            <input
              id="business-audience"
              v-model="businessAudience"
              type="text"
              placeholder="e.g. People who want to learn something new"
              maxlength="160"
            />
          </label>
          <label class="business-clarity-field" for="business-primary-problem">
            <span>What do they want help with?</span>
            <input
              id="business-primary-problem"
              v-model="businessPrimaryProblem"
              type="text"
              placeholder="e.g. Learn a skill or solve a problem"
              maxlength="160"
            />
          </label>
          <label class="business-clarity-field" for="business-solution">
            <span>{{ isOrganization ? "How does it help?" : "How do you help?" }}</span>
            <input
              id="business-solution"
              v-model="businessSolution"
              type="text"
              placeholder="e.g. Lessons, coaching, or practical support"
              maxlength="240"
            />
          </label>
          <div class="business-clarity-actions">
            <span class="business-autosave-note">
              <UiIcon name="Check" :size="14" aria-hidden="true" />
              Draft saves automatically. Publish to update ME3.
            </span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.step-mission h2 {
  font-size: 28px;
  margin-bottom: 8px;
}

.step-desc {
  color: var(--color-text-muted);
  margin-bottom: 24px;
}

.business-positioning-card {
  margin-bottom: 24px;
  padding: 16px;
  border-radius: 12px;
  border: 2px solid var(--color-border);
  background: var(--color-bg);
}

.business-positioning-header {
  margin-bottom: 16px;
}

.business-positioning-header h3 {
  font-size: 18px;
  margin: 0 0 4px;
}

.business-positioning-header p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

.positioning-builder {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.business-clarity-fields {
  display: grid;
  gap: 14px;
}

.business-clarity-field {
  display: grid;
  gap: 7px;
  color: var(--ui-text, var(--color-text));
  font-size: 13px;
  font-weight: 600;
}

.business-clarity-field input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 10px);
  background: var(--ui-bg, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  padding: 11px 12px;
}

.business-clarity-field input:focus-visible {
  outline: 2px solid var(--ui-accent, var(--color-primary));
  outline-offset: 1px;
}

.business-clarity-field input::placeholder {
  color: var(--ui-text-muted, var(--color-text-muted));
  opacity: 1;
}

.business-clarity-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.business-autosave-note {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
}

</style>
