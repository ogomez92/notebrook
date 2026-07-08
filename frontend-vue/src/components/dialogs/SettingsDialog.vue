<template>
  <div class="settings-dialog">
    <form @submit.prevent="handleSave" class="settings-form">
      <div class="setting-group">
        <h3>Audio Settings</h3>
        
        <label class="setting-item">
          <input 
          ref="soundInput"
            type="checkbox" 
            v-model="localSettings.soundEnabled"
            class="checkbox"
          />
          <span>Enable sound effects</span>
        </label>
      </div>

      <div class="setting-group">
        <h3>Appearance</h3>
        
        <div class="setting-item">
          <label for="theme-select">Theme</label>
          <select 
            id="theme-select" 
            v-model="localSettings.theme"
            class="select"
          >
            <option value="auto">Auto (System)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>
      
      <div class="setting-group" v-if="appStore.channels.length > 0">
        <h3>Default Channel</h3>
        
        <div class="setting-item">
          <label for="default-channel-select">Default Channel</label>
          <select 
            id="default-channel-select" 
            v-model="localSettings.defaultChannelId"
            class="select"
          >
            <option :value="null">None</option>
            <option 
              v-for="channel in appStore.channels" 
              :key="channel.id"
              :value="channel.id"
            >
              {{ channel.name }}
            </option>
          </select>
        </div>
      </div>

      <div class="setting-group">
        <h3>Data Backup</h3>

        <p class="setting-description">
          Download a complete backup of all channels, messages, and data. Restore will replace all existing data.
        </p>

        <div class="setting-actions">
          <BaseButton
            type="button"
            variant="secondary"
            @click="handleBackup"
            :loading="isBackingUp"
          >
            Download Backup
          </BaseButton>

          <BaseButton
            type="button"
            variant="secondary"
            @click="triggerRestoreInput"
            :disabled="isRestoring"
          >
            Restore from Backup
          </BaseButton>
          <input
            ref="restoreInput"
            type="file"
            accept=".db,.sqlite,.sqlite3"
            style="display: none"
            @change="handleRestoreFileSelect"
          />
        </div>
      </div>

      <div class="setting-group">
        <h3>Export Data</h3>

        <p class="setting-description">
          Export all channels and messages in various formats.
        </p>

        <div class="setting-item">
          <label for="export-format">Format</label>
          <select id="export-format" v-model="exportFormat" class="select">
            <option value="markdown">Markdown (zipped)</option>
            <option value="html-single">HTML (single file)</option>
            <option value="html-individual">HTML (individual files, zipped)</option>
          </select>
        </div>

        <div class="setting-actions">
          <BaseButton
            type="button"
            variant="secondary"
            @click="handleExport"
            :loading="isExporting"
          >
            Export
          </BaseButton>
        </div>
      </div>

      <div class="setting-group">
        <h3>Account</h3>

        <div class="setting-item">
          <label>Current Server</label>
          <div class="server-info">
            {{ currentServerUrl || 'Default' }}
          </div>
        </div>

        <div class="setting-actions">
          <BaseButton
            type="button"
            variant="secondary"
            @click="handleLogout"
            :disabled="isSaving"
          >
            Logout
          </BaseButton>

          <BaseButton
            type="button"
            variant="danger"
            @click="showResetConfirm = true"
            :disabled="isSaving"
          >
            Reset All Data
          </BaseButton>
        </div>
      </div>

      <div class="form-actions">
        <BaseButton
          type="button"
          variant="secondary"
          @click="$emit('close')"
        >
          Cancel
        </BaseButton>
        <BaseButton
          type="submit"
          :loading="isSaving"
        >
          Save Settings
        </BaseButton>
      </div>
    </form>
    
    <!-- Reset Data Confirmation Dialog -->
    <div v-if="showResetConfirm" class="confirm-overlay">
      <div class="confirm-dialog">
        <h3>Reset All Data</h3>
        <p>This will permanently delete all local data including messages, settings, and authentication. This cannot be undone.</p>
        <div class="confirm-actions">
          <BaseButton
            type="button"
            variant="secondary"
            @click="showResetConfirm = false"
          >
            Cancel
          </BaseButton>
          <BaseButton
            type="button"
            variant="danger"
            @click="handleResetData"
            :loading="isResetting"
          >
            Reset All Data
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Restore Confirmation Dialog -->
    <div v-if="showRestoreConfirm" class="confirm-overlay">
      <div class="confirm-dialog">
        <h3>Restore from Backup</h3>
        <p>This will replace all existing data with the backup. All current channels, messages, and data will be overwritten. This cannot be undone.</p>
        <p v-if="pendingRestoreFile" class="file-info">
          File: {{ pendingRestoreFile.name }}
        </p>
        <div class="confirm-actions">
          <BaseButton
            type="button"
            variant="secondary"
            @click="cancelRestore"
          >
            Cancel
          </BaseButton>
          <BaseButton
            type="button"
            variant="danger"
            @click="handleRestore"
            :loading="isRestoring"
          >
            Restore Backup
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { apiService } from '@/services/api'
import { syncService } from '@/services/sync'
import { getExporter, downloadBlob, type ExportFormat } from '@/utils/export'
import { clear } from 'idb-keyval'
import BaseButton from '@/components/base/BaseButton.vue'
import type { AppSettings } from '@/types'

