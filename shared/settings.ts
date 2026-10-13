import type { FieldDef, MediaRow, ResolvedImage, SectionDef } from './types';

/** Read a nested value with dot notation ("story.items.0.title"), like Laravel's data_get. */
export function dataGet(target: unknown, path: string, fallback?: unknown): any {
    let cur: any = target;
    for (const seg of path.split('.')) {
        if (cur == null || typeof cur !== 'object' || !(seg in cur)) {
            return fallback;
        }
        cur = cur[seg];
    }
    return cur === undefined ? fallback : cur;
}

/**
 * Prefix site-relative template asset paths (/templates/...) with an optional
 * CDN base. Absolute URLs (Supabase Storage, external) pass through untouched.
 */
export function assetUrl(url: string, base = ''): string {
    if (!base || !url.startsWith('/templates/')) {
        return url;
    }
    return base.replace(/\/+$/, '') + url;
}

export function toImage(m: MediaRow, base = ''): ResolvedImage {
    return {
        id: m.id,
        thumb: assetUrl(m.thumb_url || m.full_url, base),
        web: assetUrl(m.web_url || m.full_url, base),
        full: assetUrl(m.full_url, base),
        alt: m.alt ?? '',
    };
}

/** A field's stored value, falling back to its pre-grouping alias keys (custom_images). */
export function fieldValue(raw: Record<string, any> | null | undefined, key: string, def: FieldDef): unknown {
    const own = raw?.[key];
    if (own != null || !def.aliases) return own;
    for (const alias of def.aliases) if (raw?.[alias] != null) return raw[alias];
    return own;
}

/**
 * Walk a template's section schema and turn the raw settings JSON into a
 * render-ready tree: media-id references become URL objects, galleries become
 * ordered lists of images, audio becomes a URL. The schema `default` stands in
 * for never-filled fields, so older invitations keep rendering as intended.
 */
export function resolveSettings(
    sections: Record<string, SectionDef>,
    settings: Record<string, any>,
    media: MediaRow[],
    base = '',
): Record<string, any> {
    const images = new Map<number, MediaRow>();
    const audio = new Map<number, MediaRow>();
    for (const m of media) {
        (m.collection === 'audio' ? audio : images).set(Number(m.id), m);
    }

    const image = (id: unknown): ResolvedImage | null => {
        const m = id ? images.get(Number(id)) : undefined;
        return m ? toImage(m, base) : null;
    };

    const field = (type: string, value: unknown, fallback: unknown): unknown => {
        const v = value ?? fallback ?? null;
        switch (type) {
            case 'image':
                return image(v);
            case 'gallery':
                return (Array.isArray(v) ? v : []).map(image).filter(Boolean);
            case 'audio': {
                const m = v ? audio.get(Number(v)) : undefined;
                return m ? assetUrl(m.full_url, base) : null;
            }
            case 'boolean':
                return Boolean(v);
            default:
                return v;
        }
    };

    const out: Record<string, any> = {};

    for (const [sectionKey, def] of Object.entries(sections ?? {})) {
        const raw = (settings?.[sectionKey] ?? {}) as Record<string, any>;
        const resolved: Record<string, any> = {};

        for (const [key, f] of Object.entries(def.fields ?? {})) {
            resolved[key] = field(f.type ?? 'text', fieldValue(raw, key, f), f.default);
        }

        const itemFields = def.repeater?.item_fields;
        if (itemFields) {
            resolved.items = (Array.isArray(raw.items) ? raw.items : []).map((item: Record<string, any>) => {
                const r: Record<string, any> = {};
                for (const [key, f] of Object.entries(itemFields)) {
                    r[key] = field(f.type ?? 'text', item?.[key], f.default);
                }
                return r;
            });
        }

        out[sectionKey] = resolved;
    }

    return out;
}

/**
 * Walk the schema and remap media ids (image/gallery/audio fields only), so
 * non-media integers like guest counts are never touched. Used by duplicate.
 */
export function remapMediaIds(
    sections: Record<string, SectionDef>,
    settings: Record<string, any>,
    idMap: Map<number, number>,
): Record<string, any> {
    const out = JSON.parse(JSON.stringify(settings ?? {}));
    const map = (type: string, value: any) => {
        if ((type === 'image' || type === 'audio') && value != null) {
            return idMap.get(Number(value)) ?? value;
        }
        if (type === 'gallery' && Array.isArray(value)) {
            return value.map((id) => idMap.get(Number(id)) ?? id);
        }
        return value;
    };

    for (const [sectionKey, def] of Object.entries(sections ?? {})) {
        const sec = out[sectionKey];
        if (!sec || typeof sec !== 'object') continue;

        for (const [key, f] of Object.entries(def.fields ?? {})) {
            for (const k of [key, ...(f.aliases ?? [])]) {
                if (k in sec) sec[k] = map(f.type, sec[k]);
            }
        }

        const itemFields = def.repeater?.item_fields;
        if (itemFields && Array.isArray(sec.items)) {
            for (const item of sec.items) {
                for (const [key, f] of Object.entries(itemFields)) {
                    if (item && key in item) item[key] = map(f.type, item[key]);
                }
            }
        }
    }

    return out;
}

/** custom_images value meaning "the couple removed this template picture": a placeholder is shown instead. */
export const REMOVED_IMAGE = 'none';

/**
 * Grey placeholder as an SVG data URI, labelled with the picture's size
 * ("1200 × 800") so the couple knows what to upload. Costs no storage.
 */
export function placeholderImage(width?: number, height?: number): string {
    const w = width && width > 0 ? Math.round(width) : 800;
    const h = height && height > 0 ? Math.round(height) : 600;
    const label = width && height ? `${w} × ${h}` : 'Ảnh';
    const size = Math.max(12, Math.round(Math.min(w, h) / 8));
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<rect width="100%" height="100%" fill="#e5e7eb"/>` +
        `<text x="50%" y="50%" fill="#9ca3af" font-family="sans-serif" font-size="${size}" ` +
        `text-anchor="middle" dominant-baseline="central">${label}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Ids of every media row the settings point at (image/gallery/audio fields only). */
export function referencedMediaIds(sections: Record<string, SectionDef>, settings: Record<string, any>): Set<number> {
    const ids = new Set<number>();
    const add = (type: string, value: unknown) => {
        const list = type === 'gallery' && Array.isArray(value) ? value : type === 'image' || type === 'audio' ? [value] : [];
        for (const v of list) {
            const n = Number(v);
            if (v != null && v !== '' && Number.isInteger(n) && n > 0) ids.add(n);
        }
    };

    for (const [sectionKey, def] of Object.entries(sections ?? {})) {
        const sec = settings?.[sectionKey];
        if (!sec || typeof sec !== 'object') continue;

        for (const [key, f] of Object.entries(def.fields ?? {})) add(f.type, fieldValue(sec, key, f));

        const itemFields = def.repeater?.item_fields;
        if (itemFields && Array.isArray(sec.items)) {
            for (const item of sec.items) {
                for (const [key, f] of Object.entries(itemFields)) add(f.type, item?.[key]);
            }
        }
    }

    return ids;
}
