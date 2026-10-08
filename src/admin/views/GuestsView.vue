<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/admin/lib/supabase';
import { useToasts } from '@/admin/lib/toast';
import Spinner from '@/admin/components/ui/Spinner.vue';

const props = defineProps<{ id: string }>();
const toast = useToasts();

const tab = ref<'rsvp' | 'guestbook'>('rsvp');
const loading = ref(true);
const rsvps = ref<any[]>([]);
const stats = ref({ attending_guests: 0, rsvp_count: 0 });
const messages = ref<any[]>([]);
let channel: RealtimeChannel | null = null;
const invitationId = Number(props.id);

const attendanceLabel: Record<string, string> = { yes: 'Tham dự', no: 'Vắng', maybe: 'Chưa chắc' };

async function loadRsvps() {
    const { data, error } = await supabase
        .from('rsvps')
        .select('id, name, phone, guest_count, attendance, food_option, notes, created_at')
        .eq('invitation_id', invitationId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    rsvps.value = data ?? [];
    stats.value = {
        attending_guests: rsvps.value.filter((r) => r.attendance === 'yes').reduce((s, r) => s + r.guest_count, 0),
        rsvp_count: rsvps.value.length,
    };
}
async function loadGuestbook() {
    const { data, error } = await supabase
        .from('guestbook_messages')
        .select('id, name, message, emoji, status, created_at')
        .eq('invitation_id', invitationId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    messages.value = data ?? [];
}

async function moderate(mid: number, status: string) {
    try {
        const { error } = await supabase.from('guestbook_messages').update({ status }).eq('id', mid);
        if (error) throw error;
        const m = messages.value.find((x) => x.id === mid);
        if (m) m.status = status;
        toast.success('Đã cập nhật');
    } catch {
        toast.error('Lỗi cập nhật');
    }
}
async function removeMessage(mid: number) {
    try {
        const { error } = await supabase.from('guestbook_messages').delete().eq('id', mid);
        if (error) throw error;
        messages.value = messages.value.filter((x) => x.id !== mid);
        toast.success('Đã xoá');
    } catch {
        toast.error('Lỗi xoá');
    }
}

onMounted(async () => {
    try {
        await Promise.all([loadRsvps(), loadGuestbook()]);
    } catch {
        toast.error('Không tải được danh sách khách');
    } finally {
        loading.value = false;
    }
    // Realtime (best-effort): database triggers broadcast on "invitation:{id}".
    channel = supabase
        .channel(`invitation:${invitationId}`)
        .on('broadcast', { event: 'guestbook' }, ({ payload }) => {
            if (!messages.value.some((m) => m.id === payload.id)) messages.value.unshift({ ...payload, status: 'approved' });
        })
        .on('broadcast', { event: 'rsvp' }, ({ payload }) => {
            stats.value.attending_guests = payload.attending_guests;
            stats.value.rsvp_count = payload.rsvp_count;
            loadRsvps().catch(() => {});
        })
        .subscribe();
});

onUnmounted(() => {
    if (channel) supabase.removeChannel(channel);
});
</script>

<template>
    <div>
        <div class="mb-4 flex items-center justify-between">
            <h1 class="text-2xl font-bold text-gray-900">Khách mời</h1>
            <RouterLink :to="{ name: 'invitations.edit', params: { id } }" class="text-sm text-gray-500 hover:text-gray-700">← Soạn thảo</RouterLink>
        </div>

        <div class="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
            <button class="flex-1 rounded-md px-3 py-1.5 font-medium" :class="tab === 'rsvp' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500'" @click="tab = 'rsvp'">
                Xác nhận tham dự
            </button>
            <button class="flex-1 rounded-md px-3 py-1.5 font-medium" :class="tab === 'guestbook' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500'" @click="tab = 'guestbook'">
                Lời chúc
            </button>
        </div>

        <Spinner v-if="loading" />

        <!-- RSVP -->
        <div v-else-if="tab === 'rsvp'">
            <div class="mb-4 flex gap-4">
                <div class="rounded-xl border border-gray-100 bg-white px-5 py-3 shadow-sm">
                    <p class="text-xs text-gray-400">Tổng khách tham dự</p>
                    <p class="text-2xl font-bold text-emerald-600">{{ stats.attending_guests }}</p>
                </div>
                <div class="rounded-xl border border-gray-100 bg-white px-5 py-3 shadow-sm">
                    <p class="text-xs text-gray-400">Số phản hồi</p>
                    <p class="text-2xl font-bold text-brand-700">{{ stats.rsvp_count }}</p>
                </div>
            </div>
            <div class="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
                <table class="w-full text-sm">
                    <thead class="bg-gray-50 text-left text-xs text-gray-400 uppercase">
                        <tr>
                            <th class="px-4 py-3">Tên</th><th class="px-4 py-3">SĐT</th><th class="px-4 py-3">Số khách</th>
                            <th class="px-4 py-3">Tham dự</th><th class="px-4 py-3">Món</th><th class="px-4 py-3">Lời nhắn</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        <tr v-for="r in rsvps" :key="r.id">
                            <td class="px-4 py-3 font-medium text-gray-800">{{ r.name }}</td>
                            <td class="px-4 py-3 text-gray-500">{{ r.phone || '—' }}</td>
                            <td class="px-4 py-3">{{ r.guest_count }}</td>
                            <td class="px-4 py-3">
                                <span class="rounded-full px-2 py-0.5 text-xs" :class="r.attendance === 'yes' ? 'bg-emerald-100 text-emerald-700' : r.attendance === 'no' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-700'">
                                    {{ attendanceLabel[r.attendance] }}
                                </span>
                            </td>
                            <td class="px-4 py-3 text-gray-500">{{ r.food_option || '—' }}</td>
                            <td class="px-4 py-3 text-gray-500">{{ r.notes || '—' }}</td>
                        </tr>
                        <tr v-if="rsvps.length === 0"><td colspan="6" class="px-4 py-8 text-center text-gray-400">Chưa có phản hồi nào.</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Guestbook -->
        <div v-else class="grid gap-3">
            <div v-for="m in messages" :key="m.id" class="flex items-start justify-between rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div>
                    <p class="font-medium text-gray-800">{{ m.name }} <span>{{ m.emoji }}</span>
                        <span class="ml-2 rounded-full px-2 py-0.5 text-xs" :class="m.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : m.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'">{{ m.status }}</span>
                    </p>
                    <p class="mt-1 text-sm text-gray-600">{{ m.message }}</p>
                </div>
                <div class="flex shrink-0 gap-1 text-xs">
                    <button v-if="m.status !== 'approved'" class="rounded px-2 py-1 font-medium text-emerald-600 hover:bg-emerald-50" @click="moderate(m.id, 'approved')">Duyệt</button>
                    <button v-if="m.status !== 'rejected'" class="rounded px-2 py-1 font-medium text-amber-600 hover:bg-amber-50" @click="moderate(m.id, 'rejected')">Ẩn</button>
                    <button class="rounded px-2 py-1 font-medium text-rose-600 hover:bg-rose-50" @click="removeMessage(m.id)">Xoá</button>
                </div>
            </div>
            <p v-if="messages.length === 0" class="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">Chưa có lời chúc nào.</p>
        </div>
    </div>
</template>
