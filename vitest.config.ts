import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { 'cloudflare:workers': fileURLToPath(new URL('./tests/admin/stubs/cloudflare-workers.ts', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
});
