import axios from 'axios';
const client = axios.create({
    baseURL: '/api',
});
// Attach JWT to every request.
client.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});
// On 401, clear session and bounce to login.
client.interceptors.response.use((res) => res, (error) => {
    if (error?.response?.status === 401 && localStorage.getItem('token')) {
        localStorage.removeItem('token');
        if (window.location.pathname !== '/login') {
            window.location.assign('/login');
        }
    }
    return Promise.reject(error);
});
export default client;
