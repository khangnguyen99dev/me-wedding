<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useTemplatesStore } from '@/admin/stores/templates';
import { useInvitationsStore } from '@/admin/stores/invitations';
import { useToasts } from '@/admin/lib/toast';
import { errorMessage } from '@/admin/lib/supabase';
import Spinner from '@/admin/components/ui/Spinner.vue';

const templates = useTemplatesStore();
const invitations = useInvitationsStore();
const router = useRouter();
const toast = useToasts();

const selected = ref<string | null>(null);
const title = ref('');
const creating = ref(false);

async function create() {
    if (!selected.value) {
        toast.error('Vui lòng chọn một mẫu thiệp');
        return;
    }
    creating.value = true;
    try {
        const inv = await invitations.create({ template_key: selected.value, title: title.value || undefined });
        toast.success('Đã tạo thiệp mới');
        router.push({ name: 'invitations.edit', params: { id: inv.id } });
    } catch (e) {
        toast.error(errorMessage(e, 'Không thể tạo thiệp'));
    } finally {
        creating.value = false;
    }
}

onMounted(() => templates.fetchAll().catch((e) => toast.error(errorMessage(e, 'Không tải được danh sách mẫu'))));
</script>

<template>
    <div>
        <h1 class="text-2xl font-bold text-gray-900">Tạo thiệp mới</h1>
        <p class="mt-1 text-sm text-gray-500">Chọn một mẫu giao diện. Nội dung mẫu sẽ được điền sẵn để bạn chỉnh sửa.</p>

        <div class="mt-5 max-w-md">
            <label class="mb-1 block text-sm font-medium text-gray-600">Tên thiệp (tuỳ chọn)</label>
            <input v-model="title" placeholder="VD: Đám cưới Anh & Em" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
        </div>

        <Spinner v-if="templates.loading" label="Đang tải mẫu..." />

        <p v-else-if="templates.list.length === 0" class="mt-6 rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
            Chưa có mẫu nào. Hãy chạy <code>npm run templates:sync</code> và nạp SQL vào Supabase.
        </p>

        <div v-else class="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <button
                v-for="t in templates.list"
                :key="t.key"
                type="button"
                class="overflow-hidden rounded-xl border-2 bg-white text-left shadow-sm transition hover:shadow-md"
                :class="selected === t.key ? 'border-brand-600 ring-2 ring-brand-200' : 'border-transparent'"
                @click="selected = t.key"
            >
                <div class="aspect-[3/4] bg-gray-100">
                    <img v-if="t.thumbnail" :src="t.thumbnail" class="h-full w-full object-cover" :alt="t.name" />
                </div>
                <div class="p-4">
                    <div class="flex items-center justify-between">
                        <p class="font-semibold text-gray-900">{{ t.name }}</p>
                        <span v-if="selected === t.key" class="text-brand-600">✓</span>
                    </div>
                    <p class="mt-1 line-clamp-2 text-xs text-gray-500">{{ t.description }}</p>
                </div>
            </button>
        </div>

        <div class="mt-8 flex justify-end gap-3">
            <button class="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium hover:bg-gray-50" @click="router.back()">Huỷ</button>
            <button :disabled="!selected || creating" class="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50" @click="create">
                {{ creating ? 'Đang tạo...' : 'Tạo & chỉnh sửa →' }}
            </button>
        </div>
    </div>
</template>
