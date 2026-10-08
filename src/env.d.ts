/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
    export default component;
}

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
    /** Optional CDN base for /templates/* assets (empty = same origin). */
    readonly VITE_ASSET_BASE_URL?: string;
    /** Optional public site origin for "view invitation" links. */
    readonly VITE_PUBLIC_SITE_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
