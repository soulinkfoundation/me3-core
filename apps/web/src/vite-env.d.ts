/// <reference types="vite/client" />
/// <reference types="unplugin-vue-router/client" />

import "vue-router";

declare module "vue-router" {
  interface RouteMeta {
    /** Requires a Core plugin to be installed and enabled. */
    requiresPlugin?: string;
    /** Hides the floating agent chat launcher on this route. */
    hideAgentLauncher?: boolean;
    /** Hides the app top bar on wide screens; the page provides its own way Home. */
    hideTopBarOnWide?: boolean;
  }
}

interface ImportMetaEnv {
  readonly VITEST?: boolean
  readonly VITE_API_BASE?: string
  readonly VITE_REMOTE_API_HOST?: string
  readonly VITE_USERNAME_AVAILABILITY_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
