import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, __dirname, '')
  const workspaceEnv = loadEnv(mode, resolve(__dirname, '..'), '')
  const mergedEnv = { ...workspaceEnv, ...frontendEnv }
  const apiBaseUrl = mergedEnv.VITE_API_BASE_URL || '/api'
  const apiProxyTarget = /^https?:\/\//.test(apiBaseUrl) ? apiBaseUrl : 'http://localhost:8000'

  const rootViteFallbacks = Object.fromEntries(
    Object.entries(workspaceEnv)
      .filter(([key, value]) => key.startsWith('VITE_') && value !== '' && frontendEnv[key] == null)
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  )

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    define: rootViteFallbacks,
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
