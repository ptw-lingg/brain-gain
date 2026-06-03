import { onMounted, ref } from 'vue';
import { ChevronDown, Plus, Save, Trash2, X } from 'lucide-vue-next';
import client from '@/api/client';
import { useToastStore } from '@/stores/toast';
import RoleForm from '@/components/RoleForm.vue';
const toast = useToastStore();
const roles = ref([]);
const trainings = ref([]);
const loading = ref(true);
const expandedId = ref(null);
const draft = ref(null);
const confirmDeleteId = ref(null);
async function load() {
    loading.value = true;
    try {
        const [r, t] = await Promise.all([
            client.get('/roles'),
            client.get('/trainings'),
        ]);
        roles.value = r.data;
        trainings.value = t.data;
    }
    finally {
        loading.value = false;
    }
}
function trainingName(id) {
    return trainings.value.find((t) => t.id === id)?.name ?? '—';
}
function startCreate() {
    draft.value = { id: '', name: '', description: '', trainingIds: [] };
    expandedId.value = '__new__';
}
function startEdit(r) {
    draft.value = JSON.parse(JSON.stringify(r));
    expandedId.value = r.id;
}
function cancel() {
    draft.value = null;
    expandedId.value = null;
}
function toggleTraining(id) {
    if (!draft.value)
        return;
    const i = draft.value.trainingIds.indexOf(id);
    if (i === -1)
        draft.value.trainingIds.push(id);
    else
        draft.value.trainingIds.splice(i, 1);
}
async function save() {
    if (!draft.value)
        return;
    if (!draft.value.name.trim()) {
        toast.error('Name is required');
        return;
    }
    try {
        if (draft.value.id) {
            await client.put(`/roles/${draft.value.id}`, draft.value);
            toast.success('Role updated');
        }
        else {
            await client.post('/roles', draft.value);
            toast.success('Role created');
        }
        cancel();
        await load();
    }
    catch {
        toast.error('Could not save role');
    }
}
async function remove(id) {
    try {
        await client.delete(`/roles/${id}`);
        toast.success('Role deleted');
        confirmDeleteId.value = null;
        if (expandedId.value === id)
            cancel();
        await load();
    }
    catch {
        toast.error('Could not delete role');
    }
}
onMounted(load);
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
    ...{ class: "flex items-center justify-between" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({
    ...{ class: "page-title" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "mt-1 font-mono text-xs text-ink-light" },
});
(__VLS_ctx.roles.length);
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.startCreate) },
    ...{ class: "btn-primary" },
});
const __VLS_0 = {}.Plus;
/** @type {[typeof __VLS_components.Plus, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ class: "h-4 w-4" },
}));
const __VLS_2 = __VLS_1({
    ...{ class: "h-4 w-4" },
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
if (__VLS_ctx.expandedId === '__new__' && __VLS_ctx.draft) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "mt-6 card border-accent/40 p-5" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({
        ...{ class: "mb-3 font-sans text-sm font-bold text-accent" },
    });
    /** @type {[typeof RoleForm, ]} */ ;
    // @ts-ignore
    const __VLS_4 = __VLS_asFunctionalComponent(RoleForm, new RoleForm({
        ...{ 'onToggle': {} },
        draft: (__VLS_ctx.draft),
        trainings: (__VLS_ctx.trainings),
    }));
    const __VLS_5 = __VLS_4({
        ...{ 'onToggle': {} },
        draft: (__VLS_ctx.draft),
        trainings: (__VLS_ctx.trainings),
    }, ...__VLS_functionalComponentArgsRest(__VLS_4));
    let __VLS_7;
    let __VLS_8;
    let __VLS_9;
    const __VLS_10 = {
        onToggle: (__VLS_ctx.toggleTraining)
    };
    var __VLS_6;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "mt-4 flex gap-2" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.save) },
        ...{ class: "btn-primary" },
    });
    const __VLS_11 = {}.Save;
    /** @type {[typeof __VLS_components.Save, ]} */ ;
    // @ts-ignore
    const __VLS_12 = __VLS_asFunctionalComponent(__VLS_11, new __VLS_11({
        ...{ class: "h-4 w-4" },
    }));
    const __VLS_13 = __VLS_12({
        ...{ class: "h-4 w-4" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_12));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.cancel) },
        ...{ class: "btn-ghost" },
    });
    const __VLS_15 = {}.X;
    /** @type {[typeof __VLS_components.X, ]} */ ;
    // @ts-ignore
    const __VLS_16 = __VLS_asFunctionalComponent(__VLS_15, new __VLS_15({
        ...{ class: "h-4 w-4" },
    }));
    const __VLS_17 = __VLS_16({
        ...{ class: "h-4 w-4" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_16));
}
if (__VLS_ctx.loading) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "mt-6 flex flex-col gap-3" },
    });
    for (const [n] of __VLS_getVForSourceType((3))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div)({
            key: (n),
            ...{ class: "card h-16 animate-pulse bg-pastel-slate/30" },
        });
    }
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "mt-6 flex flex-col gap-3" },
    });
    for (const [r] of __VLS_getVForSourceType((__VLS_ctx.roles))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            key: (r.id),
            ...{ class: "card overflow-hidden" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    __VLS_ctx.expandedId === r.id ? __VLS_ctx.cancel() : __VLS_ctx.startEdit(r);
                } },
            ...{ class: "flex cursor-pointer items-center gap-3 px-5 py-4 transition hover:bg-pastel-sky/20" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "min-w-0 flex-1" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "font-sans text-sm font-semibold text-ink" },
        });
        (r.name);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "truncate font-mono text-xs text-ink-light" },
        });
        (r.description);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "pill bg-pastel-mint/50 text-emerald-700" },
        });
        (r.trainingIds.length);
        (r.trainingIds.length === 1 ? '' : 's');
        const __VLS_19 = {}.ChevronDown;
        /** @type {[typeof __VLS_components.ChevronDown, ]} */ ;
        // @ts-ignore
        const __VLS_20 = __VLS_asFunctionalComponent(__VLS_19, new __VLS_19({
            ...{ class: "h-4 w-4 text-ink-light transition" },
            ...{ class: (__VLS_ctx.expandedId === r.id ? 'rotate-180' : '') },
        }));
        const __VLS_21 = __VLS_20({
            ...{ class: "h-4 w-4 text-ink-light transition" },
            ...{ class: (__VLS_ctx.expandedId === r.id ? 'rotate-180' : '') },
        }, ...__VLS_functionalComponentArgsRest(__VLS_20));
        const __VLS_23 = {}.Transition;
        /** @type {[typeof __VLS_components.Transition, typeof __VLS_components.Transition, ]} */ ;
        // @ts-ignore
        const __VLS_24 = __VLS_asFunctionalComponent(__VLS_23, new __VLS_23({
            name: "list",
        }));
        const __VLS_25 = __VLS_24({
            name: "list",
        }, ...__VLS_functionalComponentArgsRest(__VLS_24));
        __VLS_26.slots.default;
        if (__VLS_ctx.expandedId === r.id && __VLS_ctx.draft) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "border-t border-line bg-pastel-sky/10 p-5" },
            });
            /** @type {[typeof RoleForm, ]} */ ;
            // @ts-ignore
            const __VLS_27 = __VLS_asFunctionalComponent(RoleForm, new RoleForm({
                ...{ 'onToggle': {} },
                draft: (__VLS_ctx.draft),
                trainings: (__VLS_ctx.trainings),
            }));
            const __VLS_28 = __VLS_27({
                ...{ 'onToggle': {} },
                draft: (__VLS_ctx.draft),
                trainings: (__VLS_ctx.trainings),
            }, ...__VLS_functionalComponentArgsRest(__VLS_27));
            let __VLS_30;
            let __VLS_31;
            let __VLS_32;
            const __VLS_33 = {
                onToggle: (__VLS_ctx.toggleTraining)
            };
            var __VLS_29;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "mt-4 flex items-center gap-2" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (__VLS_ctx.save) },
                ...{ class: "btn-primary" },
            });
            const __VLS_34 = {}.Save;
            /** @type {[typeof __VLS_components.Save, ]} */ ;
            // @ts-ignore
            const __VLS_35 = __VLS_asFunctionalComponent(__VLS_34, new __VLS_34({
                ...{ class: "h-4 w-4" },
            }));
            const __VLS_36 = __VLS_35({
                ...{ class: "h-4 w-4" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_35));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (__VLS_ctx.cancel) },
                ...{ class: "btn-ghost" },
            });
            const __VLS_38 = {}.X;
            /** @type {[typeof __VLS_components.X, ]} */ ;
            // @ts-ignore
            const __VLS_39 = __VLS_asFunctionalComponent(__VLS_38, new __VLS_38({
                ...{ class: "h-4 w-4" },
            }));
            const __VLS_40 = __VLS_39({
                ...{ class: "h-4 w-4" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_39));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div)({
                ...{ class: "flex-1" },
            });
            if (__VLS_ctx.confirmDeleteId === r.id) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "font-mono text-xs text-rose-600" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!!(__VLS_ctx.loading))
                                return;
                            if (!(__VLS_ctx.expandedId === r.id && __VLS_ctx.draft))
                                return;
                            if (!(__VLS_ctx.confirmDeleteId === r.id))
                                return;
                            __VLS_ctx.remove(r.id);
                        } },
                    ...{ class: "btn-danger !px-3 !py-1.5" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!!(__VLS_ctx.loading))
                                return;
                            if (!(__VLS_ctx.expandedId === r.id && __VLS_ctx.draft))
                                return;
                            if (!(__VLS_ctx.confirmDeleteId === r.id))
                                return;
                            __VLS_ctx.confirmDeleteId = null;
                        } },
                    ...{ class: "btn-ghost !px-3 !py-1.5" },
                });
            }
            else {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!!(__VLS_ctx.loading))
                                return;
                            if (!(__VLS_ctx.expandedId === r.id && __VLS_ctx.draft))
                                return;
                            if (!!(__VLS_ctx.confirmDeleteId === r.id))
                                return;
                            __VLS_ctx.confirmDeleteId = r.id;
                        } },
                    ...{ class: "btn-danger !px-3 !py-1.5" },
                });
                const __VLS_42 = {}.Trash2;
                /** @type {[typeof __VLS_components.Trash2, ]} */ ;
                // @ts-ignore
                const __VLS_43 = __VLS_asFunctionalComponent(__VLS_42, new __VLS_42({
                    ...{ class: "h-4 w-4" },
                }));
                const __VLS_44 = __VLS_43({
                    ...{ class: "h-4 w-4" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_43));
            }
        }
        var __VLS_26;
    }
    if (__VLS_ctx.roles.length === 0) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
            ...{ class: "font-mono text-sm text-ink-light" },
        });
    }
}
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-between']} */ ;
/** @type {__VLS_StyleScopedClasses['page-title']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-1']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-6']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['border-accent/40']} */ ;
/** @type {__VLS_StyleScopedClasses['p-5']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-3']} */ ;
/** @type {__VLS_StyleScopedClasses['font-sans']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['font-bold']} */ ;
/** @type {__VLS_StyleScopedClasses['text-accent']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-4']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-2']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-ghost']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-6']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-3']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['h-16']} */ ;
/** @type {__VLS_StyleScopedClasses['animate-pulse']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-pastel-slate/30']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-6']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-3']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['overflow-hidden']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['cursor-pointer']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-3']} */ ;
/** @type {__VLS_StyleScopedClasses['px-5']} */ ;
/** @type {__VLS_StyleScopedClasses['py-4']} */ ;
/** @type {__VLS_StyleScopedClasses['transition']} */ ;
/** @type {__VLS_StyleScopedClasses['hover:bg-pastel-sky/20']} */ ;
/** @type {__VLS_StyleScopedClasses['min-w-0']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-1']} */ ;
/** @type {__VLS_StyleScopedClasses['font-sans']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['font-semibold']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink']} */ ;
/** @type {__VLS_StyleScopedClasses['truncate']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
/** @type {__VLS_StyleScopedClasses['pill']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-pastel-mint/50']} */ ;
/** @type {__VLS_StyleScopedClasses['text-emerald-700']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
/** @type {__VLS_StyleScopedClasses['transition']} */ ;
/** @type {__VLS_StyleScopedClasses['border-t']} */ ;
/** @type {__VLS_StyleScopedClasses['border-line']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-pastel-sky/10']} */ ;
/** @type {__VLS_StyleScopedClasses['p-5']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-4']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-2']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-ghost']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-1']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-rose-600']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-danger']} */ ;
/** @type {__VLS_StyleScopedClasses['!px-3']} */ ;
/** @type {__VLS_StyleScopedClasses['!py-1.5']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-ghost']} */ ;
/** @type {__VLS_StyleScopedClasses['!px-3']} */ ;
/** @type {__VLS_StyleScopedClasses['!py-1.5']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-danger']} */ ;
/** @type {__VLS_StyleScopedClasses['!px-3']} */ ;
/** @type {__VLS_StyleScopedClasses['!py-1.5']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            ChevronDown: ChevronDown,
            Plus: Plus,
            Save: Save,
            Trash2: Trash2,
            X: X,
            RoleForm: RoleForm,
            roles: roles,
            trainings: trainings,
            loading: loading,
            expandedId: expandedId,
            draft: draft,
            confirmDeleteId: confirmDeleteId,
            startCreate: startCreate,
            startEdit: startEdit,
            cancel: cancel,
            toggleTraining: toggleTraining,
            save: save,
            remove: remove,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