const emit = defineEmits<{
  close: []
}>()

const router = useRouter()
const appStore = useAppStore()
const authStore = useAuthStore()
const toastStore = useToastStore()

const isSaving = ref(false)
const isResetting = ref(false)
const isBackingUp = ref(false)
const isRestoring = ref(false)
const isExporting = ref(false)
const exportFormat = ref<ExportFormat>('markdown')
const showResetConfirm = ref(false)
const showRestoreConfirm = ref(false)
const pendingRestoreFile = ref<File | null>(null)
const soundInput = ref()
const restoreInput = ref<HTMLInputElement>()

// Computed property for current server URL
const currentServerUrl = computed(() => authStore.serverUrl)
const localSettings = reactive<AppSettings>({
  soundEnabled: true,
  defaultChannelId: null,
  theme: 'auto'
})

const handleSave = async () => {
  isSaving.value = true
  
  try {
    await appStore.updateSettings(localSettings)
    toastStore.success('Settings saved successfully!')
    emit('close')
  } catch (error) {
    console.error('Failed to save settings:', error)
    toastStore.error('Failed to save settings')
  } finally {
    isSaving.value = false
  }
}

const handleLogout = async () => {
  try {
    await authStore.clearAuth()
    toastStore.success('Logged out successfully')
    emit('close')
    router.push('/auth')
  } catch (error) {
    console.error('Logout failed:', error)
    toastStore.error('Logout failed')
  }
}

const handleResetData = async () => {
  isResetting.value = true

  try {
    // Clear all IndexedDB data
    await clear()

    // Clear stores
    await authStore.clearAuth()
    appStore.$reset()

    toastStore.success('All data has been reset')
    showResetConfirm.value = false
    emit('close')

    // Redirect to auth page
    router.push('/auth')
  } catch (error) {
    console.error('Reset failed:', error)
    toastStore.error('Failed to reset data')
  } finally {
    isResetting.value = false
  }
}

const handleBackup = async () => {
  isBackingUp.value = true

  try {
    await apiService.downloadBackup()
    toastStore.success('Backup downloaded successfully')
  } catch (error) {
    console.error('Backup failed:', error)
    toastStore.error('Failed to download backup')
  } finally {
    isBackingUp.value = false
  }
}

const triggerRestoreInput = () => {
  restoreInput.value?.click()
}

const handleRestoreFileSelect = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (file) {
    pendingRestoreFile.value = file
    showRestoreConfirm.value = true
  }

  // Reset input so the same file can be selected again
  input.value = ''
}

