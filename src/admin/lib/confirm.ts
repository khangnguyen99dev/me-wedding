import { ref } from 'vue';

export interface ConfirmOptions {
    title: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
}

interface ConfirmState {
    open: boolean;
    options: ConfirmOptions;
    resolve?: (value: boolean) => void;
}

const state = ref<ConfirmState>({ open: false, options: { title: '' } });

export function useConfirm() {
    function confirm(options: ConfirmOptions): Promise<boolean> {
        return new Promise((resolve) => {
            state.value = { open: true, options, resolve };
        });
    }

    function answer(value: boolean): void {
        state.value.resolve?.(value);
        state.value = { ...state.value, open: false };
    }

    return { state, confirm, answer };
}
