import { createRouter, createWebHistory } from 'vue-router'
import { api } from '../api/client'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('../views/SessionView.vue'),
      beforeEnter: async () => {
        try {
          const { configured } = await api.checkSetupStatus();
          return configured ? '/session' : '/config?setup=1';
        } catch {
          return '/session';
        }
      }
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
      path: '/debug',
      name: 'debug',
      component: () => import('../views/DebugView.vue')
    },
    {
      path: '/debug/writing-desk',
      name: 'writing-desk',
      component: () => import('../views/WritingDeskView.vue')
    },
    {
      path: '/logs',
      redirect: '/debug'
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
