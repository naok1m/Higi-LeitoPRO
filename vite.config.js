import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import {
  authApi,
  configureAdminBootstrap,
  configureOracle,
  configureWebhook,
  startOraclePolling,
} from './server/authApi.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  configureWebhook(env.HIGI_WEBHOOK_URL, env.HIGI_WEBHOOK_SECRET);
  configureAdminBootstrap(env.HIGI_ADMIN_EMAIL);
  configureOracle(env);

  return {
    plugins: [
      react(),
      {
        name: 'shared-auth-api',
        configureServer(server) {
          server.middlewares.use(authApi);
          startOraclePolling(server.httpServer);
        },
        configurePreviewServer(server) {
          server.middlewares.use(authApi);
          startOraclePolling(server.httpServer);
        },
      },
    ],
    server: {
      host: '0.0.0.0',
    },
    preview: {
      host: '0.0.0.0',
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  };
});
