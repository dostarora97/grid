import typegpu from 'unplugin-typegpu/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load all env vars (not just VITE_-prefixed) so the GIPHY key stays server-side.
  const env = loadEnv(mode, process.cwd(), '');
  const giphyKey = env.GIPHY_API_KEY ?? '';

  return {
    plugins: [typegpu({})],
    server: {
      watch: {
        // The agent scratch dir holds a full clone of the TypeGPU repo for local
        // docs; keep Vite from watching/crawling its many tsconfig/html files.
        ignored: ['**/.playground/**'],
      },
      proxy: {
        // Same-origin GIPHY proxy: the browser calls /giphy/v1/gifs/search?q=...,
        // and we forward to api.giphy.com with the API key appended here so the key
        // never enters the client bundle.
        '/giphy': {
          target: 'https://api.giphy.com',
          changeOrigin: true,
          // Don't forward the browser's localhost cookies/referer to GIPHY — they
          // can be large (shared across all localhost dev servers) and GIPHY rejects
          // oversized headers with 400 "Request header or cookie too large".
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('cookie');
              proxyReq.removeHeader('referer');
            });
          },
          rewrite: (path) => {
            const rest = path.replace(/^\/giphy/, '');
            const sep = rest.includes('?') ? '&' : '?';
            return `${rest}${sep}api_key=${giphyKey}`;
          },
        },
      },
    },
  };
});
