import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueRouter from 'unplugin-vue-router/vite'
import { resolve } from 'path'
import { isBlockedRemoteDevRequest } from './devProxy'

const disableProxy = process.env.VITE_DISABLE_PROXY === '1'
const remoteApiTarget = process.env.ME3_DEV_API_TARGET?.trim()
const remoteApiUrl = remoteApiTarget ? new URL(remoteApiTarget) : null
if (remoteApiUrl && remoteApiUrl.protocol !== 'https:') {
  throw new Error('ME3_DEV_API_TARGET must use https')
}
const devHost = remoteApiUrl ? 'localhost' : process.env.VITE_HOST || 'localhost'
const devPort = Number(process.env.VITE_PORT || 4000)

export default defineConfig({
  plugins: [
    VueRouter({
      routesFolder: 'src/pages',
      dts: 'src/typed-router.d.ts',
    }),
    vue()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  define: {
    'import.meta.env.VITE_REMOTE_API_HOST': JSON.stringify(remoteApiUrl?.host || ''),
  },
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
    hmr: {
      host: process.env.VITE_HMR_HOST || devHost,
      clientPort: devPort,
    },
    proxy: disableProxy
      ? undefined
      : {
          '/api': {
            target: remoteApiUrl?.origin || 'http://127.0.0.1:8787',
            changeOrigin: true,
            bypass: remoteApiUrl
              ? (req, res) => {
                  if (!isBlockedRemoteDevRequest(req.method, req.url)) return
                  res?.writeHead(403, { 'Content-Type': 'application/json' })
                  res?.end(JSON.stringify({
                    error: 'Campaign send and delete actions are blocked in remote development mode.',
                    code: 'remote_dev_delivery_blocked',
                  }))
                  return req.url || '/api'
                }
              : undefined,
          },
          '/preview': {
            target: remoteApiUrl?.origin || 'http://127.0.0.1:8787',
            changeOrigin: true,
          },
        },
  },
  preview: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/preview': 'http://127.0.0.1:8787',
    },
  },
})
