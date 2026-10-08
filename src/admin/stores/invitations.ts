import { defineStore } from 'pinia';
import { ref } from 'vue';
import { remapMediaIds } from '@shared/settings';
import type { MediaRow, SectionDef } from '@shared/types';
import { MEDIA_BUCKET, assetUrl, publicUrl, slugify, supabase } from '@/admin/lib/supabase';
import { removeStorage, toMediaAudio, toMediaImage } from '@/admin/lib/media';
import type { Invitation, InvitationListItem, PageMeta } from '@/admin/lib/types';

const LIST_COLUMNS =
    'id, title, slug, status, published_at, view_count, updated_at, template_key, ' +
    'templates(name, thumbnail), rsvps(count), guestbook_messages(count)';

function toListItem(row: any): InvitationListItem {
    return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        status: row.status,
        published_at: row.published_at,
        view_count: row.view_count,
        public_url: publicUrl(row.slug),
        template: {
            key: row.template_key,
            name: row.templates?.name ?? null,
            thumbnail: row.templates?.thumbnail ? assetUrl(row.templates.thumbnail) : null,
        },
        counts: { rsvps: row.rsvps?.[0]?.count ?? 0, guestbook: row.guestbook_messages?.[0]?.count ?? 0 },
        updated_at: row.updated_at,
    };
}

function toInvitation(row: any): Invitation {
    const media: MediaRow[] = [...(row.media ?? [])].sort((a, b) => a.id - b.id);
    return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        status: row.status,
        published_at: row.published_at,
        view_count: row.view_count,
        locale: row.locale,
        template: { key: row.template_key, name: row.templates?.name ?? row.template_key },
        settings: row.settings ?? {},
        theme: row.theme ?? {},
        seo: row.seo ?? {},
        public_url: publicUrl(row.slug),
        media: {
            images: media.filter((m) => m.collection === 'library').map(toMediaImage),
            audio: media.filter((m) => m.collection === 'audio').map(toMediaAudio),
        },
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

async function uniqueSlug(base: string, ignoreId?: number): Promise<string> {
    const { data, error } = await supabase.rpc('unique_slug', {
        p_base: slugify(base) || 'thiep-cuoi',
        p_ignore_id: ignoreId ?? null,
    });
    if (error) throw error;
    return data as string;
}

/**
 * Replace preview.json "@image:file.jpg" / "@audio:song.mp3" placeholders with
 * media rows pointing at the template's bundled demo assets (no upload needed:
 * they are served from /templates/{key}/...). Repeated references share a row.
 */
async function importPreview(invitationId: number, templateKey: string, preview: any): Promise<any> {
    const wanted = new Map<string, { collection: 'library' | 'audio'; file: string }>();
    const collect = (v: any): void => {
        if (Array.isArray(v)) v.forEach(collect);
        else if (v && typeof v === 'object') Object.values(v).forEach(collect);
        else if (typeof v === 'string' && /^@(image|audio):/.test(v)) {
            const collection = v.startsWith('@image:') ? 'library' : 'audio';
            wanted.set(v, { collection, file: v.slice(7) });
        }
    };
    collect(preview);

    const ids = new Map<string, number>();
    if (wanted.size) {
        const rows = [...wanted.entries()].map(([, w]) => {
            const url = `/templates/${templateKey}/${w.collection === 'library' ? 'images' : 'media'}/${w.file}`;
            return { invitation_id: invitationId, collection: w.collection, name: w.file, full_url: url, web_url: url, thumb_url: url };
        });
        const { data, error } = await supabase.from('media').insert(rows).select('id, collection, name');
        if (error) throw error;
        for (const m of data ?? []) {
            ids.set(`${m.collection === 'library' ? '@image:' : '@audio:'}${m.name}`, m.id);
        }
    }

    const replace = (v: any): any => {
        if (Array.isArray(v)) return v.map(replace);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x)]));
        if (typeof v === 'string' && ids.has(v)) return ids.get(v);
        return v;
    };
    return replace(preview);
}

