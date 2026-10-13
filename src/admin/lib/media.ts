import type { MediaRow } from '@shared/types';
import type { MediaAudio, MediaImage } from '@/admin/lib/types';
import { MEDIA_BUCKET, assetUrl, supabase } from '@/admin/lib/supabase';

/*
 * Media pipeline (replaces Spatie Media Library + GD conversions):
 * images are resized to WebP in the browser ("web" ≤1920px, "thumb" ≤600px),
 * stored in Supabase Storage under {invitation_id}/{uuid}/..., and a `media`
 * row records their URLs. Settings reference media by row id.
 *
 * Storage is tight, so the full-size original is NOT kept: "web" doubles as
 * "full" (only GIFs and files the browser cannot decode are stored as-is).
 * A file identical to an earlier upload of this invitation (same content hash)
 * reuses that row instead of uploading again, and rows the settings no longer reference
 * are deleted on save (see pruneMedia).
 */

const IMAGE_MAX = 50 * 1024 * 1024;
const AUDIO_MAX = 20 * 1024 * 1024;
const AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/x-m4a', 'audio/mp4'];

export function toMediaImage(m: MediaRow): MediaImage {
    return {
        id: m.id,
        name: m.name,
        thumb: assetUrl(m.thumb_url || m.full_url),
        web: assetUrl(m.web_url || m.full_url),
        full: assetUrl(m.full_url),
        alt: m.alt ?? '',
    };
}

export function toMediaAudio(m: MediaRow): MediaAudio {
    return { id: m.id, name: m.name, url: assetUrl(m.full_url) };
}

/** Downscale (never upscale) to fit `max`×`max`, re-encoded as WebP. */
async function resize(file: File, max: number, quality = 0.85): Promise<Blob | null> {
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', quality));
    } catch {
        return null; // undecodable (e.g. exotic format): fall back to the original
    }
}

/** First 16 hex chars of the file's SHA-256 (identifies identical uploads). */
async function sha256(file: File): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

function extension(file: File): string {
    const fromName = file.name.split('.').pop()?.toLowerCase();
    return fromName && /^[a-z0-9]{2,5}$/.test(fromName) ? fromName : 'bin';
}

async function put(path: string, body: Blob, contentType: string): Promise<string> {
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, body, {
        contentType,
        cacheControl: '31536000',
        upsert: false,
    });
    if (error) throw error;
    return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadMedia(invitationId: number, file: File, collection: 'library' | 'audio'): Promise<MediaRow> {
    const isAudio = collection === 'audio';

    if (isAudio && !AUDIO_TYPES.includes(file.type)) throw new Error('Chỉ hỗ trợ file nhạc mp3, wav, ogg, m4a.');
    if (!isAudio && !file.type.startsWith('image/')) throw new Error('File không phải hình ảnh.');
    if (file.size > (isAudio ? AUDIO_MAX : IMAGE_MAX)) {
        throw new Error(isAudio ? 'File nhạc tối đa 20MB.' : 'Ảnh tối đa 50MB.');
    }

    // The very same file was uploaded to this invitation before: reuse it, no new
    // upload. Matched by CONTENT (SHA-256 in the storage folder name), not by
    // name — calendar exports etc. often reuse one file name for new pictures.
    const hash = await sha256(file);
    const { data: rows } = await supabase
        .from('media')
        .select('*')
        .eq('invitation_id', invitationId)
        .eq('collection', collection)
        .neq('storage_paths', '{}')
        .order('id', { ascending: false });
    const same = (rows ?? []).find((m) => (m.storage_paths as string[]).some((p) => p.startsWith(`${invitationId}/${hash}-`)));
    if (same) return same as MediaRow;

    const dir = `${invitationId}/${hash}-${crypto.randomUUID().slice(0, 8)}`;
    const paths: string[] = [];
    const row: Partial<MediaRow> = { invitation_id: invitationId, collection, name: file.name, alt: '' };

    try {
        // GIFs keep their animation: no conversions.
        const [web, thumb] =
            isAudio || file.type === 'image/gif'
                ? [null, null]
                : await Promise.all([resize(file, 1920), resize(file, 600, 0.8)]);

        if (web) {
            paths.push(`${dir}/web.webp`);
            row.web_url = await put(`${dir}/web.webp`, web, 'image/webp');
            row.full_url = row.web_url;
        } else {
            const fullPath = `${dir}/original.${extension(file)}`;
            paths.push(fullPath);
            row.full_url = await put(fullPath, file, file.type);
        }
        if (thumb) {
            paths.push(`${dir}/thumb.webp`);
            row.thumb_url = await put(`${dir}/thumb.webp`, thumb, 'image/webp');
        }

        row.storage_paths = paths;
        const { data, error } = await supabase.from('media').insert(row).select().single();
        if (error) throw error;
        return data as MediaRow;
    } catch (e) {
        if (paths.length) await supabase.storage.from(MEDIA_BUCKET).remove(paths);
        throw e;
    }
}

/** Remove storage objects owned by these media rows (rows themselves cascade or are deleted by the caller). */
export async function removeStorage(rows: Pick<MediaRow, 'storage_paths'>[]): Promise<void> {
    const paths = rows.flatMap((r) => r.storage_paths ?? []);
    for (let i = 0; i < paths.length; i += 100) {
        await supabase.storage.from(MEDIA_BUCKET).remove(paths.slice(i, i + 100));
    }
}

/**
 * Delete this invitation's media rows (and their files) that none of the given
 * settings snapshots reference. Returns how many rows were removed.
 */
export async function pruneMedia(invitationId: number, keep: Set<number>): Promise<number> {
    const { data, error } = await supabase.from('media').select('id, storage_paths').eq('invitation_id', invitationId);
    if (error) throw error;

    const unused = (data ?? []).filter((m) => !keep.has(Number(m.id)));
    if (!unused.length) return 0;

    await removeStorage(unused);
    const { error: dErr } = await supabase.from('media').delete().in('id', unused.map((m) => m.id));
    if (dErr) throw dErr;
    return unused.length;
}

/**
 * Remove storage folders under {invitation_id}/ that no media row owns
 * (left behind by interrupted uploads or failed clean-ups). Returns files removed.
 */
export async function pruneOrphanFiles(invitationId: number): Promise<number> {
    const bucket = supabase.storage.from(MEDIA_BUCKET);
    const { data: rows, error } = await supabase.from('media').select('storage_paths').eq('invitation_id', invitationId);
    if (error) throw error;
    const owned = new Set((rows ?? []).flatMap((r) => (r.storage_paths ?? []) as string[]));

    const { data: folders, error: lErr } = await bucket.list(String(invitationId), { limit: 1000 });
    if (lErr) throw lErr;

    const orphans: string[] = [];
    for (const f of folders ?? []) {
        const dir = `${invitationId}/${f.name}`;
        const { data: files } = await bucket.list(dir, { limit: 100 });
        for (const file of files ?? []) {
            const path = `${dir}/${file.name}`;
            if (!owned.has(path)) orphans.push(path);
        }
    }

    for (let i = 0; i < orphans.length; i += 100) {
        const { error: rErr } = await bucket.remove(orphans.slice(i, i + 100));
        if (rErr) throw rErr;
    }
    return orphans.length;
}
