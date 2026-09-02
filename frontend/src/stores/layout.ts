import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * Layout claims a routed page can make on the app shell.
 *
 * `immersive` hands the page the WHOLE client area — no shared reading measure, no padding, no page
 * scroll — which embedded content needs to be usable: a SCORM course is authored for a ~1024 px
 * stage and a PDF page is taller than a padded 6xl column. The material viewer and the SCORM player
 * set it while such content is on screen; both MUST clear it again (a watcher plus onBeforeUnmount)
 * so the next page gets the normal measure back.
 */
export const useLayoutStore = defineStore('layout', () => {
  const immersive = ref(false);
  return { immersive };
});
