const __VLS_props = withDefaults(defineProps(), {
    size: 48,
    showWordmark: false,
});
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_withDefaultsArg = (function (t) { return t; })({
    size: 48,
    showWordmark: false,
});
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "flex items-center gap-3" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.svg, __VLS_intrinsicElements.svg)({
    width: (__VLS_ctx.size),
    height: (__VLS_ctx.size),
    viewBox: "0 0 64 64",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    'aria-label': "BrainGain logo",
    role: "img",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.defs, __VLS_intrinsicElements.defs)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.linearGradient, __VLS_intrinsicElements.linearGradient)({
    id: (`bgGrad-${__VLS_ctx.size}`),
    x1: "0",
    y1: "0",
    x2: "1",
    y2: "1",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.stop)({
    offset: "0",
    'stop-color': "#D0EEFF",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.stop)({
    offset: "1",
    'stop-color': "#2B78E4",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.rect)({
    x: "4",
    y: "4",
    width: "56",
    height: "56",
    rx: "14",
    fill: (`url(#bgGrad-${__VLS_ctx.size})`),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
    d: "M24 20c-4 0-7 3-7 7 0 1.5.5 3 1.5 4-1 1-1.5 2.5-1.5 4 0 4 3 7 7 7h3V20h-3z",
    fill: "none",
    stroke: "#fff",
    'stroke-width': "2.5",
    'stroke-linejoin': "round",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.path)({
    d: "M31 18h2c5 0 9 4 9 9 0 2-.7 3.8-1.8 5.2",
    fill: "none",
    stroke: "#fff",
    'stroke-width': "2.5",
    'stroke-linecap': "round",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.polyline)({
    points: "34,42 40,34 45,38 52,28",
    fill: "none",
    stroke: "#fff",
    'stroke-width': "3",
    'stroke-linecap': "round",
    'stroke-linejoin': "round",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.polyline)({
    points: "47,28 52,28 52,33",
    fill: "none",
    stroke: "#fff",
    'stroke-width': "3",
    'stroke-linecap': "round",
    'stroke-linejoin': "round",
});
if (__VLS_ctx.showWordmark) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "leading-tight" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "bg-gradient-to-r from-accent to-sky-400 bg-clip-text text-xl font-bold text-transparent" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "font-mono text-[10px] text-ink-light" },
    });
}
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-3']} */ ;
/** @type {__VLS_StyleScopedClasses['leading-tight']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-gradient-to-r']} */ ;
/** @type {__VLS_StyleScopedClasses['from-accent']} */ ;
/** @type {__VLS_StyleScopedClasses['to-sky-400']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-clip-text']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xl']} */ ;
/** @type {__VLS_StyleScopedClasses['font-bold']} */ ;
/** @type {__VLS_StyleScopedClasses['text-transparent']} */ ;
/** @type {__VLS_StyleScopedClasses['font-mono']} */ ;
/** @type {__VLS_StyleScopedClasses['text-[10px]']} */ ;
/** @type {__VLS_StyleScopedClasses['text-ink-light']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {};
    },
    __typeProps: {},
    props: {},
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
    __typeProps: {},
    props: {},
});
; /* PartiallyEnd: #4569/main.vue */
