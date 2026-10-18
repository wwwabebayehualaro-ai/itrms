import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { session } from '../auth/session';

const backendApi = process.env.NEXT_PUBLIC_BACKEND_API;

/**
 * The single HTTP client for the app. It owns authentication (bearer token, one transparent refresh on 401) so
 * features and template data sources never handle credentials. Requests flagged `skipAuth` are sent anonymously.
 */
const axiosInstance = axios.create({
    baseURL: backendApi,
    withCredentials: false
});

type Retriable = InternalAxiosRequestConfig & { _retried?: boolean; skipAuth?: boolean };

/** Unique per call; the transparent retry after a token refresh resends the same config, hence the same key. */
const newIdempotencyKey = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

axiosInstance.interceptors.request.use((config: Retriable) => {
    const token = session.getAccessToken();
    if (token && !config.skipAuth) config.headers.set('Authorization', `Bearer ${token}`);
    // Every POST carries an Idempotency-Key: endpoints that support it (submitting a request, approval decisions, ...) then
    // act once even if the request is sent twice. Endpoints that do not, ignore it.
    if (config.method?.toLowerCase() === 'post' && !config.headers.has('Idempotency-Key')) config.headers.set('Idempotency-Key', newIdempotencyKey());
    return config;
});

axiosInstance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const config = error.config as Retriable | undefined;
        if (error.response?.status === 401 && config && !config._retried && !config.skipAuth && session.hasRefreshToken()) {
            config._retried = true;
            const token = await session.refresh();
            if (token) {
                config.headers.set('Authorization', `Bearer ${token}`);
                return axiosInstance.request(config);
            }
        }
        if (error.response?.status === 401 && !config?.skipAuth && typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth')) {
            session.clear();
            window.location.assign(`/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        }
        return Promise.reject(error);
    }
);

export default axiosInstance;
