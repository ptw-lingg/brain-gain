import { defineStore } from 'pinia';
import { ref } from 'vue';
import client from '@/api/client';
export const useAuthStore = defineStore('auth', () => {
    const user = ref(null);
    const token = ref(localStorage.getItem('token'));
    async function login(email, password) {
        const { data } = await client.post('/auth/login', {
            email,
            password,
        });
        token.value = data.token;
        user.value = data.user;
        localStorage.setItem('token', data.token);
    }
    // Exchange a Microsoft Entra ID token (from MSAL) for our own app JWT. Stores the session
    // identically to password login, so everything downstream (interceptor, guard, /me) is unchanged.
    async function loginWithEntra(idToken) {
        const { data } = await client.post('/auth/sso/entra', {
            idToken,
        });
        token.value = data.token;
        user.value = data.user;
        localStorage.setItem('token', data.token);
    }
    async function fetchMe() {
        if (!token.value)
            return;
        const { data } = await client.get('/auth/me');
        user.value = data;
    }
    function logout() {
        user.value = null;
        token.value = null;
        localStorage.removeItem('token');
    }
    return { user, token, login, loginWithEntra, fetchMe, logout };
});
