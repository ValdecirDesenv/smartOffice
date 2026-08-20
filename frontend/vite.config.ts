import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Defaults to the host-mapped core-api port (for running `npm run dev` directly on the host);
// the docker-compose `frontend` dev service overrides this to `http://core-api:8080` (Docker DNS).
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8090';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': apiProxyTarget,
      '/uploads': apiProxyTarget,
    },
  },
});
