import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { supabase } from '@/admin/lib/supabase';
import type { User } from '@/admin/lib/types';

export const useAuthStore = defineStore('auth', () => {
    const user = ref<User | null>(null);
    const ready = ref(false);

    const isAuthenticated = computed(() => user.value !== null);
    const isAdmin = computed(() => user.value?.role === 'admin');

    async function loadProfile(id: string, email: string): Promise<void> {
        const { data } = await supabase.from('profiles').select('id, name, email, role').eq('id', id).maybeSingle();
        user.value = {
            id,
            email: data?.email ?? email,
            name: data?.name ?? email.split('@')[0],
            role: data?.role ?? 'editor',
        };
    }

    async function fetchUser(): Promise<void> {
        try {
            const { data } = await supabase.auth.getSession();
            const u = data.session?.user;
            if (u) await loadProfile(u.id, u.email ?? '');
            else user.value = null;
        } catch {
            user.value = null;
        } finally {
            ready.value = true;
        }
    }

    async function login(email: string, password: string): Promise<void> {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            throw new Error(error.message === 'Invalid login credentials' ? 'Email hoặc mật khẩu không đúng.' : error.message);
        }
        await loadProfile(data.user.id, data.user.email ?? email);
    }

    async function logout(): Promise<void> {
        try {
            await supabase.auth.signOut();
        } finally {
            user.value = null;
        }
    }

    // Session expired / signed out in another tab.
    supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') user.value = null;
    });

    return { user, ready, isAuthenticated, isAdmin, fetchUser, login, logout };
});