const handleRestore = async () => {
  if (!pendingRestoreFile.value) return

  isRestoring.value = true

  try {
    const result = await apiService.restoreBackup(pendingRestoreFile.value)
    toastStore.success(`Restored ${result.stats.channels} channels, ${result.stats.messages} messages`)

    // Clear local cache and reload data
    await clear()
    appStore.$reset()

    showRestoreConfirm.value = false
    pendingRestoreFile.value = null
    emit('close')

    // Reload the page to refresh all data
    window.location.reload()
  } catch (error) {
    console.error('Restore failed:', error)
    toastStore.error((error as Error).message || 'Failed to restore backup')
  } finally {
    isRestoring.value = false
  }
}

const cancelRestore = () => {
  showRestoreConfirm.value = false
  pendingRestoreFile.value = null
}

const handleExport = async () => {
  isExporting.value = true

  try {
    // Sync all channels before exporting to ensure we have all messages
    toastStore.info('Syncing all channels...')
    for (const channel of appStore.channels) {
      await syncService.syncChannelMessages(channel.id)
    }

    const exporter = getExporter(exportFormat.value)
    const blob = await exporter.export(appStore.channels, appStore.messages)
    downloadBlob(blob, exporter.filename)
    toastStore.success('Export completed')
  } catch (error) {
    console.error('Export failed:', error)
    toastStore.error('Export failed')
  } finally {
    isExporting.value = false
  }
}

onMounted(() => {
  // Copy current settings to local state
  Object.assign(localSettings, appStore.settings)
  soundInput.value.focus();
})
</script>

<style scoped>
.settings-dialog {
  padding: 1rem 0;
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.setting-group h3 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: #374151;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.5rem;
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

.setting-item label {
  font-weight: 500;
  color: #374151;
}

.setting-description {
  margin: 0;
  font-size: 0.875rem;
  color: #6b7280;
  line-height: 1.5;
}

.file-info {
  font-family: monospace;
  font-size: 0.875rem;
  background: #f3f4f6;
  padding: 0.5rem;
  border-radius: 4px;
  word-break: break-all;
}

.checkbox {
  width: 1.25rem;
  height: 1.25rem;
  accent-color: #646cff;
  cursor: pointer;
}

.select {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  color: #111827;
  font-size: 0.875rem;
  min-width: 150px;
  cursor: pointer;
}

.select:focus {
  outline: none;
  border-color: #646cff;
  box-shadow: 0 0 0 3px rgba(100, 108, 255, 0.1);
}

.slider {
  width: 100%;
  max-width: 200px;
  height: 4px;
  border-radius: 2px;
  background: #e5e7eb;
  outline: none;
  cursor: pointer;
  appearance: none;
}

.slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #646cff;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #646cff;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid #e5e7eb;
}

.server-info {
  padding: 0.5rem;
  background: #f9fafb;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.875rem;
  color: #374151;
  word-break: break-all;
}

.setting-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}

.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.confirm-dialog {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 400px;
  margin: 1rem;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.confirm-dialog h3 {
  margin: 0 0 1rem 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: #dc2626;
}

.confirm-dialog p {
  margin: 0 0 1.5rem 0;
  color: #6b7280;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .setting-group h3 {
    color: rgba(255, 255, 255, 0.87);
    border-bottom-color: #374151;
  }
  
  .setting-item label {
    color: rgba(255, 255, 255, 0.87);
  }
  
  .select {
    background: #374151;
    color: rgba(255, 255, 255, 0.87);
    border-color: #4b5563;
  }
  
  .form-actions {
    border-top-color: #374151;
  }
  
  .server-info {
    color: rgba(255, 255, 255, 0.87);
  }
  
  .confirm-overlay {
    background: rgba(0, 0, 0, 0.8);
  }
  
  .confirm-dialog {
    background: #1f2937;
  }
  
  .confirm-dialog h3 {
    color: rgba(255, 255, 255, 0.87);
  }
  
  .confirm-dialog p {
    color: rgba(255, 255, 255, 0.6);
  }

  .setting-description {
    color: rgba(255, 255, 255, 0.6);
  }

  .file-info {
    background: #374151;
    color: rgba(255, 255, 255, 0.87);
  }
}
</style>