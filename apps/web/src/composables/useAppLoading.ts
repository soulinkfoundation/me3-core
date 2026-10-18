import { computed, onScopeDispose, ref, watch, type Ref } from "vue";

// One shared counter drives the thin bar at the top of the app. Each source
// holds a token while it loads, so overlapping loads keep the bar up until
// the last one finishes.
const pending = ref(0);

export const isAppLoading = computed(() => pending.value > 0);

/** Starts a load and returns a release function that is safe to call twice. */
export function beginAppLoading(): () => void {
  pending.value += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pending.value = Math.max(0, pending.value - 1);
  };
}

/** Shows the app loading bar while `source` is true, for the current scope. */
export function useAppLoadingWhile(source: Ref<boolean>) {
  let release: (() => void) | null = null;
  watch(
    source,
    (active) => {
      if (active && !release) release = beginAppLoading();
      else if (!active && release) {
        release();
        release = null;
      }
    },
    { immediate: true },
  );
  onScopeDispose(() => release?.());
}
