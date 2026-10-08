/**
 * Node server:
 *   GET  /{slug}               public invitation (SSR'd LadiPage HTML + OG tags)
 *   POST /api/preview/:id      live preview for the admin editor (auth: Supabase JWT)
 *   GET  /templates/{key}/...  template assets (from templates/{key}/assets)
 *   GET  /admin/*              admin SPA (built by Vite)
 *
 * All data lives in Supabase. This server holds no secrets beyond the public
 * anon key: published pages are read through the `public_invitation` RPC, and
 * previews are read with the editor's own JWT so RLS decides what they may see.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { renderLadiPage, type RenderOptions } from '../shared/render';
import type { MediaRow, RenderableInvitation, TemplateManifest } from '../shared/types';

try {
    process.loadEnvFile?.();
} catch {
    /* no .env file — use the real environment */
}

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const TEMPLATES = join(ROOT, 'templates');
const isProd = process.env.NODE_ENV === 'production';

const env = {
    port: Number(process.env.PORT || 3000),
    // Bare project URL; tolerate a pasted REST endpoint (.../rest/v1/).
    supabaseUrl: (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, ''),
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
    siteUrl: (process.env.SITE_URL || '').replace(/\/+$/, ''),
    assetBase: (process.env.ASSET_BASE_URL || '').replace(/\/+$/, ''),
    timezone: process.env.TEMPLATE_TIMEZONE || 'Asia/Ho_Chi_Minh',
    favicon: process.env.SITE_FAVICON || '/images/kane-monogram-400x400.png',
    viteDev: (process.env.VITE_DEV_SERVER || 'http://localhost:5173').replace(/\/+$/, ''),
};

if (!env.supabaseUrl || !env.anonKey) {
    console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see .env.example).');
    process.exit(1);
}

const SLUG = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function supabase(accessToken?: string) {
    return createClient(env.supabaseUrl, env.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    });
}

const anon = supabase();

const htmlFiles = new Map<string, string>();
function templateHtml(key: string): string | null {
    if (!/^[a-z0-9-]+$/.test(key)) return null;
    if (isProd && htmlFiles.has(key)) return htmlFiles.get(key)!;
    const path = join(TEMPLATES, key, 'index.html');
    if (!existsSync(path)) return null;
    const html = readFileSync(path, 'utf8');
    if (isProd) htmlFiles.set(key, html);
    return html;
}

/** <script>/<link> tags for the public hydration bundle (Vite manifest in prod, dev server otherwise). */
let bundleTags: string | null = null;
function publicBundleTags(): string {
    if (!isProd) {
        return `<script type="module" src="${env.viteDev}/@vite/client"></script>` +
            `<script type="module" src="${env.viteDev}/src/public/ladipage.ts"></script>`;
    }
    if (bundleTags !== null) return bundleTags;

    const manifest = JSON.parse(readFileSync(join(DIST, '.vite', 'manifest.json'), 'utf8'));
    const entry = manifest['src/public/ladipage.ts'];
    if (!entry) throw new Error('ladipage entry missing from the Vite manifest — run `npm run build`.');

    const css = new Set<string>(entry.css ?? []);
    for (const imp of entry.imports ?? []) {
        for (const f of manifest[imp]?.css ?? []) css.add(f);
    }

    bundleTags = [...css].map((f) => `<link rel="stylesheet" href="/${f}">`).join('') +
        `<script type="module" src="/${entry.file}"></script>`;
    return bundleTags;
}

function renderOptions(origin: string): RenderOptions {
    return {
        assetBase: env.assetBase,
        origin,
        timezone: env.timezone,
        favicon: env.favicon,
        headTags: publicBundleTags(),
        supabase: { url: env.supabaseUrl, anonKey: env.anonKey },
    };
}

function originOf(reqUrl: string, headers: Headers): string {
    if (env.siteUrl) return env.siteUrl;
    const url = new URL(reqUrl);
    const proto = headers.get('x-forwarded-proto')?.split(',')[0] || url.protocol.replace(':', '');
    const host = headers.get('x-forwarded-host') || headers.get('host') || url.host;
    return `${proto}://${host}`;
}

/** Small in-memory render cache. Keyed by updated_at, so edits invalidate themselves. */
const pageCache = new Map<string, { html: string; at: number }>();
const PAGE_TTL = 6 * 60 * 60 * 1000;
function cached(key: string, render: () => string): string {
    const hit = pageCache.get(key);
    if (hit && Date.now() - hit.at < PAGE_TTL) return hit.html;
    const html = render();
    pageCache.set(key, { html, at: Date.now() });
    if (pageCache.size > 500) pageCache.delete(pageCache.keys().next().value!);
    return html;
}

