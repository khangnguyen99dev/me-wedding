<script setup lang="ts">
import { computed, ref } from 'vue';
import draggable from 'vuedraggable';
import { useMediaContext } from '@/admin/lib/mediaContext';
import { useToasts } from '@/admin/lib/toast';
import type { MediaImage } from '@/admin/lib/types';

const props = defineProps<{ modelValue: number[] | null }>();
const emit = defineEmits<{ 'update:modelValue': [number[]] }>();

const media = useMediaContext();
const toast = useToasts();
const uploading = ref(false);
const input = ref<HTMLInputElement | null>(null);

const list = computed<number[]>({
    get: () => props.modelValue ?? [],
    set: (v) => emit('update:modelValue', v),
});

async function onPick(e: Event) {
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    if (!files.length) return;
    uploading.value = true;
    try {
        const ids: number[] = [];
        for (const file of files) {
            const m = (await media.upload(file, 'library')) as MediaImage;
            ids.push(m.id);
        }
        emit('update:modelValue', [...list.value, ...ids]);
    } catch {
        toast.error('Tải ảnh thất bại');
    } finally {
        uploading.value = false;
        if (input.value) input.value.value = '';
    }
}

function remove(id: number) {
    emit('update:modelValue', list.value.filter((x) => x !== id));
}
</script>

<template>
    <div>
        <draggable v-model="list" :item-key="(el: number) => el" :animation="150" class="grid grid-cols-3 gap-2 sm:grid-cols-4">
            <template #item="{ element: id }">
                <div class="group relative aspect-square cursor-move overflow-hidden rounded-lg border border-gray-200">
                    <img v-if="media.imageById(id)" :src="media.imageById(id)!.thumb" class="h-full w-full object-cover" alt="" />
                    <button
                        type="button"
                        class="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs text-white opacity-0 transition group-hover:opacity-100"
                        @click="remove(id)"
                    >
                        ×
                    </button>
                </div>
            </template>
        </draggable>

        <button type="button" class="mt-2 rounded-lg border border-dashed border-gray-300 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50" :disabled="uploading" @click="input?.click()">
            {{ uploading ? 'Đang tải...' : '+ Thêm ảnh' }}
        </button>
        <input ref="input" type="file" accept="image/*" multiple class="hidden" @change="onPick" />
    </div>
</template>
