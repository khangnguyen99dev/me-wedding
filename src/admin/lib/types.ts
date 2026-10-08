export type { FieldDef, RepeaterDef, SectionDef } from '@shared/types';
import type { FieldDef, SectionDef } from '@shared/types';

export interface User {
    id: string;
    name: string;
    email: string;
    role: 'admin' | 'editor';
}

export interface Template {
    key: string;
    name: string;
    version: string;
    description?: string | null;
    thumbnail?: string | null;
    status: string;
    sections: Record<string, SectionDef>;
    theme: Record<string, string>;
    theme_schema: Record<string, FieldDef>;
}

export interface MediaImage {
    id: number;
    name: string;
    thumb: string;
    web: string;
    full: string;
    alt: string;
}

export interface MediaAudio {
    id: number;
    name: string;
    url: string;
}

export interface Invitation {
    id: number;
    title: string;
    slug: string;
    status: 'draft' | 'published';
    published_at: string | null;
    view_count: number;
    locale: string;
    template: { key: string; name: string };
    settings: Record<string, any>;
    theme: Record<string, any>;
    seo: Record<string, any>;
    public_url: string;
    media: { images: MediaImage[]; audio: MediaAudio[] };
    created_at: string;
    updated_at: string;
}

export interface InvitationListItem {
    id: number;
    title: string;
    slug: string;
    status: 'draft' | 'published';
    published_at: string | null;
    view_count: number;
    public_url: string;
    template: { key: string | null; name: string | null; thumbnail: string | null };
    counts: { rsvps: number; guestbook: number };
    updated_at: string;
}

export interface PageMeta {
    current_page: number;
    last_page: number;
    total: number;
    per_page: number;
}
