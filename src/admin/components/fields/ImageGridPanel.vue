<script setup lang="ts">
import { computed, ref } from 'vue';
import { useMediaContext } from '@/admin/lib/mediaContext';
import { useToasts } from '@/admin/lib/toast';
import type { FieldDef, MediaImage } from '@/admin/lib/types';
import { REMOVED_IMAGE, fieldValue, placeholderImage } from '@shared/settings';

const props = defineProps<{
    fields: Record<string, FieldDef>;
    values: Record<string, unknown>;
}>();
type Value = number | typeof REMOVED_IMAGE | null;
const emit = defineEmits<{ change: [{ key: string; value: Value; clear: string[] }] }>();

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

/** Uploaded replacement (if any) wins, then a removed picture's placeholder, then the shipped original. */
function preview(key: string, def: FieldDef): string {
    const id = value(key);
    if (isRemoved(key)) return placeholderImage(def.width, def.height);
    const custom = typeof id === 'number' ? media.imageById(id) : null;
    return custom?.thumb ?? def.original ?? '';
}

/** Stored value, including one saved under a variant's old key. */
function value(key: string): unknown {
    return fieldValue(props.values, key, props.fields[key]);
}

function isReplaced(key: string): boolean {
    return typeof value(key) === 'number';
}

function isRemoved(key: string): boolean {
    return value(key) === REMOVED_IMAGE;
}

/** Set a picture; values left under its variants' old keys are cleared so they cannot win back. */
function set(key: string, v: Value) {
    emit('change', { key, value: v, clear: props.fields[key]?.aliases ?? [] });
}

async function onPick(key: string, e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    busy.value = key;
    try {
        const m = (await media.upload(file, 'library')) as MediaImage;
        set(key, m.id);
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
                :class="isReplaced(it.key) ? 'border-brand-400 ring-1 ring-brand-200' : isRemoved(it.key) ? 'border-dashed border-gray-300' : 'border-gray-200'"
            >
                <div class="relative aspect-square bg-gray-50">
                    <img :src="preview(it.key, it.def)" class="h-full w-full object-cover" loading="lazy" alt="" />
                    <span
                        v-if="isReplaced(it.key)"
                        class="absolute left-1 top-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-medium text-white"
                    >đã đổi</span>
                    <span
                        v-else-if="isRemoved(it.key)"
                        class="absolute left-1 top-1 rounded bg-gray-500 px-1.5 py-0.5 text-[10px] font-medium text-white"
                    >đã xoá</span>
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
                        v-if="isReplaced(it.key) || isRemoved(it.key)"
                        type="button"
                        class="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                        @click="set(it.key, null)"
                    >Khôi phục</button>
                    <button
                        v-else
                        type="button"
                        class="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                        title="Thay ảnh mẫu bằng khung trống có ghi kích thước"
                        @click="set(it.key, REMOVED_IMAGE)"
                    >Xoá</button>
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
