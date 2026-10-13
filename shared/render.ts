import { REMOVED_IMAGE, dataGet, fieldValue, placeholderImage, resolveSettings } from './settings';
import type { LadiMap, MediaRow, RenderableInvitation, TemplateManifest } from './types';

/**
 * Renders a "ladipage" engine template: serves the ORIGINAL LadiPage HTML
 * byte-for-byte (so the design/animations are 100% identical) and injects:
 *   - window.__INV__ config (text/image/music/gallery/forms) for client hydration
 *   - the hydration bundle (src/public/ladipage.ts)
 *   - SEO/OG meta, a visibility guard, and the realtime hearts overlay
 *
 * Editable content is applied in the browser by src/public/ladipage.ts,
 * keeping the server HTML untouched — the one exception is the video source,
 * which LadiPage's runtime consumes at boot, before hydration can reach it.
 */

export interface RenderOptions {
    /** CDN base for /templates/... assets ('' = same origin). */
    assetBase: string;
    /** Absolute site origin, used for og:url / og:image. */
    origin: string;
    /** Timezone wedding dates typed in the editor are meant in. */
    timezone: string;
    /** Favicon URL for every invitation page. */
    favicon: string;
    /** <script>/<link> tags that load the hydration bundle. */
    headTags: string;
    /** Public Supabase credentials for RSVP / guestbook / realtime. */
    supabase: { url: string; anonKey: string };
}

export interface RenderInput {
    html: string;
    invitation: RenderableInvitation;
    manifest: TemplateManifest;
    media: MediaRow[];
}

export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!);
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** JSON safe to embed inside a <script> tag. */
function scriptJson(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/'/g, '\\u0027')
        .replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));
}

export function renderLadiPage(input: RenderInput, opts: RenderOptions): string {
    const { invitation, manifest, media } = input;
    let html = input.html;

    // Repoint `/templates/...` asset references to the CDN (no-op without one).
    html = rewriteAssetUrls(html, opts.assetBase);

    // Strip dead weight LadiPage ships in <head>.
    html = trimHead(html);

    const settings = resolveSettings(manifest.sections ?? {}, invitation.settings ?? {}, media, opts.assetBase);
    const ladi = manifest.ladipage ?? {};

    const config = buildConfig(settings, ladi, opts.timezone);
    const slotCss = customImageCss(manifest, settings, invitation.settings ?? {});
    config.api = { url: opts.supabase.url, key: opts.supabase.anonKey };

    const seo = seoData(invitation, settings, opts.origin);

    html = applyVideo(html, ladi, settings);
    html = applyBranding(html, seo);

    html = html.replace(
        /<body\b/,
        `<body data-slug="${escapeHtml(invitation.slug)}" data-invitation="${Number(invitation.id)}"`,
    );

    html = html.replace('</head>', () => head(seo, opts) + slotCss + '</head>');
    html = html.replace('</body>', () => body(config) + '</body>');

    return html;
}

