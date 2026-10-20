import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// O Vite cuida só do frontend. Em desenvolvimento, /api é repassado para a API
// (npm run dev:api); em produção a própria API serve a pasta dist/.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = `http://127.0.0.1:${env.PORT || 3000}`;

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      proxy: { '/api': { target: apiTarget } },
    },
    preview: {
      host: '0.0.0.0',
      proxy: { '/api': { target: apiTarget } },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  };
});
