import { defineConfig } from 'vite';
import typegpu from 'unplugin-typegpu/vite';

export default defineConfig({
  plugins: [typegpu({})],
  server: {
    watch: {
      // The agent scratch dir holds a full clone of the TypeGPU repo for local
      // docs; keep Vite from watching/crawling its many tsconfig/html files.
      ignored: ['**/.playground/**'],
    },
  },
});
