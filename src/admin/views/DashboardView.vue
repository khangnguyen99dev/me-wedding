<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { useInvitationsStore } from '@/admin/stores/invitations';
import { useAuthStore } from '@/admin/stores/auth';

const store = useInvitationsStore();
const auth = useAuthStore();

const published = computed(() => store.items.filter((i) => i.status === 'published').length);
const totalViews = computed(() => store.items.reduce((s, i) => s + i.view_count, 0));
const totalRsvps = computed(() => store.items.reduce((s, i) => s + (i.counts?.rsvps ?? 0), 0));

onMounted(() => store.fetchAll({ per_page: 50 }));
</script>

<template>
    <div>
        <h1 class="text-2xl font-bold text-gray-900">Xin chào, {{ auth.user?.name }} 👋</h1>
        <p class="mt-1 text-sm text-gray-500">Tổng quan các thiệp cưới của bạn.</p>

        <div class="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <p class="text-sm text-gray-400">Tổng số thiệp</p>
                <p class="mt-1 text-3xl font-bold text-brand-700">{{ store.meta.total }}</p>
            </div>
            <div class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <p class="text-sm text-gray-400">Đã xuất bản</p>
                <p class="mt-1 text-3xl font-bold text-emerald-600">{{ published }}</p>
            </div>
            <div class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <p class="text-sm text-gray-400">Lượt xem</p>
                <p class="mt-1 text-3xl font-bold text-gray-900">{{ totalViews }}</p>
            </div>
            <div class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <p class="text-sm text-gray-400">Xác nhận tham dự</p>
                <p class="mt-1 text-3xl font-bold text-gray-900">{{ totalRsvps }}</p>
            </div>
        </div>

        <div class="mt-8 flex items-center justify-between">
            <h2 class="text-lg font-semibold text-gray-900">Thiệp gần đây</h2>
            <RouterLink :to="{ name: 'invitations.create' }" class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                + Tạo thiệp mới
            </RouterLink>
        </div>

        <div class="mt-4 grid gap-3">
            <RouterLink
                v-for="inv in store.items.slice(0, 6)"
                :key="inv.id"
                :to="{ name: 'invitations.edit', params: { id: inv.id } }"
                class="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition hover:shadow-md"
            >
                <div class="flex items-center gap-3">
                    <img v-if="inv.template.thumbnail" :src="inv.template.thumbnail" class="h-12 w-12 rounded-lg object-cover" alt="" />
                    <div>
                        <p class="font-medium text-gray-900">{{ inv.title }}</p>
                        <p class="text-xs text-gray-400">/{{ inv.slug }} · {{ inv.template.name }}</p>
                    </div>
                </div>
                <span class="rounded-full px-2.5 py-1 text-xs font-medium" :class="inv.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'">
                    {{ inv.status === 'published' ? 'Đã xuất bản' : 'Nháp' }}
                </span>
            </RouterLink>
            <p v-if="!store.loading && store.items.length === 0" class="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
                Chưa có thiệp nào. Hãy tạo thiệp đầu tiên!
            </p>
        </div>
    </div>
</template>
