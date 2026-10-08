import { ref } from 'vue';

export interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'info';
}

const toasts = ref<Toast[]>([]);
let counter = 0;

export function useToasts() {
    function push(message: string, type: Toast['type'] = 'info'): void {
        const id = ++counter;
        toasts.value.push({ id, message, type });
        setTimeout(() => dismiss(id), 4000);
    }

    function dismiss(id: number): void {
        toasts.value = toasts.value.filter((t) => t.id !== id);
    }

    return {
        toasts,
        success: (m: string) => push(m, 'success'),
        error: (m: string) => push(m, 'error'),
        info: (m: string) => push(m, 'info'),
        dismiss,
    };
}
