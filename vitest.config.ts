import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only our own unit tests — never the local TypeGPU docs clone in .playground.
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.playground/**'],
  },
});