const notFoundPage = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Không tìm thấy thiệp</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#fdf6f3;color:#6e2f22;text-align:center}h1{font-size:1.5rem}</style></head>
<body><div><div style="font-size:3rem">💌</div><h1>Không tìm thấy thiệp mời</h1><p>Đường dẫn không đúng hoặc thiệp chưa được xuất bản.</p></div></body></html>`;

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono();

app.get('/healthz', (c) => c.json({ ok: true }));

// Template assets: /templates/{key}/images/x.jpg -> templates/{key}/assets/images/x.jpg
app.use(
    '/templates/*',
    async (c, next) => (c.req.path.includes('..') ? c.notFound() : next()),
    serveStatic({
        root: 'templates',
        rewriteRequestPath: (p) => p.replace(/^\/templates\/([^/]+)\//, '/$1/assets/'),
        onFound: (_path, c) => {
            c.header('Cache-Control', 'public, max-age=31536000, immutable');
            c.header('Access-Control-Allow-Origin', '*');
        },
    }),
);

if (isProd) {
    // Vite build output (hashed bundles + files from public/).
    app.use('/assets/*', serveStatic({
        root: 'dist',
        onFound: (_p, c) => { c.header('Cache-Control', 'public, max-age=31536000, immutable'); },
    }));
    app.use('/images/*', serveStatic({ root: 'dist' }));
    app.get('/favicon.ico', serveStatic({ path: 'dist/favicon.ico' }));

    const adminHtml = () => readFileSync(join(DIST, 'index.html'), 'utf8');
    app.get('/admin', (c) => c.html(adminHtml()));
    app.get('/admin/*', (c) => c.html(adminHtml()));
} else {
    app.get('/admin/*', (c) => c.redirect(`${env.viteDev}${c.req.path}`));
    app.get('/admin', (c) => c.redirect(`${env.viteDev}/admin`));
    app.use('/images/*', serveStatic({ root: 'public' }));
}

app.get('/', (c) => c.redirect('/admin'));

/**
 * Live preview for the editor iframe: renders an invitation in ANY status with
 * the unsaved draft (settings/theme) from the request body. Read with the
 * caller's JWT, so RLS limits it to invitations they own (or any, for admins).
 */
app.post('/api/preview/:id{[0-9]+}', async (c) => {
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return c.json({ message: 'Unauthorized' }, 401);

    const db = supabase(token);
    const id = Number(c.req.param('id'));

    const { data: inv, error } = await db
        .from('invitations')
        .select('id, slug, title, locale, template_key, settings, theme, seo, templates(manifest)')
        .eq('id', id)
        .maybeSingle();
    if (error) return c.json({ message: error.message }, 400);
    if (!inv) return c.json({ message: 'Không tìm thấy thiệp' }, 404);

    const { data: media, error: mErr } = await db.from('media').select('*').eq('invitation_id', id);
    if (mErr) return c.json({ message: mErr.message }, 400);

    const draft = (await c.req.json().catch(() => ({}))) as { settings?: unknown; theme?: unknown };
    const invitation: RenderableInvitation = {
        ...(inv as any),
        settings: draft.settings && typeof draft.settings === 'object' ? draft.settings : inv.settings,
        theme: draft.theme && typeof draft.theme === 'object' ? draft.theme : inv.theme,
    };

    const html = templateHtml(inv.template_key);
    if (!html) return c.json({ message: `Thiếu file templates/${inv.template_key}/index.html` }, 500);

    const out = renderLadiPage(
        { html, invitation, manifest: (inv as any).templates.manifest as TemplateManifest, media: (media ?? []) as MediaRow[] },
        renderOptions(originOf(c.req.url, c.req.raw.headers)),
    );

    c.header('Cache-Control', 'no-store');
    return c.html(out);
});

// Public invitation page. Registered last: it is a catch-all for one lowercase segment.
app.get(`/:slug{${SLUG}}`, async (c) => {
    const slug = c.req.param('slug');

    const { data, error } = await anon.rpc('public_invitation', { p_slug: slug, p_track: true });
    if (error) {
        console.error('public_invitation failed', error);
        return c.html('<h1>Lỗi máy chủ, vui lòng thử lại.</h1>', 500);
    }
    if (!data) return c.html(notFoundPage, 404);

    const { invitation, manifest, media } = data as {
        invitation: RenderableInvitation & { updated_at: string };
        manifest: TemplateManifest;
        media: MediaRow[];
    };

    const html = templateHtml(invitation.template_key);
    if (!html) return c.html(notFoundPage, 404);

    const origin = originOf(c.req.url, c.req.raw.headers);
    const page = cached(`${invitation.id}:${invitation.updated_at}:${origin}`, () =>
        renderLadiPage({ html, invitation, manifest, media }, renderOptions(origin)),
    );

    // Short browser cache only: every request must reach us to count the view.
    c.header('Cache-Control', 'public, max-age=0, must-revalidate');
    return c.html(page);
});

app.notFound((c) => c.html(notFoundPage, 404));

serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(`▶ Kane Wedding server on http://localhost:${info.port} (${isProd ? 'production' : 'development'})`);
    if (!isProd) console.log(`  Admin (Vite): ${env.viteDev}/admin`);
});
