import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ mode }) => {
  const isDemo = process.env.VITE_DEMO_MODE === 'true';

  return {
    base: process.env.VITE_BASE || '/',
    plugins: [react()],
    define: {
      // Ensure the env var is available at build time for tree-shaking
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify(process.env.VITE_DEMO_MODE || 'false'),
      'APP_VERSION': JSON.stringify(pkg.version),
    },
    server: {
      port: isDemo ? 5174 : 5173,
      proxy: isDemo ? {} : {
        '/api': 'http://localhost:3000',
        '/health': 'http://localhost:3000',
      },
    },
    build: {
      outDir: isDemo ? 'dist-demo' : 'dist',
    },
  };
});
