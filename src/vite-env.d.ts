/// <reference types="vite/client" />

// Declaration merging onto Vite's ImportMetaEnv, so the app's own env vars are typed.
interface ImportMetaEnv {
  readonly VITE_VIM_SERVER_URL?: string
  readonly VITE_ENTRA_TENANT_ID?: string
  readonly VITE_ENTRA_CLIENT_ID?: string
  readonly VITE_ENTRA_API_SCOPE?: string
}
