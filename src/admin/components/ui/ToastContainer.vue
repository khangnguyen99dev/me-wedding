<script setup lang="ts">
import { useToasts } from '@/admin/lib/toast';

const { toasts, dismiss } = useToasts();
</script>

<template>
    <div class="pointer-events-none fixed top-4 right-4 z-[100] flex w-80 flex-col gap-2">
        <transition-group name="toast">
            <div
                v-for="t in toasts"
                :key="t.id"
                class="pointer-events-auto cursor-pointer rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg"
                :class="{
                    'bg-emerald-600': t.type === 'success',
                    'bg-rose-600': t.type === 'error',
                    'bg-gray-800': t.type === 'info',
                }"
                @click="dismiss(t.id)"
            >
                {{ t.message }}
            </div>
        </transition-group>
    </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
    transition: all 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
    opacity: 0;
    transform: translateX(20px);
}
</style>
