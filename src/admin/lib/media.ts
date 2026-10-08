import type { MediaRow } from '@shared/types';
import type { MediaAudio, MediaImage } from '@/admin/lib/types';
import { MEDIA_BUCKET, assetUrl, supabase } from '@/admin/lib/supabase';

/*
 * Media pipeline (replaces Spatie Media Library + GD conversions):
 * images are resized to WebP in the browser ("web" ≤1920px, "thumb" ≤600px),
 * all variants go to Supabase Storage under {invitation_id}/{uuid}/..., and a
 * `media` row records their URLs. Settings reference media by row id.
 */

const IMAGE_MAX = 10 * 1024 * 1024;
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
        throw new Error(isAudio ? 'File nhạc tối đa 20MB.' : 'Ảnh tối đa 10MB.');
    }

    const dir = `${invitationId}/${crypto.randomUUID()}`;
    const paths: string[] = [];
    const row: Partial<MediaRow> = { invitation_id: invitationId, collection, name: file.name, alt: '' };

    try {
        const fullPath = `${dir}/original.${extension(file)}`;
        row.full_url = await put(fullPath, file, file.type);
        paths.push(fullPath);

        // GIFs keep their animation: no conversions.
        if (!isAudio && file.type !== 'image/gif') {
            const [web, thumb] = await Promise.all([resize(file, 1920), resize(file, 600, 0.8)]);
            if (web) {
                paths.push(`${dir}/web.webp`);
                row.web_url = await put(`${dir}/web.webp`, web, 'image/webp');
            }
            if (thumb) {
                paths.push(`${dir}/thumb.webp`);
                row.thumb_url = await put(`${dir}/thumb.webp`, thumb, 'image/webp');
            }
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
