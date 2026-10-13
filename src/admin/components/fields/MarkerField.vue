<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue';
import { FormContextKey, useMediaContext } from '@/admin/lib/mediaContext';
import { REMOVED_IMAGE } from '@shared/settings';
import { findHighlightedDays } from '@/admin/lib/calendar';
import type { FieldDef } from '@/admin/lib/types';

type Point = { x: number; y: number };

const props = defineProps<{
    field: FieldDef;
    modelValue: Point[] | null | undefined;
    /** Values of the other fields in the same section (to find the picture). */
    siblings?: Record<string, any>;
}>();
const emit = defineEmits<{ 'update:modelValue': [Point[] | null] }>();

const media = useMediaContext();
const detecting = ref(false);
const note = ref('');

const form = inject(FormContextKey, null);

/**
 * What the page actually shows in that box: a replacement made in "Ảnh trong mẫu"
 * (its CSS wins on the page), else the image field, else the template's picture.
 */
const slotValue = computed(() => {
    const el = props.field.element;
    const fields = form?.sections().custom_images?.fields ?? {};
    const key = el && Object.keys(fields).find((k) => fields[k].targets?.some((t) => t.startsWith(`#${el}>`) || t.startsWith(`#${el} `)));
    return key ? form?.settings().custom_images?.[key] : undefined;
});
const imageId = computed(() => {
    if (typeof slotValue.value === 'number') return slotValue.value;
    return props.field.image ? props.siblings?.[props.field.image] : null;
});
const imageUrl = computed(() =>
    slotValue.value === REMOVED_IMAGE ? '' : (media.imageById(imageId.value)?.web ?? props.field.original ?? ''),
);
const boxStyle = computed(() => ({
    aspectRatio: String(props.field.aspect ?? 1),
    backgroundImage: imageUrl.value ? `url(${JSON.stringify(imageUrl.value)})` : undefined,
}));
const isDefault = computed(() => !Array.isArray(props.modelValue));
const points = computed<Point[]>(() =>
    Array.isArray(props.modelValue) ? props.modelValue : ((props.field.default as Point[] | undefined) ?? []),
);

function add(e: MouseEvent) {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
    emit('update:modelValue', [...points.value, { x: round((e.clientX - box.left) / box.width), y: round((e.clientY - box.top) / box.height) }]);
    note.value = '';
}

function remove(i: number) {
    emit('update:modelValue', points.value.filter((_, j) => j !== i));
}

async function detect() {
    if (!imageUrl.value) return;
    detecting.value = true;
    note.value = '';
    try {
        const found = await findHighlightedDays(imageUrl.value, props.field.aspect ?? 1);
        if (found.length) {
            emit('update:modelValue', found);
            note.value = `Đã đặt trái tim vào ${found.length} ngày được tô.`;
        } else {
            note.value = 'Không tìm thấy ngày được tô — hãy bấm lên ảnh để đặt trái tim.';
        }
    } catch {
        note.value = 'Không đọc được ảnh — hãy bấm lên ảnh để đặt trái tim.';
    } finally {
        detecting.value = false;
    }
}

// A new calendar picture: find its highlighted day(s) straight away.
watch(imageId, (id, old) => {
    if (id && id !== old) void detect();
});

// Hearts never placed but the couple's own calendar is in: place them now
// (otherwise they'd sit where the TEMPLATE's calendar had its date).
onMounted(() => {
    const own = media.imageById(imageId.value);
    if (isDefault.value && own && !own.web.includes('/templates/')) void detect();
});
</script>

<template>
    <div class="space-y-2">
        <div
            class="relative w-full cursor-crosshair overflow-hidden rounded-lg border border-gray-200 bg-gray-50 bg-cover bg-center"
            :style="boxStyle"
            @click="add"
        >
            <button
                v-for="(p, i) in points"
                :key="i"
                type="button"
                class="absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 transition hover:scale-110"
                :class="isDefault ? 'opacity-50' : ''"
                :style="{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }"
                title="Bấm để gỡ trái tim này"
                @click.stop="remove(i)"
            >
                <svg viewBox="0 0 24 24" class="h-full w-full drop-shadow" fill="none" stroke="#f06464" stroke-width="2">
                    <path d="M12 21s-7.5-4.6-9.5-9.3C1 8 3.3 4.5 6.9 4.5c2 0 3.5 1.1 5.1 3 1.6-1.9 3.1-3 5.1-3 3.6 0 5.9 3.5 4.4 7.2C19.5 16.4 12 21 12 21z" />
                </svg>
            </button>
        </div>

        <div class="flex flex-wrap gap-2">
            <button
                type="button"
                class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-60"
                :disabled="detecting || !imageUrl"
                @click="detect"
            >{{ detecting ? 'Đang tìm...' : 'Tự tìm ngày được tô' }}</button>
            <button
                v-if="points.length"
                type="button"
                class="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                @click="emit('update:modelValue', [])"
            >Gỡ hết trái tim</button>
            <button
                v-if="!isDefault"
                type="button"
                class="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
                @click="emit('update:modelValue', null)"
            >Về vị trí mẫu</button>
        </div>
        <p v-if="note" class="text-xs text-brand-700">{{ note }}</p>
    </div>
</template>
