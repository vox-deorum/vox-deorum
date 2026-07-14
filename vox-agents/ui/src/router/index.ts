import { createRouter, createWebHistory } from 'vue-router'
import { api } from '../api/client'

let envExists = true

try {
  const { exists } = await api.checkEnvFile()
  envExists = exists
} catch {
  // Keep the session page as the fallback when the environment check is unavailable.
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: envExists ? '/session' : '/config'
    },
    {
      path: '/telemetry',
      name: 'telemetry',
      component: () => import('../views/TelemetryView.vue')
    },
    {
      path: '/telemetry/session/:sessionId',
      name: 'telemetry-session',
      component: () => import('../views/TelemetrySessionView.vue')
    },
    {
      path: '/telemetry/database/:filename+',
      name: 'telemetry-database',
      component: () => import('../views/TelemetryDatabaseView.vue')
    },
    {
      path: '/telemetry/database/:filename+/trace/:traceId',
      name: 'telemetry-trace',
      component: () => import('../views/TelemetryTraceView.vue')
    },
    {
      path: '/logs',
      name: 'logs',
      component: () => import('../views/LogsView.vue')
    },
    {
      path: '/session',
      name: 'session',
      component: () => import('../views/SessionView.vue')
    },
    {
      path: '/config',
      name: 'config',
      component: () => import('../views/ConfigView.vue')
    },
    {
      path: '/chat',
      name: 'chat',
      component: () => import('../views/ChatView.vue')
    },
    {
      path: '/chat/:sessionId',
      name: 'chat-detail',
      component: () => import('../views/ChatDetailView.vue')
    }
  ],
})

export default router
