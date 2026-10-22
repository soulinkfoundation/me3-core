import { onBeforeUnmount, watch, type Ref } from "vue";

export const COMPOSER_CLEARANCE_PROPERTY = "--app-composer-clearance";

// Publishes how far a fixed composer reaches up from the viewport bottom, so
// app-level overlays (the Soulink invitation) can sit just above it.
export function useComposerClearance(composer: Ref<HTMLElement | null>) {
  const root = document.documentElement;
  let observer: ResizeObserver | null = null;

  function update(element: HTMLElement) {
    const clearance = Math.max(0, window.innerHeight - element.getBoundingClientRect().top);
    root.style.setProperty(COMPOSER_CLEARANCE_PROPERTY, `${Math.round(clearance)}px`);
  }

  function release() {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("resize", onResize);
    root.style.removeProperty(COMPOSER_CLEARANCE_PROPERTY);
  }

  function onResize() {
    if (composer.value) update(composer.value);
  }

  watch(
    composer,
    (element) => {
      release();
      if (!element) return;
      update(element);
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => update(element));
        observer.observe(element);
      }
      window.addEventListener("resize", onResize, { passive: true });
    },
    { immediate: true, flush: "post" },
  );

  onBeforeUnmount(release);
}
