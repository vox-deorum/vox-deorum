<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Button from 'primevue/button'
import Drawer from 'primevue/drawer'
import Menu from 'primevue/menu'
import { RouterView } from 'vue-router'
import Tag from 'primevue/tag'
import ConfirmDialog from 'primevue/confirmdialog'
import Toast from 'primevue/toast'
import { healthStatus, startHealthPolling } from './stores/health'

const router = useRouter()
const route = useRoute()

// Drawer visibility state
const drawerVisible = ref(true)

// Dark mode state
const isDarkMode = ref(false)
let stopHealthPolling: (() => void) | null = null

// Toggle dark mode
const toggleDarkMode = () => {
  isDarkMode.value = !isDarkMode.value
  if (isDarkMode.value) {
    document.documentElement.classList.add('dark-mode')
  } else {
    document.documentElement.classList.remove('dark-mode')
  }
  localStorage.setItem('darkMode', isDarkMode.value.toString())
}

// Load dark mode preference on mount
onMounted(() => {
  stopHealthPolling = startHealthPolling()
  const savedDarkMode = localStorage.getItem('darkMode')
  if (savedDarkMode === 'true') {
    isDarkMode.value = true
    document.documentElement.classList.add('dark-mode')
  }
})

// Stop root-level polling when the application is unmounted.
onUnmounted(() => {
  stopHealthPolling?.()
  stopHealthPolling = null
})

// Navigation menu items formatted for PrimeVue Menu component
const menuItems = computed(() => [
  {
    label: 'System',
    items: [
      {
        label: 'Play',
        icon: 'pi pi-play',
        command: () => router.push('/session')
      },
      {
        label: 'Chat',
        icon: 'pi pi-comments',
        command: () => router.push('/chat')
      },
      {
        label: 'Telemetry',
        icon: 'pi pi-chart-line',
        command: () => router.push('/telemetry')
      },
      {
        label: 'Logs',
        icon: 'pi pi-list',
        command: () => router.push('/logs')
      },
      {
        label: 'Settings',
        icon: 'pi pi-cog',
        command: () => router.push('/config')
      }
    ]
  },
  {
    separator: true
  },
  {
    label: 'Links',
    items: [
      {
        label: 'Documentation',
        icon: 'pi pi-question-circle',
        command: () => window.open('https://github.com/CIVITAS-John/vox-deorum/blob/main/README.md', '_blank')
      },
      {
        label: 'Report Issues',
        icon: 'pi pi-exclamation-triangle',
        command: () => window.open('https://github.com/CIVITAS-John/vox-deorum/issues', '_blank')
      },
      {
        label: 'Replay Viewer',
        icon: 'pi pi-video',
        command: () => window.open('https://civitas-john.github.io/vox-deorum-replay', '_blank')
      }
    ]
  }
])

const toggleDrawer = () => {
  drawerVisible.value = !drawerVisible.value
}
</script>

<template>
  <div class="app-container">
    <!-- Global ConfirmDialog for all components -->
    <ConfirmDialog />
    <!-- Global Toast for notifications -->
    <Toast />

    <!-- Menu Toggle Button -->
    <Button
      icon="pi pi-bars"
      @click="toggleDrawer"
      text
      severity="secondary"
      class="p-button-rounded menu-toggle"
      v-tooltip="'Toggle Menu'"
    />

    <!-- PrimeVue Drawer with Menu -->
    <Drawer
      v-model:visible="drawerVisible"
      position="left"
      :dismissable="false"
      :modal="false"
      :show-close-icon="false"
      class="w-16rem"
    >
      <template #header>
        <div class="flex align-items-center gap-2 w-full">
          <i class="pi pi-globe text-primary text-2xl"></i>
          <h2 class="text-primary font-bold m-0">Vox Deorum</h2>
        </div>
      </template>

      <!-- PrimeVue Menu Component -->
      <Menu :model="menuItems" class="w-full border-none" />

      <template #footer>
        <div class="flex flex-column gap-2">
          <div class="flex align-items-center justify-content-between mb-2">
            <Tag :severity="healthStatus?.status === 'error' ? 'danger' : 'success'" class="text-xs">
              <i class="pi pi-circle-fill mr-1" style="font-size: 0.5rem;"></i>
              {{ healthStatus?.status === 'error' ? 'Disconnected' : 'Connected' }}
            </Tag>
            <span class="text-sm text-500">v{{ healthStatus?.version || 'Unknown' }}</span>
          </div>
          <Button
            :icon="isDarkMode ? 'pi pi-sun' : 'pi pi-moon'"
            @click="toggleDarkMode"
            text
            severity="secondary"
            class="w-full"
            :label="isDarkMode ? 'Light Mode' : 'Dark Mode'"
          />
        </div>
      </template>
    </Drawer>

    <!-- Main Content Area -->
    <main class="main-content" :class="{ 'drawer-open': drawerVisible }">
      <div class="surface-section h-full p-4">
        <RouterView />
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-container {
  height: 100vh;
  display: flex;
}

.menu-toggle {
  position: fixed;
  top: 1.75rem;
  left: 1rem;
  z-index: 1100;
}

.main-content {
  flex: 1;
  height: 100vh;
  overflow-y: auto;
  transition: margin-left 0.3s;
}

.main-content.drawer-open {
  margin-left: 16rem;
}
</style>
