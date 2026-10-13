/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_DEMO_LOGIN_ORG?: string;
  readonly VITE_DEMO_LOGIN_EMAIL?: string;
  readonly VITE_DEMO_LOGIN_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
