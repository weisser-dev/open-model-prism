import axios from 'axios';
import { createMockApi } from '../mocks/mockApi.js';

const DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

// ── Real API (used when DEMO=false) ───────────────────────────────────────────
const realApi = axios.create({
  baseURL: '',
  headers: { 'Content-Type': 'application/json' },
});

realApi.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

realApi.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/')) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Export: mockApi in demo mode, realApi otherwise ───────────────────────────
export const isDemoMode = DEMO;
export default DEMO ? createMockApi() : realApi;