export const useInvitationsStore = defineStore('invitations', () => {
    const items = ref<InvitationListItem[]>([]);
    const meta = ref<PageMeta>({ current_page: 1, last_page: 1, total: 0, per_page: 12 });
    const loading = ref(false);

    async function fetchAll(params: { page?: number; per_page?: number; search?: string; status?: string } = {}): Promise<void> {
        loading.value = true;
        try {
            const perPage = params.per_page ?? 12;
            const page = Math.max(1, params.page ?? 1);
            // RLS already limits editors to their own invitations; admins see all.
            let q = supabase
                .from('invitations')
                .select(LIST_COLUMNS, { count: 'exact' })
                .order('created_at', { ascending: false })
                .range((page - 1) * perPage, page * perPage - 1);
            if (params.status) q = q.eq('status', params.status);
            if (params.search) q = q.ilike('title', `%${params.search.replace(/[%_]/g, '\\$&')}%`);

            const { data, error, count } = await q;
            if (error) throw error;
            items.value = (data ?? []).map(toListItem);
            const total = count ?? 0;
            meta.value = { current_page: page, last_page: Math.max(1, Math.ceil(total / perPage)), total, per_page: perPage };
        } finally {
            loading.value = false;
        }
    }

    async function fetchOne(id: number | string): Promise<Invitation> {
        const { data, error } = await supabase
            .from('invitations')
            .select('*, templates(name), media(*)')
            .eq('id', Number(id))
            .single();
        if (error) throw error;
        return toInvitation(data);
    }

    /** Create from a template, pre-filled with its demo content (preview.json). */
    async function create(payload: { template_key: string; title?: string }): Promise<Invitation> {
        const { data: tpl, error: tErr } = await supabase
            .from('templates')
            .select('key, preview, manifest')
            .eq('key', payload.template_key)
            .eq('status', 'active')
            .single();
        if (tErr || !tpl) throw new Error('Mẫu thiệp không tồn tại hoặc đã bị tắt.');

        const { data: auth } = await supabase.auth.getUser();
        const title = payload.title?.trim() || 'Thiệp cưới';

        let inv: { id: number } | null = null;
        for (let attempt = 0; attempt < 3 && !inv; attempt++) {
            const { data, error } = await supabase
                .from('invitations')
                .insert({ user_id: auth.user?.id, template_key: tpl.key, title, slug: await uniqueSlug(title), settings: {} })
                .select('id')
                .single();
            if (error && error.code !== '23505') throw error; // 23505 = slug taken meanwhile: retry
            inv = data;
        }
        if (!inv) throw new Error('Không thể tạo đường dẫn cho thiệp, vui lòng thử lại.');

        const preview = (tpl.preview ?? {}) as { settings?: any; theme?: any };
        const settings = await importPreview(inv.id, tpl.key, preview.settings ?? {});
        const { error: uErr } = await supabase
            .from('invitations')
            .update({ settings, theme: preview.theme ?? (tpl.manifest as any)?.theme ?? {} })
            .eq('id', inv.id);
        if (uErr) throw uErr;

        return fetchOne(inv.id);
    }

    async function update(id: number | string, payload: Partial<Invitation>): Promise<Invitation> {
        const patch: Record<string, unknown> = {};
        for (const key of ['title', 'locale', 'settings', 'theme', 'seo'] as const) {
            if (payload[key] !== undefined) patch[key] = payload[key];
        }
        if (payload.slug) {
            const current = await supabase.from('invitations').select('slug').eq('id', Number(id)).single();
            if (current.data?.slug !== payload.slug) patch.slug = await uniqueSlug(payload.slug, Number(id));
        }

        const { error } = await supabase.from('invitations').update(patch).eq('id', Number(id));
        if (error) throw error;
        return fetchOne(id);
    }

    async function remove(id: number): Promise<void> {
        // Storage first: once the invitation row is gone, storage RLS no longer lets us delete its files.
        const { data: media } = await supabase.from('media').select('storage_paths').eq('invitation_id', id);
        await removeStorage(media ?? []);

        const { error } = await supabase.from('invitations').delete().eq('id', id);
        if (error) throw error;
        items.value = items.value.filter((i) => i.id !== id);
        meta.value.total = Math.max(0, meta.value.total - 1);
    }

    /** Copy an invitation as a new draft, including its uploaded files (remapping media ids). */
    async function duplicate(id: number): Promise<Invitation> {
        const { data: src, error } = await supabase
            .from('invitations')
            .select('*, templates(manifest), media(*)')
            .eq('id', id)
            .single();
        if (error) throw error;

        const { data: auth } = await supabase.auth.getUser();
        const { data: copy, error: cErr } = await supabase
            .from('invitations')
            .insert({
                user_id: auth.user?.id,
                template_key: src.template_key,
                title: `${src.title} (Bản sao)`.slice(0, 120),
                slug: await uniqueSlug(src.slug),
                locale: src.locale,
                settings: {},
                theme: src.theme,
                seo: src.seo,
            })
            .select('id')
            .single();
        if (cErr) throw cErr;

        const idMap = new Map<number, number>();
        const bucket = supabase.storage.from(MEDIA_BUCKET);

        for (const m of (src.media ?? []) as MediaRow[]) {
            const row: Record<string, unknown> = {
                invitation_id: copy.id,
                collection: m.collection,
                name: m.name,
                alt: m.alt,
                full_url: m.full_url,
                web_url: m.web_url,
                thumb_url: m.thumb_url,
                storage_paths: [] as string[],
            };

            // Uploaded files get their own copies so either invitation can be deleted safely.
            if (m.storage_paths?.length) {
                const dir = `${copy.id}/${crypto.randomUUID()}`;
                const paths: string[] = [];
                for (const from of m.storage_paths) {
                    const to = `${dir}/${from.split('/').pop()}`;
                    const { error: e } = await bucket.copy(from, to);
                    if (e) throw e;
                    paths.push(to);
                    const [oldUrl, newUrl] = [bucket.getPublicUrl(from).data.publicUrl, bucket.getPublicUrl(to).data.publicUrl];
                    for (const col of ['full_url', 'web_url', 'thumb_url']) {
                        if (row[col] === oldUrl) row[col] = newUrl;
                    }
                }
                row.storage_paths = paths;
            }

            const { data: created, error: mErr } = await supabase.from('media').insert(row).select('id').single();
            if (mErr) throw mErr;
            idMap.set(m.id, created.id);
        }

        const sections = ((src.templates as any)?.manifest?.sections ?? {}) as Record<string, SectionDef>;
        const { error: uErr } = await supabase
            .from('invitations')
            .update({ settings: remapMediaIds(sections, src.settings ?? {}, idMap) })
            .eq('id', copy.id);
        if (uErr) throw uErr;

        return fetchOne(copy.id);
    }

    async function setPublished(id: number, publish: boolean): Promise<Invitation> {
        const { error } = await supabase
            .from('invitations')
            .update({ status: publish ? 'published' : 'draft' })
            .eq('id', id);
        if (error) throw error;
        const updated = await fetchOne(id);
        const row = items.value.find((i) => i.id === id);
        if (row) row.status = updated.status;
        return updated;
    }

    return { items, meta, loading, fetchAll, fetchOne, create, update, remove, duplicate, setPublished };
});
