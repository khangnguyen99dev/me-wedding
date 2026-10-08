<script setup lang="ts">
import { reactive } from 'vue';
import type { SectionDef } from '@/admin/lib/types';
import FieldRenderer from '@/admin/components/fields/FieldRenderer.vue';
import RepeaterField from '@/admin/components/fields/RepeaterField.vue';
import ImageGridPanel from '@/admin/components/fields/ImageGridPanel.vue';

const props = defineProps<{
    sections: Record<string, SectionDef>;
    modelValue: Record<string, any>;
}>();
const emit = defineEmits<{ 'update:modelValue': [Record<string, any>] }>();

const open = reactive<Record<string, boolean>>(
    Object.fromEntries(Object.keys(props.sections).map((k, i) => [k, i === 0])),
);

function section(key: string): Record<string, any> {
    return props.modelValue?.[key] ?? {};
}

function setField(sectionKey: string, fieldKey: string, value: any) {
    const next = { ...(props.modelValue ?? {}) };
    next[sectionKey] = { ...(next[sectionKey] ?? {}), [fieldKey]: value };
    emit('update:modelValue', next);
}

function setItems(sectionKey: string, items: any[]) {
    const next = { ...(props.modelValue ?? {}) };
    next[sectionKey] = { ...(next[sectionKey] ?? {}), items };
    emit('update:modelValue', next);
}

/** Group a section's fields by their optional `group` label, preserving order. */
function groupedFields(def: SectionDef) {
    const groups: { group: string; fields: { key: string; def: any }[] }[] = [];
    const index = new Map<string, number>();
    for (const [key, fieldDef] of Object.entries(def.fields ?? {})) {
        const g = fieldDef.group ?? '';
        if (!index.has(g)) {
            index.set(g, groups.length);
            groups.push({ group: g, fields: [] });
        }
        groups[index.get(g)!].fields.push({ key, def: fieldDef });
    }
    return groups;
}
</script>

<template>
    <div class="space-y-3">
        <div v-for="(def, key) in sections" :key="key" class="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <button type="button" class="flex w-full items-center justify-between px-4 py-3 text-left" @click="open[key] = !open[key]">
                <span class="font-semibold text-gray-800">{{ def.label }}</span>
                <span class="text-gray-400 transition" :class="{ 'rotate-180': open[key] }">⌄</span>
            </button>

            <div v-show="open[key]" class="space-y-5 border-t border-gray-100 px-4 py-4">
                <!-- auto image grid: replace any picture in the template -->
                <ImageGridPanel
                    v-if="def.ui === 'image_grid'"
                    :fields="def.fields ?? {}"
                    :values="section(key)"
                    @change="setField(key, $event.key, $event.value)"
                />

                <template v-else>
                    <!-- scalar fields, grouped -->
                    <div v-for="grp in groupedFields(def)" :key="grp.group" class="space-y-3">
                        <p v-if="grp.group" class="text-xs font-bold tracking-wide text-brand-600 uppercase">{{ grp.group }}</p>
                        <FieldRenderer
                            v-for="f in grp.fields"
                            :key="f.key"
                            :field="f.def"
                            :model-value="section(key)[f.key]"
                            @update:model-value="setField(key, f.key, $event)"
                        />
                    </div>

                    <!-- repeater -->
                    <div v-if="def.repeater" class="space-y-2">
                        <p class="text-sm font-semibold text-gray-700">{{ def.repeater.label ?? 'Danh sách' }}</p>
                        <RepeaterField
                            :item-fields="def.repeater.item_fields"
                            :item-label="def.repeater.item_label"
                            :model-value="section(key).items ?? []"
                            @update:model-value="setItems(key, $event)"
                        />
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>