function rewriteAssetUrls(html: string, base: string): string {
    if (!base) return html;
    const b = base.replace(/\/+$/, '');
    return html.replace(/(["'(])\/templates\//g, (_m, p1: string) => `${p1}${b}/templates/`);
}

/**
 * Remove render-blocking IE polyfills, preconnects to LadiPage endpoints this
 * app never calls, and the template's own SEO tags (ours are injected instead,
 * so Zalo/Facebook previews show the couple, not the demo).
 */
function trimHead(html: string): string {
    return html
        .replace(/<script[^>]*src="https:\/\/w\.ladicdn\.com\/[^"]*(?:html5shiv|respond)\.min\.js[^"]*"[^>]*><\/script>/gi, '')
        .replace(/<link[^>]*rel="preconnect"[^>]*href="https:\/\/(?:api\d*\.ldpform\.com|api\.sales\.ldpform\.net|a\.ladipage\.com)\/?"[^>]*>/gi, '')
        .replace(/<meta[^>]*property="og:[^"]*"[^>]*>/gi, '')
        .replace(/<meta[^>]*name="(?:description|keywords)"[^>]*>/gi, '')
        .replace(/<link[^>]*rel="canonical"[^>]*>/gi, '');
}

interface Seo {
    title: string;
    description: string;
    og_image: string | null;
    url: string;
}

function applyBranding(html: string, seo: Seo): string {
    // Only the first <title>; the template's inner "Music Player" <title> stays.
    html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(seo.title)}</title>`);
    return html.replace(/<link[^>]*rel="[^"]*icon[^"]*"[^>]*>/gi, '');
}

/** A URL safe inside url("...") in a <style> block. */
function cssUrl(url: string): string {
    return url.replace(/["\\<>\n\r]/g, (c) => encodeURIComponent(c));
}

/**
 * The "custom_images" section, as CSS: each picture slot the couple replaced
 * (or removed -> sized placeholder) overrides exactly the selectors that paint
 * it, so one slot never affects another slot reusing the same template file.
 * Swapped boxes fill their frame (LadiPage crops each box to the ORIGINAL photo).
 * `:not(.ladi-lazyload)` keeps LadiPage's lazy loading working.
 */
function customImageCss(manifest: TemplateManifest, settings: Record<string, any>, raw: Record<string, any>): string {
    const rules: string[] = [];
    const fill: string[] = [];

    for (const [key, def] of Object.entries(manifest.sections?.custom_images?.fields ?? {})) {
        if (!def.targets?.length) continue;
        const url =
            fieldValue(raw.custom_images, key, def) === REMOVED_IMAGE
                ? placeholderImage(def.width, def.height)
                : (dataGet(settings, `custom_images.${key}.web`) ?? dataGet(settings, `custom_images.${key}.full`));
        if (!url) continue;

        const targets = def.targets.map((sel) => `${sel}:not(.ladi-lazyload)`);
        rules.push(`${targets.join(',')}{background-image:url("${cssUrl(url)}")!important}`);
        fill.push(...def.targets.filter((sel) => sel.includes('ladi-image-background')));
    }

    if (fill.length) {
        rules.push(
            `${fill.join(',')}{top:0!important;left:0!important;width:100%!important;height:100%!important;` +
                'background-size:cover!important;background-position:center center!important}',
        );
    }
    return rules.length ? `<style id="inv-images">${rules.join('')}</style>` : '';
}

/** Element ids of sections the couple switched off. Absent settings count as ON. */
function toggledOff(settings: Record<string, any>, ladi: LadiMap): string[] {
    const ids: string[] = [];
    for (const [path, hidden] of Object.entries(ladi.toggles ?? {})) {
        if (!dataGet(settings, path, true)) {
            ids.push(...(Array.isArray(hidden) ? hidden : [hidden]));
        }
    }
    return ids;
}

/** A settings value usable as a URL: a plain string, or an uploaded image (full size). */
function urlValue(settings: Record<string, any>, path: string): string | null {
    let val = dataGet(settings, path);
    if (val && typeof val === 'object') {
        val = val.full ?? val.web ?? null;
    }
    return typeof val === 'string' && val.trim() !== '' ? val.trim() : null;
}

/**
 * Point LadiPage video elements at the couple's own video. The runtime reads
 * the source ("ci") and player type ("ch") from the inline script_event_data
 * JSON when it boots, so this has to happen server-side.
 */
function applyVideo(html: string, ladi: LadiMap, settings: Record<string, any>): string {
    for (const [id, path] of Object.entries(ladi.video ?? {})) {
        const url = urlValue(settings, path);
        if (!url) continue;

        const type = /(youtube\.com|youtu\.be)/i.test(url) ? 'youtube' : 'direct';
        const re = new RegExp(`("${escapeRegExp(id)}"\\s*:\\s*\\{)([^{}]*)(\\})`);

        html = html.replace(re, (_m, open: string, inner: string, close: string) => {
            let b = inner.replace(/"ci"\s*:\s*"[^"]*"/, () => `"ci": ${JSON.stringify(url)}`);
            b = b.replace(/"ch"\s*:\s*"[^"]*"/, `"ch": "${type}"`);
            return open + b + close;
        });
    }
    return html;
}

/**
 * Turn a local wall-clock date ("2026-09-14T10:00") typed in the editor into an
 * ISO instant, interpreting it in `timeZone`. Strings with an explicit offset
 * are taken as-is. Returns null when unparseable.
 */
export function zonedIso(value: string, timeZone: string): string | null {
    const v = value.trim();
    if (/(?:z|[+-]\d{2}:?\d{2})$/i.test(v)) {
        const t = Date.parse(v);
        return Number.isNaN(t) ? null : new Date(t).toISOString();
    }

    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) {
        const t = Date.parse(v);
        return Number.isNaN(t) ? null : new Date(t).toISOString();
    }

    const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
    const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);

    // Offset of `timeZone` at that instant, via Intl.
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(asUtc));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const zoned = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));

    return new Date(asUtc - (zoned - asUtc)).toISOString();
}

function nonEmpty(settings: Record<string, any>, map: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, path] of Object.entries(map ?? {})) {
        const val = dataGet(settings, path);
        if (typeof val === 'string' && val.trim() !== '') out[id] = val.trim();
    }
    return out;
}

function buildConfig(settings: Record<string, any>, ladi: LadiMap, timezone: string): Record<string, any> {
    // text: element-id => value (kept verbatim, line breaks matter)
    const text: Record<string, string> = {};
    for (const [id, path] of Object.entries(ladi.text ?? {})) {
        const val = dataGet(settings, path);
        if (typeof val === 'string' && val !== '') text[id] = val;
    }

    // images: original filename => new url
    const images: Record<string, string> = {};
    for (const [filename, path] of Object.entries(ladi.images ?? {})) {
        const url = dataGet(settings, `${path}.web`) ?? dataGet(settings, `${path}.full`);
        if (url) images[filename] = url;
    }

    // Sections the couple switched off drop out of both the page and the menu.
    const hide = [...new Set([...(ladi.hide ?? []), ...toggledOff(settings, ladi)])];
    const nav = (ladi.nav ?? []).filter((item) => !hide.includes(item.section ?? ''));

    const links: Record<string, string> = {};
    for (const [id, path] of Object.entries(ladi.links ?? {})) {
        const url = urlValue(settings, path);
        if (url) links[id] = url;
    }

    const countdown: Record<string, string> = {};
    for (const [id, iso] of Object.entries(nonEmpty(settings, ladi.countdown))) {
        const at = zonedIso(iso, timezone);
        if (at) countdown[id] = at;
    }

    // Markers (calendar hearts): points as fractions of the picture box.
    const markers: { image: string; marker: string; points: { x: number; y: number }[] }[] = [];
    for (const [path, ids] of Object.entries(ladi.markers ?? {})) {
        const value = dataGet(settings, path);
        if (!Array.isArray(value)) continue;
        const points = value
            .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
            .filter((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
        markers.push({ ...ids, points });
    }

    const foods = String(dataGet(settings, 'rsvp.food_options', '') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    return {
        text,
        fit: ladi.fit ?? [],
        nav,
        hide,
        mapUrl: dataGet(settings, 'invite.map_url') ?? dataGet(settings, 'events.gai_map_url') ?? dataGet(settings, 'events.map_url') ?? null,
        images,
        colors: nonEmpty(settings, ladi.colors),
        inputs: nonEmpty(settings, ladi.inputs),
        links,
        copy: nonEmpty(settings, ladi.copy),
        countdown,
        markers,
        inert: ladi.inert ?? [],
        actions: ladi.actions ?? {},
        music: dataGet(settings, 'music.audio') ?? null,
        gallery: dataGet(settings, 'gallery.images', []) ?? [],
        sections: ladi.sections ?? {},
        blocks: {
            gallery: {
                heading: dataGet(settings, 'gallery.heading') ?? 'Album Ảnh',
                tagline: dataGet(settings, 'gallery.tagline') ?? null,
            },
            rsvp: {
                enabled: Boolean(dataGet(settings, 'rsvp.enabled', true)),
                heading: dataGet(settings, 'rsvp.heading') ?? 'Xác Nhận Tham Dự',
                intro: dataGet(settings, 'rsvp.intro') ?? null,
                foods,
            },
            guestbook: {
                enabled: Boolean(dataGet(settings, 'guestbook.enabled', true)),
                heading: dataGet(settings, 'guestbook.heading') ?? 'Gửi Lời Chúc',
                intro: dataGet(settings, 'guestbook.intro') ?? null,
            },
        },
    };
}

function seoData(invitation: RenderableInvitation, settings: Record<string, any>, origin: string): Seo {
    const couple = [dataGet(settings, 'hero.groom_name'), dataGet(settings, 'hero.bride_name')]
        .filter(Boolean)
        .join(' & ')
        .trim();

    const overrides = Object.fromEntries(
        Object.entries(invitation.seo ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
    );

    const seo = {
        title: invitation.title || couple || 'Thiệp cưới',
        description: dataGet(settings, 'hero.subtitle') ?? 'Trân trọng kính mời!',
        og_image: dataGet(settings, 'hero.background.web') ?? dataGet(settings, 'couple.groom_photo.web') ?? null,
        ...overrides,
    } as Seo;

    // Social crawlers need absolute URLs.
    if (seo.og_image) {
        try {
            seo.og_image = new URL(seo.og_image, origin).toString();
        } catch {
            seo.og_image = null;
        }
    }
    seo.url = `${origin.replace(/\/+$/, '')}/${invitation.slug}`;

    return seo;
}

function head(seo: Seo, opts: RenderOptions): string {
    const fav = escapeHtml(opts.favicon);
    let tags = `<link rel="icon" type="image/png" href="${fav}"><link rel="apple-touch-icon" href="${fav}">`;

    tags += `<meta name="description" content="${escapeHtml(seo.description)}">`;
    tags += `<meta property="og:type" content="website">`;
    tags += `<meta property="og:url" content="${escapeHtml(seo.url)}">`;
    tags += `<meta property="og:title" content="${escapeHtml(seo.title)}">`;
    tags += `<meta property="og:description" content="${escapeHtml(seo.description)}">`;
    if (seo.og_image) {
        tags += `<meta property="og:image" content="${escapeHtml(seo.og_image)}">`;
    }
    tags += `<meta name="twitter:card" content="summary_large_image">`;

    // Hide until hydration to avoid a flash of the template's demo content.
    tags += '<style id="__inv_guard">html{visibility:hidden}</style>';
    // Strip the LadiPage "Powered by" badge the runtime injects.
    tags += '<style>.ladipage_powered_by{display:none!important}</style>';

    return tags + opts.headTags;
}

function body(config: Record<string, any>): string {
    // If the hydration bundle fails to load, never leave the page hidden.
    const safety =
        '<script>setTimeout(function(){var g=document.getElementById("__inv_guard");' +
        'if(g)g.remove();document.documentElement.style.visibility="";},2000);</script>';

    return (
        '<div class="inv-hearts" id="inv-hearts" aria-hidden="true"></div>' +
        `<script>window.__INV__=${scriptJson(config)}</script>` +
        safety
    );
}
