<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMediaContext } from '@/admin/lib/mediaContext';
import { useToasts } from '@/admin/lib/toast';
import type { FieldDef, MediaImage } from '@/admin/lib/types';

const props = defineProps<{
    fields: Record<string, FieldDef>;
    values: Record<string, unknown>;
}>();
const emit = defineEmits<{ change: [{ key: string; value: number | null }] }>();

const media = useMediaContext();
const toast = useToasts();
const query = ref('');
const busy = ref<string | null>(null);
const inputs = ref<Record<string, HTMLInputElement | null>>({});

const items = computed(() =>
    Object.entries(props.fields)
        .map(([key, def]) => ({ key, def }))
        .filter(({ def }) => !query.value || (def.label ?? '').toLowerCase().includes(query.value.toLowerCase())),
);

/** Uploaded replacement (if any) wins; otherwise show the shipped original. */
function preview(key: string, def: FieldDef): string {
    const id = props.values?.[key];
    const custom = typeof id === 'number' ? media.imageById(id) : null;
    return custom?.thumb ?? def.original ?? '';
}

function isReplaced(key: string): boolean {
    return typeof props.values?.[key] === 'number';
}

async function onPick(key: string, e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    busy.value = key;
    try {
        const m = (await media.upload(file, 'library')) as MediaImage;
        emit('change', { key, value: m.id });
    } catch {
        toast.error('Tải ảnh thất bại');
    } finally {
        busy.value = null;
        const el = inputs.value[key];
        if (el) el.value = '';
    }
}
</script>

<template>
    <div class="space-y-3">
        <div class="flex items-center gap-2">
            <input
                v-model="query"
                type="search"
                placeholder="Tìm ảnh theo tên..."
                class="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
            <span class="shrink-0 text-xs text-gray-400">{{ items.length }} ảnh</span>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div
                v-for="it in items"
                :key="it.key"
                class="overflow-hidden rounded-lg border"
                :class="isReplaced(it.key) ? 'border-brand-400 ring-1 ring-brand-200' : 'border-gray-200'"
            >
                <div class="relative aspect-square bg-gray-50">
                    <img :src="preview(it.key, it.def)" class="h-full w-full object-cover" loading="lazy" alt="" />
                    <span
                        v-if="isReplaced(it.key)"
                        class="absolute left-1 top-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-medium text-white"
                    >đã đổi</span>
                    <div
                        v-if="busy === it.key"
                        class="absolute inset-0 grid place-items-center bg-white/70 text-xs text-gray-600"
                    >Đang tải...</div>
                </div>
                <div class="flex items-center justify-between gap-1 px-2 py-1.5">
                    <button
                        type="button"
                        class="rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                        :disabled="busy === it.key"
                        @click="inputs[it.key]?.click()"
                    >Đổi ảnh</button>
                    <button
                        v-if="isReplaced(it.key)"
                        type="button"
                        class="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                        @click="emit('change', { key: it.key, value: null })"
                    >Khôi phục</button>
                </div>
                <input
                    :ref="(el) => (inputs[it.key] = el as HTMLInputElement | null)"
                    type="file"
                    accept="image/*"
                    class="hidden"
                    @change="(e) => onPick(it.key, e)"
                />
            </div>
        </div>
    </div>
</template>
