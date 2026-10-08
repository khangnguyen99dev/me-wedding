<script setup lang="ts">
import { computed } from 'vue';
import type { FieldDef } from '@/admin/lib/types';
import FieldRenderer from './FieldRenderer.vue';

const props = defineProps<{
    itemFields: Record<string, FieldDef>;
    modelValue: Record<string, any>[] | null;
    itemLabel?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [Record<string, any>[]] }>();

const list = computed<Record<string, any>[]>(() => props.modelValue ?? []);

function emitList(next: Record<string, any>[]) {
    emit('update:modelValue', next);
}

function blankItem(): Record<string, any> {
    const item: Record<string, any> = {};
    for (const [key, def] of Object.entries(props.itemFields)) {
        item[key] = def.default ?? (def.type === 'gallery' ? [] : def.type === 'boolean' ? false : '');
    }
    return item;
}

function addItem() {
    emitList([...list.value, blankItem()]);
}

function removeItem(index: number) {
    emitList(list.value.filter((_, i) => i !== index));
}

function move(index: number, dir: -1 | 1) {
    const next = [...list.value];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    emitList(next);
}

function setField(index: number, key: string, value: any) {
    const next = list.value.map((item, i) => (i === index ? { ...item, [key]: value } : item));
    emitList(next);
}
</script>

<template>
    <div class="space-y-3">
        <div v-for="(item, index) in list" :key="index" class="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
            <div class="mb-3 flex items-center justify-between">
                <span class="text-xs font-semibold tracking-wide text-gray-400 uppercase">{{ itemLabel ?? 'Mục' }} {{ index + 1 }}</span>
                <div class="flex items-center gap-1">
                    <button type="button" class="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-200 hover:text-gray-700" :disabled="index === 0" @click="move(index, -1)">↑</button>
                    <button type="button" class="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-200 hover:text-gray-700" :disabled="index === list.length - 1" @click="move(index, 1)">↓</button>
                    <button type="button" class="rounded px-2 py-1 text-xs text-rose-500 hover:bg-rose-100" @click="removeItem(index)">Xoá</button>
                </div>
            </div>
            <div class="space-y-3">
                <FieldRenderer
                    v-for="(def, key) in itemFields"
                    :key="key"
                    :field="def"
                    :model-value="item[key]"
                    @update:model-value="setField(index, key as string, $event)"
                />
            </div>
        </div>

        <button type="button" class="w-full rounded-lg border border-dashed border-gray-300 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50" @click="addItem">
            + Thêm {{ (itemLabel ?? 'mục').toLowerCase() }}
        </button>
    </div>
</template>
