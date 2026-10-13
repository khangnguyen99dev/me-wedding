/**
 * Types shared by the admin SPA, the Node renderer and the template sync script.
 */

export type FieldType =
    | 'text' | 'textarea' | 'richtext' | 'number'
    | 'image' | 'gallery' | 'audio'
    | 'color' | 'font' | 'select'
    | 'date' | 'datetime' | 'time'
    | 'boolean' | 'url' | 'map'
    | 'markers';

/** A single field definition from a template schema. */
export interface FieldDef {
    type: FieldType;
    label?: string;
    help?: string;
    required?: boolean;
    max?: number;
    default?: unknown;
    group?: string;
    options?: Array<{ value: string; label: string }>;
    /** markers: sibling image field (same section) the points sit on. */
    image?: string;
    /** markers: page element showing that image (its "Ảnh trong mẫu" slot can replace it too). */
    element?: string;
    /** markers: width / height of the page box that shows that image. */
    aspect?: number;
    /** custom_images grid / markers: the shipped image URL shown as the current value. */
    original?: string;
    /** custom_images grid: CSS selectors that paint this picture slot (desktop + mobile rules). */
    targets?: string[];
    /** custom_images grid: template file names this slot shows (a field bound to one of them wins over the slot). */
    files?: string[];
    /** custom_images grid: older per-file field keys whose stored value this slot inherits. */
    aliases?: string[];
    /** custom_images grid: pixel size of the shipped image (labels its placeholder). */
    width?: number;
    height?: number;
}

export interface RepeaterDef {
    label?: string;
    item_label?: string;
    item_fields: Record<string, FieldDef>;
}

export interface SectionDef {
    label: string;
    icon?: string;
    /** 'image_grid' renders fields as a replaceable-thumbnail grid. */
    ui?: string;
    fields?: Record<string, FieldDef>;
    repeater?: RepeaterDef;
}

/** The `ladipage` block of template.json: maps LadiPage element ids to settings paths. */
export interface LadiMap {
    sections?: { gallery?: string; rsvp?: string; guestbook?: string };
    hide?: string[];
    nav?: { label: string; section: string }[];
    fit?: string[];
    text?: Record<string, string>;
    images?: Record<string, string>;
    colors?: Record<string, string>;
    inputs?: Record<string, string>;
    links?: Record<string, string>;
    copy?: Record<string, string>;
    countdown?: Record<string, string>;
    video?: Record<string, string>;
    actions?: Record<string, 'rsvp' | 'guestbook' | 'gallery' | 'map'>;
    /**
     * Repeatable blocks (extra wedding events): each item of the repeater at `path`
     * becomes a copy of `block`, placed `step` px below the previous one inside `section`.
     * Maps are element id (inside the block) -> item field.
     */
    repeat?: Array<{
        path: string;
        section: string;
        block: string;
        step: number;
        text?: Record<string, string>;
        links?: Record<string, string>;
        images?: Record<string, string>;
        actions?: Record<string, 'rsvp' | 'guestbook' | 'gallery' | 'map'>;
    }>;
    /** element ids that must not react to clicks (the logo's demo lightbox, ...) */
    inert?: string[];
    /** settings path (markers field) -> picture element and the marker element placed on it */
    markers?: Record<string, { image: string; marker: string }>;
    /** settings path -> element id(s) hidden when that boolean is off */
    toggles?: Record<string, string | string[]>;
}

export interface TemplateManifest {
    key: string;
    name: string;
    version: string;
    engine?: 'ladipage';
    description?: string;
    thumbnail?: string;
    ladipage?: LadiMap;
    sections: Record<string, SectionDef>;
    theme: Record<string, string>;
    theme_schema?: Record<string, FieldDef>;
}

/** A row of the `media` table. */
export interface MediaRow {
    id: number;
    invitation_id?: number;
    collection: 'library' | 'audio';
    name: string;
    full_url: string;
    web_url: string | null;
    thumb_url: string | null;
    alt: string;
    storage_paths?: string[];
}

export interface ResolvedImage {
    id: number;
    thumb: string;
    web: string;
    full: string;
    alt: string;
}

/** The invitation fields the renderer needs. */
export interface RenderableInvitation {
    id: number;
    slug: string;
    title: string;
    locale?: string;
    template_key: string;
    settings: Record<string, any>;
    theme: Record<string, any>;
    seo: Record<string, any>;
}
