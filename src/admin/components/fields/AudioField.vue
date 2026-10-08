<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMediaContext } from '@/admin/lib/mediaContext';
import { useToasts } from '@/admin/lib/toast';
import type { MediaAudio } from '@/admin/lib/types';

const props = defineProps<{ modelValue: number | null }>();
const emit = defineEmits<{ 'update:modelValue': [number | null] }>();

const media = useMediaContext();
const toast = useToasts();
const uploading = ref(false);
const input = ref<HTMLInputElement | null>(null);

const current = computed(() => media.audioById(props.modelValue));

async function onPick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    uploading.value = true;
    try {
        const m = (await media.upload(file, 'audio')) as MediaAudio;
        emit('update:modelValue', m.id);
    } catch {
        toast.error('Tải nhạc thất bại');
    } finally {
        uploading.value = false;
        if (input.value) input.value.value = '';
    }
}
</script>

<template>
    <div class="space-y-2">
        <audio v-if="current" :src="current.url" controls class="h-9 w-full" />
        <div class="flex gap-2">
            <button type="button" class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50" :disabled="uploading" @click="input?.click()">
                {{ uploading ? 'Đang tải...' : current ? 'Đổi nhạc' : 'Tải nhạc (mp3)' }}
            </button>
            <button v-if="current" type="button" class="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50" @click="emit('update:modelValue', null)">Gỡ</button>
        </div>
        <input ref="input" type="file" accept="audio/*" class="hidden" @change="onPick" />
    </div>
</template>
