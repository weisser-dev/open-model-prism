import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// DOCS_BASE_PATH: set to '/docs' when building for Express server embedding.
// Leave unset (defaults to '/') for standalone GH Pages / Cloudflare Pages deployment.
const base = process.env.DOCS_BASE_PATH || '/';

export default defineConfig({
  site: process.env.DOCS_SITE_URL || 'https://github.com/weisser-dev/open-model-prism',
  base,
  trailingSlash: 'ignore',
  vite: {
    plugins: [tailwindcss()],
  },
});
