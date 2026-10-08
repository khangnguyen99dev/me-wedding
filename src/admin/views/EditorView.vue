<script setup lang="ts">
import { computed, onMounted, provide, reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { errorMessage, supabase } from '@/admin/lib/supabase';
import { toMediaAudio, toMediaImage, uploadMedia } from '@/admin/lib/media';
import { useInvitationsStore } from '@/admin/stores/invitations';
import { useTemplatesStore } from '@/admin/stores/templates';
import { useToasts } from '@/admin/lib/toast';
import { MediaContextKey, type MediaContext } from '@/admin/lib/mediaContext';
import type { Invitation, MediaAudio, MediaImage, Template } from '@/admin/lib/types';
import DynamicForm from '@/admin/components/DynamicForm.vue';
import FieldRenderer from '@/admin/components/fields/FieldRenderer.vue';
import Spinner from '@/admin/components/ui/Spinner.vue';

const props = defineProps<{ id: string }>();
const store = useInvitationsStore();
const toast = useToasts();

const invitation = ref<Invitation | null>(null);
const template = ref<Template | null>(null);
const loading = ref(true);
const saving = ref(false);
const previewHtml = ref('');
type Tab = 'content' | 'theme' | 'seo' | 'settings';
const tab = ref<Tab>('content');

const working = reactive({
    title: '',
    slug: '',
    locale: 'vi',
    settings: {} as Record<string, any>,
    theme: {} as Record<string, any>,
    seo: { title: '', description: '' } as Record<string, any>,
});

// ---- Media context (provided to image/gallery/audio fields) ----
const images = ref<Record<number, MediaImage>>({});
const audio = ref<Record<number, MediaAudio>>({});

const mediaCtx: MediaContext = {
    invitationId: Number(props.id),
    images,
    audio,
    imageById: (id) => (id ? images.value[id] : undefined),
    audioById: (id) => (id ? audio.value[id] : undefined),
    async upload(file, collection) {
        try {
            const row = await uploadMedia(Number(props.id), file, collection);
            if (collection === 'audio') {
                const m = toMediaAudio(row);
                audio.value[m.id] = m;
                return m;
            }
            const m = toMediaImage(row);
            images.value[m.id] = m;
            return m;
        } catch (e) {
            toast.error(errorMessage(e, 'Tải tệp thất bại'));
            throw e;
        }
    },
};
provide(MediaContextKey, mediaCtx);

async function load() {
    loading.value = true;
    try {
        const inv = await store.fetchOne(props.id);
        invitation.value = inv;
        template.value = await useTemplatesStore().fetchOne(inv.template.key);

        working.title = inv.title;
        working.slug = inv.slug;
        working.locale = inv.locale;
        working.settings = JSON.parse(JSON.stringify(inv.settings ?? {}));
        working.theme = { ...(template.value?.theme ?? {}), ...(inv.theme ?? {}) };
        working.seo = { title: inv.seo?.title ?? '', description: inv.seo?.description ?? '' };

        images.value = Object.fromEntries(inv.media.images.map((m) => [m.id, m]));
        audio.value = Object.fromEntries(inv.media.audio.map((m) => [m.id, m]));

        await pushPreview();
    } catch (e) {
        toast.error(errorMessage(e, 'Không tải được thiệp'));
    } finally {
        loading.value = false;
    }
}

// ---- Live preview: debounced render of the unsaved draft by the Node server ----
let timer: ReturnType<typeof setTimeout> | undefined;
function schedulePreview() {
    clearTimeout(timer);
    timer = setTimeout(pushPreview, 500);
}

async function pushPreview() {
    try {
        const { data } = await supabase.auth.getSession();
        const res = await fetch(`/api/preview/${props.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
            body: JSON.stringify({ settings: working.settings, theme: working.theme }),
        });
        if (res.ok) previewHtml.value = await res.text();
    } catch {
        /* preview failures are non-fatal */
    }
}

watch([() => working.settings, () => working.theme], schedulePreview, { deep: true });

async function save() {
    saving.value = true;
    try {
        const inv = await store.update(props.id, {
            title: working.title,
            slug: working.slug,
            locale: working.locale,
            settings: working.settings,
            theme: working.theme,
            seo: working.seo,
        } as Partial<Invitation>);
        invitation.value = inv;
        working.slug = inv.slug;
        toast.success('Đã lưu thay đổi');
    } catch (e) {
        toast.error(errorMessage(e, 'Lưu thất bại'));
    } finally {
        saving.value = false;
    }
}

async function togglePublish() {
    if (!invitation.value) return;
    const publish = invitation.value.status !== 'published';
    try {
        const inv = await store.setPublished(invitation.value.id, publish);
        invitation.value.status = inv.status;
        toast.success(publish ? 'Đã xuất bản' : 'Đã ẩn');
    } catch (e) {
        toast.error(errorMessage(e));
    }
}

const tabs = computed<{ key: Tab; label: string }[]>(() => {
    const hasTheme = template.value && Object.keys(template.value.theme_schema ?? {}).length > 0;
    return [
        { key: 'content', label: 'Nội dung' },
        ...(hasTheme ? [{ key: 'theme' as const, label: 'Giao diện' }] : []),
        { key: 'seo', label: 'SEO' },
        { key: 'settings', label: 'Cài đặt' },
    ];
});

onMounted(load);
</script>

<template>
    <Spinner v-if="loading" label="Đang tải trình soạn thảo..." />

    <div v-else-if="invitation && template" class="grid gap-6 lg:grid-cols-[460px_1fr]">
        <!-- Editor panel -->
        <div class="flex max-h-[88vh] flex-col">
            <div class="mb-3 flex items-center justify-between">
                <RouterLink :to="{ name: 'invitations' }" class="text-sm text-gray-500 hover:text-gray-700">← Danh sách</RouterLink>
                <div class="flex items-center gap-2">
                    <button class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50" @click="togglePublish">
                        {{ invitation.status === 'published' ? 'Ẩn' : 'Xuất bản' }}
                    </button>
                    <button :disabled="saving" class="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60" @click="save">
                        {{ saving ? 'Đang lưu...' : 'Lưu' }}
                    </button>
                </div>
            </div>

            <!-- Tabs -->
            <div class="mb-3 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
                <button v-for="t in tabs" :key="t.key" class="flex-1 rounded-md px-3 py-1.5 font-medium transition" :class="tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500'" @click="tab = t.key">
                    {{ t.label }}
                </button>
            </div>

            <div class="flex-1 overflow-y-auto pr-1">
                <!-- Content -->
                <DynamicForm v-if="tab === 'content'" v-model="working.settings" :sections="template.sections" />

                <!-- Theme -->
                <div v-else-if="tab === 'theme'" class="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                    <FieldRenderer
                        v-for="(def, key) in template.theme_schema"
                        :key="key"
                        :field="def"
                        :model-value="working.theme[key]"
                        @update:model-value="working.theme[key] = $event"
                    />
                </div>

                <!-- SEO -->
                <div v-else-if="tab === 'seo'" class="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                    <div class="space-y-1.5">
                        <label class="block text-sm font-medium text-gray-700">Tiêu đề trang (SEO)</label>
                        <input v-model="working.seo.title" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="block text-sm font-medium text-gray-700">Mô tả (SEO)</label>
                        <textarea v-model="working.seo.description" rows="3" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
                    </div>
                </div>

                <!-- Settings -->
                <div v-else class="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                    <div class="space-y-1.5">
                        <label class="block text-sm font-medium text-gray-700">Tên thiệp</label>
                        <input v-model="working.title" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
                    </div>
                    <div class="space-y-1.5">
                        <label class="block text-sm font-medium text-gray-700">Đường dẫn (slug)</label>
                        <div class="flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm">
                            <span class="text-gray-400">/</span>
                            <input v-model="working.slug" class="w-full focus:outline-none" />
                        </div>
                    </div>
                    <div class="flex flex-col gap-2">
                        <a :href="invitation.public_url" target="_blank" class="text-sm text-brand-600 hover:underline">Mở trang công khai ↗</a>
                        <RouterLink :to="{ name: 'invitations.guests', params: { id } }" class="text-sm text-brand-600 hover:underline">Quản lý khách mời & lời chúc →</RouterLink>
                    </div>
                </div>
            </div>
        </div>

        <!-- Live preview -->
        <div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
                <span class="text-sm font-medium text-gray-600">Xem trước trực tiếp</span>
                <span class="text-xs text-gray-400">{{ invitation.status === 'published' ? 'Đã xuất bản' : 'Bản nháp' }}</span>
            </div>
            <iframe :srcdoc="previewHtml" class="h-[82vh] w-full" title="preview" />
        </div>
    </div>
</template>
