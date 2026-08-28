/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /**
   * The school's organization code, baked in at build time.
   *
   * The admin login asks for this and defaults it to "DEMO". A guardian has no
   * idea what an organization code is and should never be shown a field for one,
   * so the portal carries it instead of asking.
   */
  readonly VITE_ORG_CODE?: string;
  /** Display name in headings and the login screen. */
  readonly VITE_SCHOOL_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
