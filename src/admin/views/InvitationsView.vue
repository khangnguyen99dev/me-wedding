<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useInvitationsStore } from '@/admin/stores/invitations';
import { useToasts } from '@/admin/lib/toast';
import { useConfirm } from '@/admin/lib/confirm';
import Spinner from '@/admin/components/ui/Spinner.vue';
import { errorMessage } from '@/admin/lib/supabase';

const store = useInvitationsStore();
const router = useRouter();
const toast = useToasts();
const { confirm } = useConfirm();

const search = ref('');
const status = ref('');

const page = ref(1);
const coverBusy = ref<number | null>(null);
const coverInputs = ref<Record<number, HTMLInputElement | null>>({});

async function changeCover(id: number, file: File | null) {
    coverBusy.value = id;
    try {
        await store.setCover(id, file);
        toast.success(file ? 'Đã đổi ảnh đại diện' : 'Đã gỡ ảnh đại diện');
    } catch (e) {
        toast.error(errorMessage(e, 'Không đổi được ảnh'));
    } finally {
        coverBusy.value = null;
        const el = coverInputs.value[id];
        if (el) el.value = '';
    }
}

function load(p = 1) {
    page.value = p;
    store
        .fetchAll({ page: p, per_page: 12, search: search.value || undefined, status: status.value || undefined })
        .catch((e) => toast.error(errorMessage(e, 'Không tải được danh sách')));
}

async function togglePublish(id: number, current: string) {
    try {
        await store.setPublished(id, current !== 'published');
        toast.success(current === 'published' ? 'Đã chuyển về nháp' : 'Đã xuất bản');
    } catch {
        toast.error('Có lỗi xảy ra');
    }
}

async function duplicate(id: number) {
    try {
        const copy = await store.duplicate(id);
        toast.success('Đã nhân bản thiệp');
        router.push({ name: 'invitations.edit', params: { id: copy.id } });
    } catch (e) {
        toast.error(errorMessage(e, 'Không thể nhân bản'));
    }
}

async function remove(id: number, title: string) {
    const ok = await confirm({ title: 'Xoá thiệp mời?', message: `“${title}” cùng toàn bộ ảnh, lời chúc và xác nhận tham dự sẽ bị xoá vĩnh viễn.`, danger: true, confirmText: 'Xoá' });
    if (!ok) return;
    try {
        await store.remove(id);
        toast.success('Đã xoá thiệp');
    } catch (e) {
        toast.error(errorMessage(e, 'Không thể xoá'));
    }
}

onMounted(() => load());
</script>

<template>
    <div>
        <div class="flex flex-wrap items-center justify-between gap-3">
            <h1 class="text-2xl font-bold text-gray-900">Thiệp mời</h1>
            <RouterLink :to="{ name: 'invitations.create' }" class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                + Tạo thiệp mới
            </RouterLink>
        </div>

        <div class="mt-4 flex flex-wrap gap-3">
            <input v-model="search" placeholder="Tìm theo tiêu đề..." class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" @keyup.enter="load()" />
            <select v-model="status" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" @change="load()">
                <option value="">Tất cả trạng thái</option>
                <option value="published">Đã xuất bản</option>
                <option value="draft">Nháp</option>
            </select>
            <button class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50" @click="load()">Lọc</button>
        </div>

        <Spinner v-if="store.loading" label="Đang tải..." />

        <div v-else class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="inv in store.items" :key="inv.id" class="flex flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                <div class="group relative aspect-video bg-gray-100">
                    <img v-if="inv.cover || inv.template.thumbnail" :src="inv.cover || inv.template.thumbnail!" class="h-full w-full object-cover" alt="" />
                    <div
                        class="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition group-hover:opacity-100"
                        :class="{ 'opacity-100': coverBusy === inv.id }"
                    >
                        <span v-if="coverBusy === inv.id" class="text-xs font-medium text-white">Đang tải...</span>
                        <template v-else>
                            <button
                                type="button"
                                class="rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-white"
                                @click="coverInputs[inv.id]?.click()"
                            >Đổi ảnh</button>
                            <button
                                v-if="inv.cover"
                                type="button"
                                class="rounded-md bg-white/90 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-white"
                                title="Dùng lại ảnh của mẫu"
                                @click="changeCover(inv.id, null)"
                            >Gỡ</button>
                        </template>
                    </div>
                    <input
                        :ref="(el) => (coverInputs[inv.id] = el as HTMLInputElement | null)"
                        type="file"
                        accept="image/*"
                        class="hidden"
                        @change="(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) changeCover(inv.id, f); }"
                    />
                    <span class="absolute top-2 right-2 rounded-full px-2.5 py-1 text-xs font-medium" :class="inv.status === 'published' ? 'bg-emerald-600 text-white' : 'bg-gray-700/80 text-white'">
                        {{ inv.status === 'published' ? 'Đã xuất bản' : 'Nháp' }}
                    </span>
                </div>
                <div class="flex flex-1 flex-col p-4">
                    <p class="font-semibold text-gray-900">{{ inv.title }}</p>
                    <p class="text-xs text-gray-400">/{{ inv.slug }}</p>
                    <div class="mt-2 flex gap-3 text-xs text-gray-500">
                        <span>👁 {{ inv.view_count }}</span>
                        <span>✓ {{ inv.counts.rsvps }} RSVP</span>
                        <span>💬 {{ inv.counts.guestbook }}</span>
                    </div>

                    <div class="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3 text-sm">
                        <RouterLink :to="{ name: 'invitations.edit', params: { id: inv.id } }" class="rounded-md bg-brand-50 px-3 py-1.5 font-medium text-brand-700 hover:bg-brand-100">Sửa</RouterLink>
                        <RouterLink :to="{ name: 'invitations.guests', params: { id: inv.id } }" class="rounded-md px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-100">Khách</RouterLink>
                        <a :href="inv.public_url" target="_blank" class="rounded-md px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-100">Xem</a>
                        <button class="rounded-md px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-100" @click="togglePublish(inv.id, inv.status)">
                            {{ inv.status === 'published' ? 'Ẩn' : 'Xuất bản' }}
                        </button>
                        <button class="rounded-md px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-100" @click="duplicate(inv.id)">Nhân bản</button>
                        <button class="ml-auto rounded-md px-3 py-1.5 font-medium text-rose-600 hover:bg-rose-50" @click="remove(inv.id, inv.title)">Xoá</button>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="!store.loading && store.meta.last_page > 1" class="mt-6 flex items-center justify-center gap-3 text-sm">
            <button class="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" :disabled="page <= 1" @click="load(page - 1)">← Trước</button>
            <span class="text-gray-500">Trang {{ page }} / {{ store.meta.last_page }}</span>
            <button class="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" :disabled="page >= store.meta.last_page" @click="load(page + 1)">Sau →</button>
        </div>

        <p v-if="!store.loading && store.items.length === 0" class="mt-8 rounded-xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
            Không có thiệp nào.
        </p>
    </div>
</template>
