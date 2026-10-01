/// <reference types="vite/client" />
/// <reference types="unplugin-vue-router/client" />

import "vue-router";

declare module "vue-router" {
  interface RouteMeta {
    /** Requires an authenticated local Core workspace. */
    requiresWorkspace?: boolean;
    /** Requires a Core plugin to be installed and enabled. */
    requiresPlugin?: string;
    requiresNavigationFeature?: string;
    /** Hides the floating agent chat launcher on this route. */
    hideAgentLauncher?: boolean;
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
