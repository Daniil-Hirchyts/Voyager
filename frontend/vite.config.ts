import { keycloakify } from "keycloakify/vite-plugin";
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const envDir = resolve(__dirname, '..');
  const env = loadEnv(mode, envDir, '');
  const apiBaseUrl = env.VITE_API_BASE_URL || '/api';
  const apiProxyTarget = /^https?:\/\//.test(apiBaseUrl) ? apiBaseUrl : 'http://localhost:8000';
  return {
    envDir,
    plugins: [
      react(),
      tailwindcss(),
      keycloakify({
        themeName: "voyager",
        accountThemeImplementation: "Single-Page"
      })
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/api/, '')
        }
      }
    }
  };
});
