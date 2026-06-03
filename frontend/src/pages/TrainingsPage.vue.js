import { computed, onMounted, ref } from 'vue';
import { ChevronDown, GripVertical, Plus, Save, Trash2, X } from 'lucide-vue-next';
import client from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import TrainingForm from '@/components/TrainingForm.vue';
const auth = useAuthStore();
const toast = useToastStore();
const trainings = ref([]);
const owners = ref([]);
const loading = ref(true);
const expandedId = ref(null);
const draft = ref(null); // editing buffer (also used for new)
const confirmDeleteId = ref(null);
const isAdmin = computed(() => auth.user?.isAdmin ?? false);
function blankTraining() {
    return {
        id: '',
        name: '',
        description: '',
        durationHours: 1,
        category: 'General',
        ownerId: auth.user?.id ?? '',
        cycleYears: 1,
        windowBeforeMonths: 3,
        windowAfterMonths: 3,
        order: 0,
        materialLinks: [],
        questions: [],
        createdAt: '',
    };
}
async function load() {
    loading.value = true;
    try {
        const params = isAdmin.value ? {} : { mine: '1' };
        const [t, u] = await Promise.all([
            client.get('/trainings', { params }),
            isAdmin.value
                ? client.get('/users')
                : Promise.resolve({ data: [] }),
        ]);
        trainings.value = t.data;
        owners.value = u.data.filter((x) => x.isTrainer || x.isAdmin);
    }
    finally {
        loading.value = false;
    }
}
function ownerName(id) {
    return owners.value.find((o) => o.id === id)?.name ?? (id === auth.user?.id ? 'You' : '—');
}
function startCreate() {
    draft.value = blankTraining();
    expandedId.value = '__new__';
}
function startEdit(t) {
    draft.value = JSON.parse(JSON.stringify(t));
    expandedId.value = t.id;
}
function cancel() {
    draft.value = null;
    expandedId.value = null;
}
function addLink() {
    draft.value?.materialLinks.push({ label: '', url: '' });
}
function removeLink(i) {
    draft.value?.materialLinks.splice(i, 1);
}
function addQuestion() {
    draft.value?.questions.push({
        id: '',
        text: '',
        options: ['', ''],
        correctIndex: 0,
    });
}
function removeQuestion(i) {
    draft.value?.questions.splice(i, 1);
}
function addOption(q) {
    q.options.push('');
}
function removeOption(q, oi) {
    q.options.splice(oi, 1);
    if (q.correctIndex && q.correctIndex >= q.options.length)
        q.correctIndex = 0;
}
async function save() {
    if (!draft.value)
        return;
    const body = draft.value;
    if (!body.name.trim()) {
        toast.error('Name is required');
        return;
    }
    try {
        if (body.id) {
            await client.put(`/trainings/${body.id}`, body);
            toast.success('Training updated');
        }
        else {
            await client.post('/trainings', body);
            toast.success('Training created');
        }
        cancel();
        await load();
    }
    catch {
        toast.error('Could not save training');
    }
}
async function remove(id) {
    try {
        await client.delete(`/trainings/${id}`);
        toast.success('Training deleted');
        confirmDeleteId.value = null;
        if (expandedId.value === id)
            cancel();
        await load();
    }
    catch {
        toast.error('Could not delete training');
    }
}
// --- Drag-and-drop reordering (admin only) ---
// `dragEnabled` is flipped on by the grip handle's mousedown so the row only
// becomes draggable when grabbed by the handle (not when clicked to expand).
const dragEnabled = ref(false);
const dragIndex = ref(null);
function onDragStart(i) {
    dragIndex.value = i;
    cancel(); // collapse any open editor so indexes stay stable while dragging
}
function onDragOver(i) {
    if (dragIndex.value === null || dragIndex.value === i)
        return;
    const list = trainings.value;
    const [moved] = list.splice(dragIndex.value, 1);
    list.splice(i, 0, moved);
    dragIndex.value = i; // follow the item to its new slot
}
function onDragEnd() {
    dragEnabled.value = false;
    dragIndex.value = null;
}
async function persistOrder() {
    const moved = dragIndex.value !== null;
    onDragEnd();
    if (!moved)
        return;
    try {
        await client.put('/trainings/reorder', { ids: trainings.value.map((t) => t.id) });
        toast.success('Order saved');
    }
    catch {
        toast.error('Could not save order');
        await load(); // restore the server's order on failure
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
(__VLS_ctx.isAdmin ? 'all trainings' : 'trainings you own');
(__VLS_ctx.trainings.length);
if (__VLS_ctx.isAdmin) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
}
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
        ...{ class: "mt-6" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "card border-accent/40 p-5" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({
        ...{ class: "mb-3 font-sans text-sm font-bold text-accent" },
    });
    /** @type {[typeof TrainingForm, ]} */ ;
    // @ts-ignore
    const __VLS_4 = __VLS_asFunctionalComponent(TrainingForm, new TrainingForm({
        ...{ 'onAddLink': {} },
        ...{ 'onRemoveLink': {} },
        ...{ 'onAddQuestion': {} },
        ...{ 'onRemoveQuestion': {} },
        ...{ 'onAddOption': {} },
        ...{ 'onRemoveOption': {} },
        draft: (__VLS_ctx.draft),
        isAdmin: (__VLS_ctx.isAdmin),
        owners: (__VLS_ctx.owners),
    }));
    const __VLS_5 = __VLS_4({
        ...{ 'onAddLink': {} },
        ...{ 'onRemoveLink': {} },
        ...{ 'onAddQuestion': {} },
        ...{ 'onRemoveQuestion': {} },
        ...{ 'onAddOption': {} },
        ...{ 'onRemoveOption': {} },
        draft: (__VLS_ctx.draft),
        isAdmin: (__VLS_ctx.isAdmin),
        owners: (__VLS_ctx.owners),
    }, ...__VLS_functionalComponentArgsRest(__VLS_4));
    let __VLS_7;
    let __VLS_8;
    let __VLS_9;
    const __VLS_10 = {
        onAddLink: (__VLS_ctx.addLink)
    };
    const __VLS_11 = {
        onRemoveLink: (__VLS_ctx.removeLink)
    };
    const __VLS_12 = {
        onAddQuestion: (__VLS_ctx.addQuestion)
    };
    const __VLS_13 = {
        onRemoveQuestion: (__VLS_ctx.removeQuestion)
    };
    const __VLS_14 = {
        onAddOption: (__VLS_ctx.addOption)
    };
    const __VLS_15 = {
        onRemoveOption: (__VLS_ctx.removeOption)
    };
    var __VLS_6;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "mt-4 flex gap-2" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.save) },
        ...{ class: "btn-primary" },
    });
    const __VLS_16 = {}.Save;
    /** @type {[typeof __VLS_components.Save, ]} */ ;
    // @ts-ignore
    const __VLS_17 = __VLS_asFunctionalComponent(__VLS_16, new __VLS_16({
        ...{ class: "h-4 w-4" },
    }));
    const __VLS_18 = __VLS_17({
        ...{ class: "h-4 w-4" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_17));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.cancel) },
        ...{ class: "btn-ghost" },
    });
    const __VLS_20 = {}.X;
    /** @type {[typeof __VLS_components.X, ]} */ ;
    // @ts-ignore
    const __VLS_21 = __VLS_asFunctionalComponent(__VLS_20, new __VLS_20({
        ...{ class: "h-4 w-4" },
    }));
    const __VLS_22 = __VLS_21({
        ...{ class: "h-4 w-4" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_21));
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
    for (const [t, i] of __VLS_getVForSourceType((__VLS_ctx.trainings))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ onDragstart: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    __VLS_ctx.onDragStart(i);
                } },
            ...{ onDragover: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    __VLS_ctx.onDragOver(i);
                } },
            ...{ onDrop: (__VLS_ctx.persistOrder) },
            ...{ onDragend: (__VLS_ctx.onDragEnd) },
            key: (t.id),
            ...{ class: "card overflow-hidden transition" },
            ...{ class: (__VLS_ctx.dragIndex === i ? 'opacity-50 ring-2 ring-accent/50' : '') },
            draggable: (__VLS_ctx.isAdmin && __VLS_ctx.dragEnabled),
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    __VLS_ctx.expandedId === t.id ? __VLS_ctx.cancel() : __VLS_ctx.startEdit(t);
                } },
            ...{ class: "flex cursor-pointer items-center gap-3 px-5 py-4 transition hover:bg-pastel-sky/20" },
        });
        if (__VLS_ctx.isAdmin) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: () => { } },
                ...{ onMousedown: (...[$event]) => {
                        if (!!(__VLS_ctx.loading))
                            return;
                        if (!(__VLS_ctx.isAdmin))
                            return;
                        __VLS_ctx.dragEnabled = true;
                    } },
                ...{ onMouseup: (...[$event]) => {
                        if (!!(__VLS_ctx.loading))
                            return;
                        if (!(__VLS_ctx.isAdmin))
                            return;
                        __VLS_ctx.dragEnabled = false;
                    } },
                type: "button",
                title: "Drag to reorder",
                ...{ class: "-ml-1 shrink-0 cursor-grab touch-none text-ink-light transition hover:text-ink active:cursor-grabbing" },
            });
            const __VLS_24 = {}.GripVertical;
            /** @type {[typeof __VLS_components.GripVertical, ]} */ ;
            // @ts-ignore
            const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
                ...{ class: "h-4 w-4" },
            }));
            const __VLS_26 = __VLS_25({
                ...{ class: "h-4 w-4" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_25));
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "min-w-0 flex-1" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "font-sans text-sm font-semibold text-ink" },
        });
        (t.name);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "truncate font-mono text-xs text-ink-light" },
        });
        (t.description);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "pill bg-pastel-sky/60 text-ink-muted" },
        });
        (t.category);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "pill bg-pastel-slate/60 text-ink-muted" },
        });
        (t.durationHours);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "pill bg-pastel-mint/50 text-emerald-700" },
        });
        (t.cycleYears);
        if (__VLS_ctx.isAdmin) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "pill bg-white text-ink-light" },
            });
            (__VLS_ctx.ownerName(t.ownerId));
        }
        const __VLS_28 = {}.ChevronDown;
        /** @type {[typeof __VLS_components.ChevronDown, ]} */ ;
        // @ts-ignore
        const __VLS_29 = __VLS_asFunctionalComponent(__VLS_28, new __VLS_28({
            ...{ class: "h-4 w-4 text-ink-light transition" },
            ...{ class: (__VLS_ctx.expandedId === t.id ? 'rotate-180' : '') },
        }));
        const __VLS_30 = __VLS_29({
            ...{ class: "h-4 w-4 text-ink-light transition" },
            ...{ class: (__VLS_ctx.expandedId === t.id ? 'rotate-180' : '') },
        }, ...__VLS_functionalComponentArgsRest(__VLS_29));
        const __VLS_32 = {}.Transition;
        /** @type {[typeof __VLS_components.Transition, typeof __VLS_components.Transition, ]} */ ;
        // @ts-ignore
        const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
            name: "list",
        }));
        const __VLS_34 = __VLS_33({
            name: "list",
        }, ...__VLS_functionalComponentArgsRest(__VLS_33));
        __VLS_35.slots.default;
        if (__VLS_ctx.expandedId === t.id && __VLS_ctx.draft) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "border-t border-line bg-pastel-sky/10 p-5" },
            });
            /** @type {[typeof TrainingForm, ]} */ ;
            // @ts-ignore
            const __VLS_36 = __VLS_asFunctionalComponent(TrainingForm, new TrainingForm({
                ...{ 'onAddLink': {} },
                ...{ 'onRemoveLink': {} },
                ...{ 'onAddQuestion': {} },
                ...{ 'onRemoveQuestion': {} },
                ...{ 'onAddOption': {} },
                ...{ 'onRemoveOption': {} },
                draft: (__VLS_ctx.draft),
                isAdmin: (__VLS_ctx.isAdmin),
                owners: (__VLS_ctx.owners),
            }));
            const __VLS_37 = __VLS_36({
                ...{ 'onAddLink': {} },
                ...{ 'onRemoveLink': {} },
                ...{ 'onAddQuestion': {} },
                ...{ 'onRemoveQuestion': {} },
                ...{ 'onAddOption': {} },
                ...{ 'onRemoveOption': {} },
                draft: (__VLS_ctx.draft),
                isAdmin: (__VLS_ctx.isAdmin),
                owners: (__VLS_ctx.owners),
            }, ...__VLS_functionalComponentArgsRest(__VLS_36));
            let __VLS_39;
            let __VLS_40;
            let __VLS_41;
            const __VLS_42 = {
                onAddLink: (__VLS_ctx.addLink)
            };
            const __VLS_43 = {
                onRemoveLink: (__VLS_ctx.removeLink)
            };
            const __VLS_44 = {
                onAddQuestion: (__VLS_ctx.addQuestion)
            };
            const __VLS_45 = {
                onRemoveQuestion: (__VLS_ctx.removeQuestion)
            };
            const __VLS_46 = {
                onAddOption: (__VLS_ctx.addOption)
            };
            const __VLS_47 = {
                onRemoveOption: (__VLS_ctx.removeOption)
            };
            var __VLS_38;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "mt-4 flex items-center gap-2" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (__VLS_ctx.save) },
                ...{ class: "btn-primary" },
            });
            const __VLS_48 = {}.Save;
            /** @type {[typeof __VLS_components.Save, ]} */ ;
            // @ts-ignore
            const __VLS_49 = __VLS_asFunctionalComponent(__VLS_48, new __VLS_48({
                ...{ class: "h-4 w-4" },
            }));
            const __VLS_50 = __VLS_49({
                ...{ class: "h-4 w-4" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_49));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (__VLS_ctx.cancel) },
                ...{ class: "btn-ghost" },
            });
            const __VLS_52 = {}.X;
            /** @type {[typeof __VLS_components.X, ]} */ ;
            // @ts-ignore
            const __VLS_53 = __VLS_asFunctionalComponent(__VLS_52, new __VLS_52({
                ...{ class: "h-4 w-4" },
            }));
            const __VLS_54 = __VLS_53({
                ...{ class: "h-4 w-4" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_53));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div)({
                ...{ class: "flex-1" },
            });
            if (__VLS_ctx.confirmDeleteId === t.id) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                    ...{ class: "font-mono text-xs text-rose-600" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!!(__VLS_ctx.loading))
                                return;
                            if (!(__VLS_ctx.expandedId === t.id && __VLS_ctx.draft))
                                return;
                            if (!(__VLS_ctx.confirmDeleteId === t.id))
                                return;
                            __VLS_ctx.remove(t.id);
                        } },
                    ...{ class: "btn-danger !px-3 !py-1.5" },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                    ...{ onClick: (...[$event]) => {
                            if (!!(__VLS_ctx.loading))
                                return;
                            if (!(__VLS_ctx.expandedId === t.id && __VLS_ctx.draft))
                                return;
                            if (!(__VLS_ctx.confirmDeleteId === t.id))
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
                            if (!(__VLS_ctx.expandedId === t.id && __VLS_ctx.draft))
                                return;
                            if (!!(__VLS_ctx.confirmDeleteId === t.id))
                                return;
                            __VLS_ctx.confirmDeleteId = t.id;
                        } },
                    ...{ class: "btn-danger !px-3 !py-1.5" },
                });
                const __VLS_56 = {}.Trash2;
                /** @type {[typeof __VLS_components.Trash2, ]} */ ;
                // @ts-ignore
                const __VLS_57 = __VLS_asFunctionalComponent(__VLS_56, new __VLS_56({
                    ...{ class: "h-4 w-4" },
                }));
                const __VLS_58 = __VLS_57({
                    ...{ class: "h-4 w-4" },
                }, ...__VLS_functionalComponentArgsRest(__VLS_57));
            }
        }
        var __VLS_35;
    }
    if (__VLS_ctx.trainings.length === 0) {
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
/** @type {__VLS_StyleScopedClasses['transition']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['cursor-pointer']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-3']} */ ;
/** @type {__VLS_StyleScopedClasses['px-5']} */ ;
/** @type {__VLS_StyleScopedClasses['py-4']} */ ;
/** @type {__VLS_StyleScopedClasses['transition']} */ ;
/** @type {__VLS_StyleScopedClasses['hover:bg-pastel-sky/20']} */ ;
/** @type {__VLS_StyleScopedClasses['-ml-1']} */ ;
/** @type {__VLS_StyleScopedClasses['shrink-0']} */ ;
/** @type {__VLS_StyleScopedClasses['cursor-grab']} */ ;
/** @type {__VLS_StyleScopedClasses['touch-none']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
/** @type {__VLS_StyleScopedClasses['transition']} */ ;
/** @type {__VLS_StyleScopedClasses['hover:text-ink']} */ ;
/** @type {__VLS_StyleScopedClasses['active:cursor-grabbing']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
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
/** @type {__VLS_StyleScopedClasses['bg-pastel-sky/60']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-muted']} */ ;
/** @type {__VLS_StyleScopedClasses['pill']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-pastel-slate/60']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-muted']} */ ;
/** @type {__VLS_StyleScopedClasses['pill']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-pastel-mint/50']} */ ;
/** @type {__VLS_StyleScopedClasses['text-emerald-700']} */ ;
/** @type {__VLS_StyleScopedClasses['pill']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-white']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
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
            GripVertical: GripVertical,
            Plus: Plus,
            Save: Save,
            Trash2: Trash2,
            X: X,
            TrainingForm: TrainingForm,
            trainings: trainings,
            owners: owners,
            loading: loading,
            expandedId: expandedId,
            draft: draft,
            confirmDeleteId: confirmDeleteId,
            isAdmin: isAdmin,
            ownerName: ownerName,
            startCreate: startCreate,
            startEdit: startEdit,
            cancel: cancel,
            addLink: addLink,
            removeLink: removeLink,
            addQuestion: addQuestion,
            removeQuestion: removeQuestion,
            addOption: addOption,
            removeOption: removeOption,
            save: save,
            remove: remove,
            dragEnabled: dragEnabled,
            dragIndex: dragIndex,
            onDragStart: onDragStart,
            onDragOver: onDragOver,
            onDragEnd: onDragEnd,
            persistOrder: persistOrder,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
