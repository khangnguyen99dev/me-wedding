<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/admin/stores/auth';
import { useToasts } from '@/admin/lib/toast';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const toast = useToasts();

const email = ref('');
const password = ref('');
const loading = ref(false);

async function submit() {
    loading.value = true;
    try {
        await auth.login(email.value, password.value);
        const redirect = (route.query.redirect as string) || '/admin';
        router.push(redirect);
    } catch (e: any) {
        toast.error(e?.message ?? 'Đăng nhập thất bại');
    } finally {
        loading.value = false;
    }
}
</script>

<template>
    <div class="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 to-brand-100 p-4">
        <div class="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
            <div class="mb-6 text-center">
                <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-brand-600 text-2xl">💍</div>
                <h1 class="text-xl font-bold text-brand-700">Kane Wedding Admin</h1>
                <p class="mt-1 text-sm text-gray-400">Quản lý thiệp cưới online</p>
            </div>
            <form class="space-y-4" @submit.prevent="submit">
                <div>
                    <label class="mb-1 block text-sm font-medium text-gray-600">Email</label>
                    <input v-model="email" type="email" required class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none" />
                </div>
                <div>
                    <label class="mb-1 block text-sm font-medium text-gray-600">Mật khẩu</label>
                    <input v-model="password" type="password" required class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none" />
                </div>
                <button type="submit" :disabled="loading" class="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">
                    {{ loading ? 'Đang đăng nhập...' : 'Đăng nhập' }}
                </button>
            </form>
        </div>
    </div>
</template>
