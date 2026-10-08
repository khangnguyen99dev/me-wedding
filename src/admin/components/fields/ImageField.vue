<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMediaContext } from '@/admin/lib/mediaContext';
import { useToasts } from '@/admin/lib/toast';
import type { MediaImage } from '@/admin/lib/types';

const props = defineProps<{ modelValue: number | null }>();
const emit = defineEmits<{ 'update:modelValue': [number | null] }>();

const media = useMediaContext();
const toast = useToasts();
const uploading = ref(false);
const input = ref<HTMLInputElement | null>(null);

const current = computed(() => media.imageById(props.modelValue));

async function onPick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    uploading.value = true;
    try {
        const m = (await media.upload(file, 'library')) as MediaImage;
        emit('update:modelValue', m.id);
    } catch {
        toast.error('Tải ảnh thất bại');
    } finally {
        uploading.value = false;
        if (input.value) input.value.value = '';
    }
}
</script>

<template>
    <div class="flex items-center gap-3">
        <div class="grid h-16 w-16 place-items-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
            <img v-if="current" :src="current.thumb" class="h-full w-full object-cover" alt="" />
            <span v-else class="text-xs text-gray-300">No img</span>
        </div>
        <div class="flex gap-2">
            <button type="button" class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50" :disabled="uploading" @click="input?.click()">
                {{ uploading ? 'Đang tải...' : current ? 'Đổi ảnh' : 'Tải ảnh' }}
            </button>
            <button v-if="current" type="button" class="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50" @click="emit('update:modelValue', null)">
                Gỡ
            </button>
        </div>
        <input ref="input" type="file" accept="image/*" class="hidden" @change="onPick" />
    </div>
</template>
