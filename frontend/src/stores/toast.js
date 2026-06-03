import { defineStore } from 'pinia';
import { ref } from 'vue';
let nextId = 1;
export const useToastStore = defineStore('toast', () => {
    const toasts = ref([]);
    function push(message, type = 'success') {
        const id = nextId++;
        toasts.value.push({ id, message, type });
        setTimeout(() => dismiss(id), 3200);
    }
    function dismiss(id) {
        toasts.value = toasts.value.filter((t) => t.id !== id);
    }
    const success = (m) => push(m, 'success');
    const error = (m) => push(m, 'error');
    return { toasts, push, dismiss, success, error };
});
