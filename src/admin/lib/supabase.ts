import { createClient } from '@supabase/supabase-js';
import { assetUrl as withBase } from '@shared/settings';

// Accept a pasted REST endpoint ("https://x.supabase.co/rest/v1/") as well as the bare project URL.
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, '');
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
    // Fail loudly in the console; the login screen will surface request errors.
    console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env');
}

/** Single Supabase client for the admin SPA (session persisted in localStorage). */
export const supabase = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
});

export const MEDIA_BUCKET = 'media';

/** Template asset paths (/templates/...) optionally served from a CDN. */
export function assetUrl(path: string | null | undefined): string {
    return path ? withBase(path, import.meta.env.VITE_ASSET_BASE_URL ?? '') : '';
}

/**
 * Public invitation URL. In production the admin and the public pages share one
 * domain; in dev the admin runs on Vite (5173) while pages render on the Node server.
 */
export function publicUrl(slug: string): string {
    const base = import.meta.env.VITE_PUBLIC_SITE_URL || (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin);
    return `${base.replace(/\/+$/, '')}/${slug}`;
}

/** Turn any error (PostgREST, Storage, thrown) into a toast-friendly message. */
export function errorMessage(e: unknown, fallback = 'Có lỗi xảy ra'): string {
    const msg = (e as { message?: unknown })?.message;
    return typeof msg === 'string' && msg ? msg : fallback;
}

/** Laravel Str::slug equivalent for Vietnamese titles: "Đám cưới Anh & Em" -> "dam-cuoi-anh-em". */
export function slugify(input: string): string {
    return input
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100)
        .replace(/-+$/g, '');
}
