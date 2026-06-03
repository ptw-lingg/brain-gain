import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { Loader2 } from 'lucide-vue-next';
import { useAuthStore } from '@/stores/auth';
import client from '@/api/client';
import { signInWithEntra } from '@/auth/msal';
import BrainGainLogo from '@/components/BrainGainLogo.vue';
const auth = useAuthStore();
const router = useRouter();
const email = ref('admin@braingain.app');
const password = ref('admin123');
const loading = ref(false);
const error = ref('');
// Microsoft Entra ID SSO — config is fetched at runtime; the button only shows when enabled.
const ssoEnabled = ref(false);
const ssoConfig = ref(null);
const ssoLoading = ref(false);
onMounted(async () => {
    try {
        const { data } = await client.get('/auth/sso/config');
        if (data.enabled && data.clientId && data.authority) {
            ssoConfig.value = { clientId: data.clientId, authority: data.authority };
            ssoEnabled.value = true;
        }
    }
    catch {
        // No SSO config available → leave the button hidden.
    }
});
/** True when MSAL reports the user closed/cancelled the popup — not a real error. */
function isUserCancellation(e) {
    const code = e?.errorCode;
    return (typeof code === 'string' &&
        ['user_cancelled', 'popup_window_error', 'interaction_in_progress'].includes(code));
}
async function loginWithMicrosoft() {
    if (!ssoConfig.value)
        return;
    error.value = '';
    ssoLoading.value = true;
    try {
        const idToken = await signInWithEntra(ssoConfig.value);
        await auth.loginWithEntra(idToken);
        router.push('/dashboard');
    }
    catch (e) {
        if (axios.isAxiosError(e)) {
            error.value = e.response?.data?.error ?? 'Microsoft sign-in failed';
        }
        else if (!isUserCancellation(e)) {
            error.value = 'Microsoft sign-in failed';
        }
    }
    finally {
        ssoLoading.value = false;
    }
}
const demos = [
    { label: 'Admin', email: 'admin@braingain.app', password: 'admin123' },
    { label: 'Trainer', email: 'trainer@braingain.app', password: 'trainer123' },
    { label: 'Member', email: 'user@braingain.app', password: 'user123' },
];
function fill(d) {
    email.value = d.email;
    password.value = d.password;
}
async function submit() {
    error.value = '';
    loading.value = true;
    try {
        await auth.login(email.value, password.value);
        router.push('/dashboard');
    }
    catch (e) {
        error.value = axios.isAxiosError(e)
            ? (e.response?.data?.error ?? 'Login failed')
            : 'Login failed';
    }
    finally {
        loading.value = false;
    }
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "flex min-h-screen items-center justify-center bg-bg-primary px-4" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "card w-full max-w-md p-8" },
    ...{ style: {} },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "flex flex-col items-center text-center" },
});
/** @type {[typeof BrainGainLogo, ]} */ ;
// @ts-ignore
const __VLS_0 = __VLS_asFunctionalComponent(BrainGainLogo, new BrainGainLogo({
    size: (64),
}));
const __VLS_1 = __VLS_0({
    size: (64),
}, ...__VLS_functionalComponentArgsRest(__VLS_0));
__VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({
    ...{ class: "mt-4 bg-gradient-to-r from-accent to-sky-400 bg-clip-text text-2xl font-bold text-transparent" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "font-mono text-xs text-ink-light" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.form, __VLS_intrinsicElements.form)({
    ...{ onSubmit: (__VLS_ctx.submit) },
    ...{ class: "mt-8 flex flex-col gap-4" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
    ...{ class: "flex flex-col gap-1" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "font-sans text-xs font-semibold text-ink-muted" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
    type: "email",
    autocomplete: "username",
    ...{ class: "bg-input" },
    required: true,
});
(__VLS_ctx.email);
__VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
    ...{ class: "flex flex-col gap-1" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "font-sans text-xs font-semibold text-ink-muted" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
    type: "password",
    autocomplete: "current-password",
    ...{ class: "bg-input" },
    required: true,
});
(__VLS_ctx.password);
if (__VLS_ctx.error) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
        ...{ class: "font-mono text-xs text-rose-600" },
    });
    (__VLS_ctx.error);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    type: "submit",
    ...{ class: "btn-primary mt-2 w-full" },
    disabled: (__VLS_ctx.loading),
});
if (__VLS_ctx.loading) {
    const __VLS_3 = {}.Loader2;
    /** @type {[typeof __VLS_components.Loader2, ]} */ ;
    // @ts-ignore
    const __VLS_4 = __VLS_asFunctionalComponent(__VLS_3, new __VLS_3({
        ...{ class: "h-4 w-4 animate-spin" },
    }));
    const __VLS_5 = __VLS_4({
        ...{ class: "h-4 w-4 animate-spin" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_4));
}
(__VLS_ctx.loading ? 'Signing in…' : 'Sign in');
if (__VLS_ctx.ssoEnabled) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "my-5 flex items-center gap-3" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div)({
        ...{ class: "h-px flex-1 bg-line" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "font-mono text-[10px] uppercase tracking-wider text-ink-light" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div)({
        ...{ class: "h-px flex-1 bg-line" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.loginWithMicrosoft) },
        type: "button",
        ...{ class: "btn-ghost w-full" },
        disabled: (__VLS_ctx.ssoLoading),
    });
    if (__VLS_ctx.ssoLoading) {
        const __VLS_7 = {}.Loader2;
        /** @type {[typeof __VLS_components.Loader2, ]} */ ;
        // @ts-ignore
        const __VLS_8 = __VLS_asFunctionalComponent(__VLS_7, new __VLS_7({
            ...{ class: "h-4 w-4 animate-spin" },
        }));
        const __VLS_9 = __VLS_8({
            ...{ class: "h-4 w-4 animate-spin" },
        }, ...__VLS_functionalComponentArgsRest(__VLS_8));
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.svg, __VLS_intrinsicElements.svg)({
            viewBox: "0 0 21 21",
            ...{ class: "h-4 w-4" },
            'aria-hidden': "true",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.rect)({
            x: "1",
            y: "1",
            width: "9",
            height: "9",
            fill: "#f25022",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.rect)({
            x: "11",
            y: "1",
            width: "9",
            height: "9",
            fill: "#7fba00",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.rect)({
            x: "1",
            y: "11",
            width: "9",
            height: "9",
            fill: "#00a4ef",
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.rect)({
            x: "11",
            y: "11",
            width: "9",
            height: "9",
            fill: "#ffb900",
        });
    }
    (__VLS_ctx.ssoLoading ? 'Signing in…' : 'Sign in with Microsoft');
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "mt-6 border-t border-line pt-4" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "text-center font-mono text-[10px] uppercase tracking-wider text-ink-light" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "mt-2 flex justify-center gap-2" },
});
for (const [d] of __VLS_getVForSourceType((__VLS_ctx.demos))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.fill(d);
            } },
        key: (d.label),
        ...{ class: "btn-ghost !px-3 !py-1 !text-xs" },
    });
    (d.label);
}
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['min-h-screen']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-center']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-bg-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['px-4']} */ ;
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['max-w-md']} */ ;
/** @type {__VLS_StyleScopedClasses['p-8']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['text-center']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-4']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-gradient-to-r']} */ ;
/** @type {__VLS_StyleScopedClasses['from-accent']} */ ;
/** @type {__VLS_StyleScopedClasses['to-sky-400']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-clip-text']} */ ;
/** @type {__VLS_StyleScopedClasses['text-2xl']} */ ;
/** @type {__VLS_StyleScopedClasses['font-bold']} */ ;
/** @type {__VLS_StyleScopedClasses['text-transparent']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-8']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-4']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-1']} */ ;
/** @type {__VLS_StyleScopedClasses['font-sans']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['font-semibold']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-muted']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-input']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-1']} */ ;
/** @type {__VLS_StyleScopedClasses['font-sans']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['font-semibold']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-muted']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-input']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-rose-600']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-2']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['animate-spin']} */ ;
/** @type {__VLS_StyleScopedClasses['my-5']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-3']} */ ;
/** @type {__VLS_StyleScopedClasses['h-px']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-1']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-line']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-[10px]']} */ ;
/** @type {__VLS_StyleScopedClasses['uppercase']} */ ;
/** @type {__VLS_StyleScopedClasses['tracking-wider']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
/** @type {__VLS_StyleScopedClasses['h-px']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-1']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-line']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-ghost']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['animate-spin']} */ ;
/** @type {__VLS_StyleScopedClasses['h-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-4']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-6']} */ ;
/** @type {__VLS_StyleScopedClasses['border-t']} */ ;
/** @type {__VLS_StyleScopedClasses['border-line']} */ ;
/** @type {__VLS_StyleScopedClasses['pt-4']} */ ;
/** @type {__VLS_StyleScopedClasses['text-center']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-[10px]']} */ ;
/** @type {__VLS_StyleScopedClasses['uppercase']} */ ;
/** @type {__VLS_StyleScopedClasses['tracking-wider']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-2']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-center']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-2']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-ghost']} */ ;
/** @type {__VLS_StyleScopedClasses['!px-3']} */ ;
/** @type {__VLS_StyleScopedClasses['!py-1']} */ ;
/** @type {__VLS_StyleScopedClasses['!text-xs']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            Loader2: Loader2,
            BrainGainLogo: BrainGainLogo,
            email: email,
            password: password,
            loading: loading,
            error: error,
            ssoEnabled: ssoEnabled,
            ssoLoading: ssoLoading,
            loginWithMicrosoft: loginWithMicrosoft,
            demos: demos,
            fill: fill,
            submit: submit,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
