// Thin wrapper around MSAL.js for the "Sign in with Microsoft" flow.
//
// The Entra config (client id + authority) is supplied at runtime by the backend
// (GET /api/auth/sso/config), so MSAL is only constructed when SSO is actually enabled.
// We use the popup flow: it returns the ID token in-page, so no callback route is needed.
import { createStandardPublicClientApplication, } from '@azure/msal-browser';
let msalPromise = null;
let msalKey = '';
/** Lazily build (and cache) a PublicClientApplication. Rebuilds if the config changes. */
function getMsal(config) {
    const key = `${config.clientId}|${config.authority}`;
    if (!msalPromise || msalKey !== key) {
        msalKey = key;
        // The factory runs MSAL v3+'s required initialize() for us.
        msalPromise = createStandardPublicClientApplication({
            auth: {
                clientId: config.clientId,
                authority: config.authority,
                redirectUri: window.location.origin,
            },
            cache: { cacheLocation: 'sessionStorage' },
        });
    }
    return msalPromise;
}
/** Open the Microsoft sign-in popup and return the raw ID token (a JWT) for the backend to verify. */
export async function signInWithEntra(config) {
    const msal = await getMsal(config);
    const result = await msal.loginPopup({ scopes: ['openid', 'profile', 'email'] });
    msal.setActiveAccount(result.account);
    return result.idToken;
}
/** Best-effort local cache clear (no full Microsoft sign-out). Safe to call when SSO was never used. */
export async function signOutEntra() {
    if (!msalPromise)
        return;
    try {
        const msal = await msalPromise;
        await msal.clearCache();
    }
    catch {
        /* ignore — clearing the local cache is best-effort */
    }
}
