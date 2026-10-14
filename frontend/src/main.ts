import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { i18n } from './i18n';
import './style.css';
import 'flag-icons/css/flag-icons.min.css';

// Microsoft sign-in returns its popup to the app's origin with the authorisation response in the URL
// (redirectUri = window.location.origin, see auth/msal.ts) — for the login AND for the completion
// signature's re-login. Since msal-browser 4 that page must hand the response to the main window
// itself, through MSAL's redirect bridge; the main window no longer reads the popup's address. Booting
// the app there instead lets the router send the popup to /login, which swallows the response: the
// popup stays open showing the login page and the sign-in never finishes (SYS-SSO-10). So a URL
// carrying an auth response never boots the app; it relays the response and closes.
const authUrl = `${window.location.search}${window.location.hash}`;
const isAuthResponse = /[?#&](code|error)=/.test(authUrl) && /[?#&]state=/.test(authUrl);

if (isAuthResponse) {
  import('@azure/msal-browser/redirect-bridge')
    .then(({ broadcastResponseToMainFrame }) => broadcastResponseToMainFrame())
    .then(() => window.close())
    .catch((err: unknown) => {
      // Not a popup MSAL started (a stale or hand-typed URL): say so instead of showing a blank page.
      document.body.textContent = `Microsoft sign-in could not be completed: ${err instanceof Error ? err.message : String(err)}`;
    });
} else {
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.use(i18n);
  app.mount('#app');
}
