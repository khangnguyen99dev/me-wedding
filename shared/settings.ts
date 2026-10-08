import type { MediaRow, ResolvedImage, SectionDef } from './types';

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
            resolved[key] = field(f.type ?? 'text', raw[key], f.default);
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
            if (key in sec) sec[key] = map(f.type, sec[key]);
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
