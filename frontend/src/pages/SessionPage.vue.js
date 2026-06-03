import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ExternalLink, FileText, Loader2, PartyPopper, RefreshCw, XCircle, } from 'lucide-vue-next';
import client from '@/api/client';
const route = useRoute();
const router = useRouter();
const trainingId = route.params.trainingId;
const training = ref(null);
const loading = ref(true);
const step = ref('material');
const answers = ref([]);
const submitting = ref(false);
const result = ref(null);
const allAnswered = computed(() => training.value != null &&
    training.value.questions.length > 0 &&
    answers.value.length === training.value.questions.length &&
    answers.value.every((a) => a >= 0));
const thresholdPct = computed(() => result.value ? Math.round(result.value.passThreshold * 100) : 80);
async function load() {
    loading.value = true;
    try {
        const { data } = await client.get(`/trainings/${trainingId}`);
        training.value = data;
        answers.value = new Array(data.questions.length).fill(-1);
    }
    finally {
        loading.value = false;
    }
}
function startTest() {
    step.value = 'quiz';
}
async function submit() {
    submitting.value = true;
    try {
        const { data } = await client.post('/sessions/grade', {
            trainingId,
            answers: answers.value,
        });
        result.value = data;
        step.value = 'result';
    }
    finally {
        submitting.value = false;
    }
}
function retry() {
    if (training.value)
        answers.value = new Array(training.value.questions.length).fill(-1);
    result.value = null;
    step.value = 'quiz';
}
onMounted(load);
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "mx-auto max-w-2xl" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.router.push('/dashboard');
        } },
    ...{ class: "btn-ghost mb-4 !px-3 !py-1.5 !text-xs" },
});
const __VLS_0 = {}.ArrowLeft;
/** @type {[typeof __VLS_components.ArrowLeft, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ class: "h-3.5 w-3.5" },
}));
const __VLS_2 = __VLS_1({
    ...{ class: "h-3.5 w-3.5" },
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
if (__VLS_ctx.loading) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div)({
        ...{ class: "card h-64 animate-pulse bg-pastel-slate/30" },
    });
}
else if (__VLS_ctx.training) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({
        ...{ class: "page-title" },
    });
    (__VLS_ctx.training.name);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "mt-1 font-mono text-xs text-ink-light" },
    });
    (__VLS_ctx.step === 'material' ? 1 : __VLS_ctx.step === 'quiz' ? 2 : 3);
    if (__VLS_ctx.step === 'material') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "mt-6 flex flex-col gap-4" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
            ...{ class: "font-mono text-sm text-ink-muted" },
        });
        (__VLS_ctx.training.description);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "flex flex-col gap-2" },
        });
        for (const [link, i] of __VLS_getVForSourceType((__VLS_ctx.training.materialLinks))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.a, __VLS_intrinsicElements.a)({
                key: (i),
                href: (link.url),
                target: "_blank",
                rel: "noopener noreferrer",
                ...{ class: "card flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-lift" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "flex h-9 w-9 items-center justify-center rounded-md bg-pastel-sky/60" },
            });
            const __VLS_4 = {}.FileText;
            /** @type {[typeof __VLS_components.FileText, ]} */ ;
            // @ts-ignore
            const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({
                ...{ class: "h-4 w-4 text-accent" },
            }));
            const __VLS_6 = __VLS_5({
                ...{ class: "h-4 w-4 text-accent" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_5));
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "flex-1 font-sans text-sm font-semibold text-ink" },
            });
            (link.label);
            const __VLS_8 = {}.ExternalLink;
            /** @type {[typeof __VLS_components.ExternalLink, ]} */ ;
            // @ts-ignore
            const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
                ...{ class: "h-4 w-4 text-ink-light" },
            }));
            const __VLS_10 = __VLS_9({
                ...{ class: "h-4 w-4 text-ink-light" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_9));
        }
        if (__VLS_ctx.training.materialLinks.length === 0) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
                ...{ class: "font-mono text-xs text-ink-light" },
            });
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.startTest) },
            ...{ class: "btn-primary self-start" },
        });
    }
    else if (__VLS_ctx.step === 'quiz') {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "mt-6 flex flex-col gap-5" },
        });
        for (const [q, qi] of __VLS_getVForSourceType((__VLS_ctx.training.questions))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                key: (q.id),
                ...{ class: "card p-5" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
                ...{ class: "font-sans text-sm font-semibold text-ink" },
            });
            (qi + 1);
            (q.text);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "mt-3 flex flex-col gap-2" },
            });
            for (const [opt, oi] of __VLS_getVForSourceType((q.options))) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
                    key: (oi),
                    ...{ class: "flex cursor-pointer items-center gap-3 rounded-md border border-line px-3 py-2 font-mono text-sm transition hover:bg-pastel-sky/30" },
                    ...{ class: (__VLS_ctx.answers[qi] === oi ? 'border-accent bg-accent-light/30' : '') },
                });
                __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
                    type: "radio",
                    name: (`q-${q.id}`),
                    value: (oi),
                    ...{ class: "accent-accent" },
                });
                (__VLS_ctx.answers[qi]);
                (opt);
            }
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (__VLS_ctx.submit) },
            ...{ class: "btn-primary self-start" },
            disabled: (!__VLS_ctx.allAnswered || __VLS_ctx.submitting),
        });
        if (__VLS_ctx.submitting) {
            const __VLS_12 = {}.Loader2;
            /** @type {[typeof __VLS_components.Loader2, ]} */ ;
            // @ts-ignore
            const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({
                ...{ class: "h-4 w-4 animate-spin" },
            }));
            const __VLS_14 = __VLS_13({
                ...{ class: "h-4 w-4 animate-spin" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_13));
        }
        (__VLS_ctx.submitting ? 'Grading…' : 'Submit test');
    }
    else if (__VLS_ctx.step === 'result' && __VLS_ctx.result) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
            ...{ class: "mt-6" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "card flex flex-col items-center gap-3 p-8 text-center" },
            ...{ class: (__VLS_ctx.result.passed ? 'bg-pastel-mint/30' : 'bg-rose-50') },
        });
        if (__VLS_ctx.result.passed) {
            const __VLS_16 = {}.PartyPopper;
            /** @type {[typeof __VLS_components.PartyPopper, ]} */ ;
            // @ts-ignore
            const __VLS_17 = __VLS_asFunctionalComponent(__VLS_16, new __VLS_16({
                ...{ class: "h-12 w-12 text-emerald-500" },
            }));
            const __VLS_18 = __VLS_17({
                ...{ class: "h-12 w-12 text-emerald-500" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_17));
        }
        else {
            const __VLS_20 = {}.XCircle;
            /** @type {[typeof __VLS_components.XCircle, ]} */ ;
            // @ts-ignore
            const __VLS_21 = __VLS_asFunctionalComponent(__VLS_20, new __VLS_20({
                ...{ class: "h-12 w-12 text-rose-500" },
            }));
            const __VLS_22 = __VLS_21({
                ...{ class: "h-12 w-12 text-rose-500" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_21));
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({
            ...{ class: "font-sans text-xl font-bold text-ink" },
        });
        (__VLS_ctx.result.passed ? 'Passed 🎉' : 'Not passed');
        __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
            ...{ class: "font-mono text-sm text-ink-muted" },
        });
        (Math.round(__VLS_ctx.result.scorePct * 100));
        (__VLS_ctx.result.correct);
        (__VLS_ctx.result.total);
        (__VLS_ctx.thresholdPct);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "mt-2 flex gap-2" },
        });
        if (!__VLS_ctx.result.passed) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (__VLS_ctx.retry) },
                ...{ class: "btn-primary" },
            });
            const __VLS_24 = {}.RefreshCw;
            /** @type {[typeof __VLS_components.RefreshCw, ]} */ ;
            // @ts-ignore
            const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
                ...{ class: "h-4 w-4" },
            }));
            const __VLS_26 = __VLS_25({
                ...{ class: "h-4 w-4" },
            }, ...__VLS_functionalComponentArgsRest(__VLS_25));
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.loading))
                        return;
                    if (!(__VLS_ctx.training))
                        return;
                    if (!!(__VLS_ctx.step === 'material'))
                        return;
                    if (!!(__VLS_ctx.step === 'quiz'))
                        return;
                    if (!(__VLS_ctx.step === 'result' && __VLS_ctx.result))
                        return;
                    __VLS_ctx.router.push('/dashboard');
                } },
            ...{ class: "btn-ghost" },
        });
        if (!__VLS_ctx.result.passed) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
                ...{ class: "mt-1 font-mono text-[11px] text-ink-light" },
            });
        }
    }
}
/** @type {__VLS_StyleScopedClasses['mx-auto']} */ ;
/** @type {__VLS_StyleScopedClasses['max-w-2xl']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-ghost']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-4']} */ ;
/** @type {__VLS_StyleScopedClasses['!px-3']} */ ;
/** @type {__VLS_StyleScopedClasses['!py-1.5']} */ ;
/** @type {__VLS_StyleScopedClasses['!text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['h-3.5']} */ ;
/** @type {__VLS_StyleScopedClasses['w-3.5']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['h-64']} */ ;
/** @type {__VLS_StyleScopedClasses['animate-pulse']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-pastel-slate/30']} */ ;
/** @type {__VLS_StyleScopedClasses['page-title']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-1']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-6']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-4']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-muted']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-2']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-3']} */ ;
/** @type {__VLS_StyleScopedClasses['p-4']} */ ;
/** @type {__VLS_StyleScopedClasses['transition']} */ ;
/** @type {__VLS_StyleScopedClasses['hover:-translate-y-0.5']} */ ;
/** @type {__VLS_StyleScopedClasses['hover:shadow-lift']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['h-9']} */ ;
/** @type {__VLS_StyleScopedClasses['w-9']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-center']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded-md']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-pastel-sky/60']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['text-accent']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-1']} */ ;
/** @type {__VLS_StyleScopedClasses['font-sans']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['font-semibold']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['self-start']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-6']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-5']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['p-5']} */ ;
/** @type {__VLS_StyleScopedClasses['font-sans']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['font-semibold']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-3']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-2']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['cursor-pointer']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-3']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded-md']} */ ;
/** @type {__VLS_StyleScopedClasses['border']} */ ;
/** @type {__VLS_StyleScopedClasses['border-line']} */ ;
/** @type {__VLS_StyleScopedClasses['px-3']} */ ;
/** @type {__VLS_StyleScopedClasses['py-2']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['transition']} */ ;
/** @type {__VLS_StyleScopedClasses['hover:bg-pastel-sky/30']} */ ;
/** @type {__VLS_StyleScopedClasses['accent-accent']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['self-start']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['animate-spin']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-6']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-3']} */ ;
/** @type {__VLS_StyleScopedClasses['p-8']} */ ;
/** @type {__VLS_StyleScopedClasses['text-center']} */ ;
/** @type {__VLS_StyleScopedClasses['h-12']} */ ;
/** @type {__VLS_StyleScopedClasses['w-12']} */ ;
/** @type {__VLS_StyleScopedClasses['text-emerald-500']} */ ;
/** @type {__VLS_StyleScopedClasses['h-12']} */ ;
/** @type {__VLS_StyleScopedClasses['w-12']} */ ;
/** @type {__VLS_StyleScopedClasses['text-rose-500']} */ ;
/** @type {__VLS_StyleScopedClasses['font-sans']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xl']} */ ;
/** @type {__VLS_StyleScopedClasses['font-bold']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-muted']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-2']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-2']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-ghost']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-1']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-[11px]']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            ArrowLeft: ArrowLeft,
            ExternalLink: ExternalLink,
            FileText: FileText,
            Loader2: Loader2,
            PartyPopper: PartyPopper,
            RefreshCw: RefreshCw,
            XCircle: XCircle,
            router: router,
            training: training,
            loading: loading,
            step: step,
            answers: answers,
            submitting: submitting,
            result: result,
            allAnswered: allAnswered,
            thresholdPct: thresholdPct,
            startTest: startTest,
            submit: submit,
            retry: retry,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
