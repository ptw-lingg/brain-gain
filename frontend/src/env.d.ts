/// <reference types="vite/client" />

// VITE_INTERNAL=true (set by `--mode internal` / .env.internal) includes the internal-only
// Requirements/DMS tooling in the build; absent in the public production build.
interface ImportMetaEnv {
  readonly VITE_INTERNAL?: string;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
