<script setup lang="ts">
import { useConfirm } from '@/admin/lib/confirm';

const { state, answer } = useConfirm();
</script>

<template>
    <transition name="fade">
        <div v-if="state.open" class="fixed inset-0 z-[110] grid place-items-center bg-black/40 p-4" @click.self="answer(false)">
            <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
                <h3 class="text-lg font-semibold text-gray-900">{{ state.options.title }}</h3>
                <p v-if="state.options.message" class="mt-2 text-sm text-gray-500">{{ state.options.message }}</p>
                <div class="mt-6 flex justify-end gap-3">
                    <button class="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100" @click="answer(false)">
                        {{ state.options.cancelText ?? 'Huỷ' }}
                    </button>
                    <button
                        class="rounded-lg px-4 py-2 text-sm font-medium text-white"
                        :class="state.options.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand-600 hover:bg-brand-700'"
                        @click="answer(true)"
                    >
                        {{ state.options.confirmText ?? 'Xác nhận' }}
                    </button>
                </div>
            </div>
        </div>
    </transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
