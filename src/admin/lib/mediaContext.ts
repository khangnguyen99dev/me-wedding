import { inject, type InjectionKey, type Ref } from 'vue';
import type { MediaAudio, MediaImage, SectionDef } from '@/admin/lib/types';

export interface MediaContext {
    invitationId: number;
    images: Ref<Record<number, MediaImage>>;
    audio: Ref<Record<number, MediaAudio>>;
    upload(file: File, collection: 'library' | 'audio'): Promise<MediaImage | MediaAudio>;
    imageById(id: number | null | undefined): MediaImage | undefined;
    audioById(id: number | null | undefined): MediaAudio | undefined;
}

/** The whole content form (sections schema + current settings), for cross-section fields. */
export interface FormContext {
    sections(): Record<string, SectionDef>;
    settings(): Record<string, any>;
}

export const FormContextKey: InjectionKey<FormContext> = Symbol('form-context');

export const MediaContextKey: InjectionKey<MediaContext> = Symbol('media-context');

export function useMediaContext(): MediaContext {
    const ctx = inject(MediaContextKey);
    if (!ctx) {
        throw new Error('MediaContext not provided');
    }
    return ctx;
}
