import { onBeforeUnmount, onMounted, shallowRef } from "vue";
import { onBeforeRouteLeave } from "vue-router";

// The app top bar's X leaves the screen. A page that must decide how to leave (save first, close a sheet)
// registers a handler here instead of drawing its own X.
type CloseHandler = () => unknown;
const closeHandler = shallowRef<CloseHandler | null>(null);

export function topBarCloseHandler() {
  return closeHandler;
}

export function useTopBarClose(handler: CloseHandler) {
  onMounted(() => { closeHandler.value = handler; });
  onBeforeUnmount(() => { if (closeHandler.value === handler) closeHandler.value = null; });
}

/** Asks before leaving a screen with unsaved work, by X, a link, or closing the tab. */
export function useLeaveGuard(isDirty: () => boolean, message = "Leave without saving? Your changes will be lost.") {
  onBeforeRouteLeave(() => !isDirty() || window.confirm(message));
  const onUnload = (event: BeforeUnloadEvent) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  onMounted(() => window.addEventListener("beforeunload", onUnload));
  onBeforeUnmount(() => window.removeEventListener("beforeunload", onUnload));
}
