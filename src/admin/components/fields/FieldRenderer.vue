<script setup lang="ts">
import { computed } from 'vue';
import type { FieldDef } from '@/admin/lib/types';
import ImageField from './ImageField.vue';
import GalleryField from './GalleryField.vue';
import AudioField from './AudioField.vue';

const props = defineProps<{ field: FieldDef; modelValue: any }>();
const emit = defineEmits<{ 'update:modelValue': [any] }>();

const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none';

const model = computed({
    get: () => props.modelValue,
    set: (v) => emit('update:modelValue', v),
});

// datetime-local needs "YYYY-MM-DDTHH:mm"
const dtLocal = computed({
    get: () => (props.modelValue ? String(props.modelValue).slice(0, 16) : ''),
    set: (v) => emit('update:modelValue', v),
});

const isBoolean = computed(() => props.field.type === 'boolean');
</script>

<template>
    <div class="space-y-1.5">
        <label v-if="field.label && !isBoolean" class="block text-sm font-medium text-gray-700">
            {{ field.label }}
        </label>

        <!-- text / url / map -->
        <input v-if="['text', 'url', 'map'].includes(field.type)" v-model="model" :type="field.type === 'url' ? 'url' : 'text'" :maxlength="field.max" :class="inputClass" />

        <!-- number -->
        <input v-else-if="field.type === 'number'" v-model.number="model" type="number" :class="inputClass" />

        <!-- textarea / richtext -->
        <textarea v-else-if="['textarea', 'richtext'].includes(field.type)" v-model="model" :maxlength="field.max" rows="3" :class="inputClass" />

        <!-- select / font -->
        <select v-else-if="['select', 'font'].includes(field.type)" v-model="model" :class="inputClass">
            <option v-for="opt in field.options ?? []" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>

        <!-- color -->
        <div v-else-if="field.type === 'color'" class="flex items-center gap-2">
            <input v-model="model" type="color" class="h-9 w-12 cursor-pointer rounded border border-gray-300" />
            <input v-model="model" type="text" :class="inputClass" />
        </div>

        <!-- date / time / datetime -->
        <input v-else-if="field.type === 'date'" v-model="model" type="date" :class="inputClass" />
        <input v-else-if="field.type === 'time'" v-model="model" type="time" :class="inputClass" />
        <input v-else-if="field.type === 'datetime'" v-model="dtLocal" type="datetime-local" :class="inputClass" />

        <!-- boolean -->
        <label v-else-if="isBoolean" class="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input v-model="model" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
            {{ field.label }}
        </label>

        <!-- media -->
        <ImageField v-else-if="field.type === 'image'" v-model="model" />
        <GalleryField v-else-if="field.type === 'gallery'" v-model="model" />
        <AudioField v-else-if="field.type === 'audio'" v-model="model" />

        <!-- fallback -->
        <input v-else v-model="model" type="text" :class="inputClass" />

        <p v-if="field.help" class="text-xs text-gray-400">{{ field.help }}</p>
    </div>
</template>
