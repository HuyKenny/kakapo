// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://kakapo.cz',
  // Listings and hotel pages render on demand from D1; a price change must not need a rebuild.
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false,
  // Keep the WordPress URL shape: /zajezdy/ etc. keep the trailing slash, redirects live in the middleware.
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'never' },
  security: { checkOrigin: false },
  vite: {
    build: { assetsInlineLimit: 0 },
    // Part of every edge-cache key: a deploy never serves HTML rendered by the previous build.
    define: { __BUILD_ID__: JSON.stringify(process.env.BUILD_ID ?? String(Date.now())) },
  },
});
