/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly NEXT_PUBLIC_SUPABASE_URL: string;
  readonly NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  readonly NEXT_PUBLIC_DEMO_EMAIL?: string;
  readonly NEXT_PUBLIC_DEMO_STAFF_EMAIL?: string;
  readonly NEXT_PUBLIC_DEMO_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
