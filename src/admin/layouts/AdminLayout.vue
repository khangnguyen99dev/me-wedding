<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { useAuthStore } from '@/admin/stores/auth';

const auth = useAuthStore();
const router = useRouter();

const nav = [
    { name: 'dashboard', label: 'Tổng quan', icon: '◆' },
    { name: 'invitations', label: 'Thiệp mời', icon: '✉' },
    { name: 'invitations.create', label: 'Tạo thiệp mới', icon: '＋' },
];

async function logout() {
    await auth.logout();
    router.push({ name: 'login' });
}
</script>

<template>
    <div class="flex min-h-screen bg-gray-50 text-gray-800">
        <!-- Sidebar -->
        <aside class="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-gray-200 bg-white md:flex">
            <div class="flex h-16 items-center gap-2 border-b border-gray-100 px-6">
                <span class="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">💍</span>
                <span class="text-lg font-bold text-brand-700">Kane Wedding</span>
            </div>
            <nav class="flex-1 space-y-1 p-4">
                <RouterLink
                    v-for="item in nav"
                    :key="item.name"
                    :to="{ name: item.name }"
                    class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-brand-50 hover:text-brand-700"
                    active-class="bg-brand-50 text-brand-700"
                >
                    <span class="w-4 text-center">{{ item.icon }}</span>
                    {{ item.label }}
                </RouterLink>
            </nav>
            <div class="border-t border-gray-100 p-4">
                <div class="mb-2 px-1 text-sm">
                    <p class="font-medium text-gray-800">{{ auth.user?.name }}</p>
                    <p class="text-xs text-gray-400">{{ auth.user?.email }}</p>
                </div>
                <button class="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-600 hover:bg-rose-50" @click="logout">
                    Đăng xuất
                </button>
            </div>
        </aside>

        <!-- Main -->
        <div class="flex-1 md:ml-64">
            <header class="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6 md:hidden">
                <span class="font-bold text-brand-700">Kane Wedding</span>
                <button class="text-sm text-rose-600" @click="logout">Đăng xuất</button>
            </header>
            <main class="p-6">
                <RouterView />
            </main>
        </div>
    </div>
</template>
