<template>
  <div class="main-view">
    <!-- Mobile Header -->
    <header class="mobile-header">
      <button 
        class="mobile-menu-button"
        @click="sidebarOpen = !sidebarOpen"
        :aria-label="sidebarOpen ? 'Close menu' : 'Open menu'"
      >
        <Icon name="menu" />
      </button>
      <h1 class="mobile-title">{{ appStore.currentChannel?.name || 'Notebrook' }}</h1>
      <button 
        class="mobile-search-button"
        @click="showSearchDialog = true"
        aria-label="Search messages"
      >
        <Icon name="search" />
      </button>
    </header>

    <!-- Sidebar Overlay -->
    <div 
      v-if="sidebarOpen" 
      class="sidebar-overlay"
      @click="sidebarOpen = false"
    ></div>
    
    <!-- Sidebar -->
    <Sidebar
      :class="{ 'sidebar-open': sidebarOpen }"
      :channels="appStore.channels"
      :current-channel-id="appStore.currentChannelId"
      :unread-counts="unreadCounts"
      @create-channel="showChannelDialog = true"
      @select-channel="(id) => { selectChannel(id); sidebarOpen = false }"
      @channel-info="handleChannelInfo"
      @settings="showSettings = true"
      @close="sidebarOpen = false"
    />
    
    <!-- Main Content -->
    <main
      class="main-content"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <!-- Drag-and-drop upload overlay -->
      <div v-if="isDraggingFile" class="drop-overlay" aria-hidden="true">
        <div class="drop-overlay__inner">
          <div class="drop-overlay__icon">📎</div>
          <p class="drop-overlay__text">
            Drop to upload{{ appStore.currentChannel ? ` to ${appStore.currentChannel.name}` : '' }}
          </p>
        </div>
      </div>

      <div v-if="appStore.currentChannel" class="chat-container">
        <!-- Chat Header (Desktop only) -->
        <ChatHeader
          class="desktop-header"
          :channel-name="appStore.currentChannel.name"
          @search="showSearchDialog = true"
        />
        
        <!-- Messages -->
        <MessagesContainer
          :messages="appStore.currentMessages"
          :unsent-messages="appStore.unsentMessagesForChannel"
          ref="messagesContainer"
          @open-message-dialog="handleOpenMessageDialog"
          @open-message-dialog-edit="handleOpenMessageDialogEdit"
          @open-links="handleOpenLinks"
        />
        
        <!-- Message Input -->
        <MessageInput
          @send-message="handleSendMessage"
          @file-upload="showFileDialog = true"
          @camera="showCameraDialog = true"
          @voice="showVoiceDialog = true"
          @toggle-check="handleToggleCheckFocused"
          @open-url="handleOpenUrlFocused"
          ref="messageInput"
        />
      </div>
      
      <div v-else class="no-channel">
        <p>Select a channel to start chatting</p>
      </div>
    </main>
    
    <!-- Dialogs -->
    <BaseDialog v-model:show="showChannelDialog" title="Create Channel">
      <CreateChannelDialog
        @cancel="showChannelDialog = false"
        @created="handleChannelCreated"
      />
    </BaseDialog>
    
    <BaseDialog v-model:show="showSettings" title="Settings">
      <SettingsDialog @close="showSettings = false" />
    </BaseDialog>
    
    <BaseDialog v-model:show="showSearchDialog" title="Search Messages" size="lg">
      <SearchDialog
        @close="showSearchDialog = false"
        @select-message="handleSelectMessage"
      />
    </BaseDialog>
    
    <BaseDialog v-model:show="showFileDialog" title="Upload Files" size="lg">
      <FileUploadDialog
        @cancel="showFileDialog = false"
        @uploaded="showFileDialog = false"
      />
    </BaseDialog>
    
    <BaseDialog v-model:show="showVoiceDialog" title="Record Voice Message">
      <VoiceRecordingDialog 
        @close="showVoiceDialog = false" 
        @sent="handleVoiceSent"
      />
    </BaseDialog>
    
    <BaseDialog v-model:show="showCameraDialog" title="Take Photo">
      <CameraCaptureDialog 
        @close="showCameraDialog = false" 
        @sent="handleCameraSent"
      />
    </BaseDialog>

    <BaseDialog v-model:show="showChannelInfoDialog" title="Channel Settings">
      <ChannelInfoDialog 
        v-if="selectedChannelForInfo"
        :channel="selectedChannelForInfo"
        @close="showChannelInfoDialog = false" 
      />
    </BaseDialog>

    <BaseDialog v-model:show="showMessageDialog" title="">
      <MessageDialog
        v-if="selectedMessage"
        :message="selectedMessage"
        :open="showMessageDialog"
        :start-editing="shouldStartEditing"
        @close="handleCloseMessageDialog"
        @edit="handleEditMessage"
        @delete="handleDeleteMessage"
        @move="handleMoveMessage"
      />
    </BaseDialog>

    <BaseDialog v-model:show="showLinkDialog" title="Open Link">
      <LinkSelectionDialog
        :links="selectedLinks"
        @close="showLinkDialog = false"
      />
    </BaseDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { useOfflineSync } from '@/composables/useOfflineSync'
import { useWebSocket } from '@/composables/useWebSocket'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useUndo } from '@/composables/useUndo'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useAudio } from '@/composables/useAudio'
import { useFileUpload } from '@/composables/useFileUpload'
import { formatTimestampForScreenReader } from '@/utils/time'
import { apiService } from '@/services/api'
import { syncService } from '@/services/sync'

// Components
import BaseDialog from '@/components/base/BaseDialog.vue'
import Icon from '@/components/base/Icon.vue'
import Sidebar from '@/components/sidebar/Sidebar.vue'
import ChatHeader from '@/components/chat/ChatHeader.vue'
import MessagesContainer from '@/components/chat/MessagesContainer.vue'
import MessageInput from '@/components/chat/MessageInput.vue'
import CreateChannelDialog from '@/components/dialogs/CreateChannelDialog.vue'
import SettingsDialog from '@/components/dialogs/SettingsDialog.vue'
import SearchDialog from '@/components/dialogs/SearchDialog.vue'
import FileUploadDialog from '@/components/dialogs/FileUploadDialog.vue'
import VoiceRecordingDialog from '@/components/dialogs/VoiceRecordingDialog.vue'
import CameraCaptureDialog from '@/components/dialogs/CameraCaptureDialog.vue'
import ChannelInfoDialog from '@/components/dialogs/ChannelInfoDialog.vue'
import MessageDialog from '@/components/dialogs/MessageDialog.vue'
import LinkSelectionDialog from '@/components/dialogs/LinkSelectionDialog.vue'

// Types
import type { ExtendedMessage, UnsentMessage, Channel } from '@/types'

const router = useRouter()
const appStore = useAppStore()
const authStore = useAuthStore()
const toastStore = useToastStore()
const { sendMessage: sendMessageOffline } = useOfflineSync()
const { playWater, playSent, playSound } = useAudio()
const { recordMessageDeletion, undoLastDelete } = useUndo()
const { announce } = useAnnouncer()
const { uploadFiles } = useFileUpload()

// Set up services - ensure token and URL are properly set
if (authStore.token) {
  apiService.setToken(authStore.token)
}
if (authStore.serverUrl) {
  apiService.setBaseUrl(authStore.serverUrl)
}

// Refs
const messagesContainer = ref()
const messageInput = ref()

// Dialog states
const showChannelDialog = ref(false)
const showChannelInfoDialog = ref(false)
const showSettings = ref(false)
const showSearchDialog = ref(false)
const showFileDialog = ref(false)
const showVoiceDialog = ref(false)
const showMessageDialog = ref(false)
const showCameraDialog = ref(false)
const showLinkDialog = ref(false)
const selectedMessage = ref<ExtendedMessage | null>(null)
const shouldStartEditing = ref(false)
const selectedLinks = ref<string[]>([])

// Mobile sidebar state
const sidebarOpen = ref(false)

// Channel info state
const selectedChannelForInfo = ref<Channel | null>(null)

// Mock unread counts (implement real logic later)
const unreadCounts = ref<Record<number, number>>({})

// Set up keyboard shortcuts
const { addShortcut } = useKeyboardShortcuts()

const setupKeyboardShortcuts = () => {
  // Ctrl+Shift+S - Settings
  addShortcut({
    key: 's',
    ctrlKey: true,
    shiftKey: true,
    handler: () => { showSettings.value = true }
  })
  
  // Ctrl+Shift+F - Search
  addShortcut({
    key: 'f',
    ctrlKey: true,
    shiftKey: true,
    handler: () => { showSearchDialog.value = true }
  })
  
  // Ctrl+Z / Cmd+Z - Undo last delete (re-adds most recently deleted message;
  // repeat to walk back down the stack). Marked global so it works from anywhere,
  // including while the message input is focused. The `when` guard backs off when
  // you're actively editing non-empty text so the browser's own text-undo wins.
  const notEditingText = () => {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
    const isTextField = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
    return !(isTextField && !!el!.value && el!.value.length > 0)
  }
  addShortcut({
    key: 'z',
    ctrlKey: true,
    global: true,
    when: notEditingText,
    handler: () => { undoLastDelete() }
  })
  addShortcut({
    key: 'z',
    metaKey: true,
    global: true,
    when: notEditingText,
    handler: () => { undoLastDelete() }
  })

  // Ctrl+K - Channel selector focus
  addShortcut({
    key: 'k',
    ctrlKey: true,
    handler: () => {
      // Focus the first channel in the list
      const firstChannelButton = document.querySelector('.channel-item button') as HTMLElement
      if (firstChannelButton) {
        firstChannelButton.focus()
        toastStore.info('Channel selector focused')
      }
    }
  })
  
  // Ctrl+Shift+X - Channel info
  addShortcut({
    key: 'x',
    ctrlKey: true,
    shiftKey: true,
    handler: () => {
      if (appStore.currentChannel) {
        toastStore.info(`Channel: ${appStore.currentChannel.name} (${appStore.currentMessages.length} messages)`)
      } else {
        toastStore.info('No channel selected')
      }
    }
  })
  
  // Ctrl+Shift+V - Voice message
  addShortcut({
    key: 'v',
    ctrlKey: true,
    shiftKey: true,
    handler: () => { 
      if (appStore.currentChannelId) {
        showVoiceDialog.value = true 
      } else {
        toastStore.info('Select a channel first')
      }
    }
  })
  
  // Space - Focus message input
  addShortcut({
    key: ' ',
    handler: () => { messageInput.value?.focus() }
  })
  
  // Shift+Enter - Open message dialog for focused message
  addShortcut({
    key: 'enter',
    shiftKey: true,
    handler: () => {
      const focusedMessage = messagesContainer.value?.getFocusedMessage()
      if (focusedMessage) {
        handleOpenMessageDialog(focusedMessage)
        toastStore.info('Opening message dialog')
      } else {
        toastStore.info('No message is focused')
      }
    }
  })
  
  // Alt+Numbers - Announce last N messages
  for (let i = 1; i <= 9; i++) {
    addShortcut({
      key: i.toString(),
      altKey: true,
      handler: () => announceLastMessage(i)
    })
  }
  
  // Alt+0 - Announce last 10 messages
  addShortcut({
    key: '0',
    altKey: true,
    handler: () => announceLastMessage(10)
  })
}

const handleToggleCheckFocused = async () => {
  const focused = messagesContainer.value?.getFocusedMessage?.()
  if (!focused || 'channelId' in focused) return
  try {
    const next = (focused as ExtendedMessage).checked !== true
    appStore.setMessageChecked((focused as ExtendedMessage).id, next)
    await apiService.setMessageChecked((focused as ExtendedMessage).channel_id, (focused as ExtendedMessage).id, next)
    toastStore.info(next ? 'Marked as checked' : 'Marked as unchecked')
  } catch (e) {
    toastStore.error('Failed to toggle check')
  }
}

// Handle opening links from a message (when multiple links found)
const handleOpenLinks = (links: string[], message: ExtendedMessage | UnsentMessage) => {
  selectedLinks.value = links
  showLinkDialog.value = true
}

// Handle open URL button press (mobile) - triggers URL opening for focused message
const handleOpenUrlFocused = () => {
  const result = messagesContainer.value?.handleOpenUrlFocused?.()
  if (!result || !result.message) {
    toastStore.info('No message is focused')
    return
  }

  if (result.action === 'none') {
    // No links found, fall back to edit mode
    if ('created_at' in result.message) {
      handleOpenMessageDialogEdit(result.message)
    } else {
      toastStore.info('No links found in this message')
    }
  } else if (result.action === 'single') {
    // Single link, open directly
    window.open(result.urls[0], '_blank', 'noopener,noreferrer')
    toastStore.success('Opening link')
  } else if (result.action === 'multiple') {
    // Multiple links, show selection dialog
    selectedLinks.value = result.urls
    showLinkDialog.value = true
  }
}

const selectChannel = async (channelId: number) => {
  console.log('Selecting channel:', channelId)
  await appStore.setCurrentChannel(channelId)
  
  // Try to sync messages for this channel
  try {
    await syncService.syncChannelMessages(channelId)
    console.log('Channel messages synced')
  } catch (error) {
    console.log('Failed to sync channel messages, using local cache')
  }
  
  scrollToBottom()
  
  // Auto-focus message input when switching channels
  nextTick(() => {
    messageInput.value?.focus()
  })
}

// Paste-to-upload: Ctrl/Cmd+V with file(s) on the clipboard (e.g. a copied
// image or file) uploads them to the current channel. Text-only pastes are left
// untouched so normal typing/pasting still works.
const handlePaste = async (event: ClipboardEvent) => {
  const data = event.clipboardData
  if (!data) return

  // Collect files from both the items list (kind === 'file') and the files
  // list — browsers vary on which they populate — and de-duplicate. Note: most
  // browsers only expose *images* copied to the clipboard (e.g. screenshots);
  // a document copied in the OS file manager usually isn't pasteable, so those
  // fall through and a normal paste happens.
  const files: File[] = []
  const seen = new Set<string>()
  const add = (f: File | null) => {
    if (!f) return
    const key = `${f.name}:${f.size}:${f.type}`
    if (seen.has(key)) return
    seen.add(key)
    files.push(f)
  }
  if (data.items) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]
      if (item && item.kind === 'file') add(item.getAsFile())
    }
  }
  if (data.files) {
    for (let i = 0; i < data.files.length; i++) add(data.files[i] ?? null)
  }
  if (files.length === 0) return // no files — let the default (text) paste happen

  event.preventDefault()

  if (!appStore.currentChannelId) {
    toastStore.info('Select a channel first to upload')
    return
  }

  // uploadFiles shows its own in-progress / success / failure feedback.
  const count = await uploadFiles(files)
  if (count > 0) {
    playSent()
    scrollToBottom()
  }
}

// Drag-and-drop upload: drop file(s) anywhere in the chat area to upload them
// (one message per file) without opening the upload dialog. This is the reliable
// path for arbitrary files, since browser paste only exposes images.
const isDraggingFile = ref(false)
let dragDepth = 0

const dragHasFiles = (event: DragEvent): boolean => {
  const types = event.dataTransfer?.types
  return !!types && Array.from(types).includes('Files')
}

const onDragEnter = (event: DragEvent) => {
  if (!dragHasFiles(event)) return
  event.preventDefault()
  dragDepth++
  isDraggingFile.value = true
}

const onDragOver = (event: DragEvent) => {
  if (!dragHasFiles(event)) return
  event.preventDefault() // required so a drop is allowed to fire
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

const onDragLeave = (event: DragEvent) => {
  if (!dragHasFiles(event)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) isDraggingFile.value = false
}

const onDrop = async (event: DragEvent) => {
  if (!dragHasFiles(event)) return
  event.preventDefault()
  dragDepth = 0
  isDraggingFile.value = false

  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length === 0) return

  if (!appStore.currentChannelId) {
    toastStore.info('Select a channel first to upload')
    return
  }

  // uploadFiles shows its own in-progress / success / failure feedback.
  const count = await uploadFiles(files)
  if (count > 0) {
    playSent()
    scrollToBottom()
  }
}

// Safety net: without this, a file dropped OUTSIDE the chat area makes the
// browser navigate to (open) the file and blow away the app. Swallow those.
const preventStrayFileDrop = (event: DragEvent) => {
  if (dragHasFiles(event)) event.preventDefault()
}

const handleSendMessage = async (content: string) => {
  if (!appStore.currentChannelId) return
  
  console.log('Sending message:', content, 'to channel:', appStore.currentChannelId)
  
  try {
    await syncService.sendMessage(appStore.currentChannelId, content)
    playSent()
    scrollToBottom()
    toastStore.success('Message sent')
  } catch (error) {
    console.error('Failed to send message:', error)
    playWater() // Still play sound for queued message
    scrollToBottom()
    toastStore.error('Message queued for sending when online')
  }
}

const handleSelectMessage = async (message: ExtendedMessage) => {
  showSearchDialog.value = false
  
  // Switch to the correct channel if needed
  if (message.channel_id !== appStore.currentChannelId) {
    await selectChannel(message.channel_id)
  }
  
  // Wait for the DOM to update, then focus the specific message
  await nextTick()
  
  // Use the MessagesContainer's focusMessageById method for proper roving tabindex
  if (messagesContainer.value?.focusMessageById) {
    messagesContainer.value.focusMessageById(message.id)
    
    // Add visual highlight
    await nextTick()
    const messageElement = document.querySelector(`[data-message-id="${message.id}"]`)
    if (messageElement) {
      messageElement.classList.add('message--highlighted')
      setTimeout(() => {
        messageElement.classList.remove('message--highlighted')
      }, 2000)
    }
  } else {
    // Fallback to scrolling to bottom if method not available
    scrollToBottom()
  }
}

// formatTime function removed - now using formatTimestampForScreenReader from utils

const handleVoiceSent = () => {
  // Voice message was sent successfully
  showVoiceDialog.value = false
  scrollToBottom()
  playSent()
}

const handleCameraSent = () => {
  // Photo was sent successfully
  showCameraDialog.value = false
  scrollToBottom()
  playSent()
}

const announceLastMessage = (position: number) => {
  const messages = appStore.currentMessages
  if (!messages || messages.length === 0) {
    toastStore.info('There are no messages in this channel right now')
    return
  }
  
  const messageIndex = messages.length - position
  if (messageIndex < 0) {
    toastStore.info('No message is available in this position')
    return
  }
  
  const message = messages[messageIndex]
  if (!message) {
    toastStore.info('No message is available in this position')
    return
  }

  const timeStr = formatTimestampForScreenReader(message.created_at)
  const announcement = `${message.content}; sent ${timeStr}`

  toastStore.info(announcement)
  announce(announcement)
}

const scrollToBottom = () => {
  messagesContainer.value?.scrollToBottom()
}

// Message dialog handlers
const handleOpenMessageDialog = (message: ExtendedMessage | UnsentMessage) => {
  // Only allow dialog for sent messages (ExtendedMessage), not unsent ones
  if ('created_at' in message) {
    selectedMessage.value = message as ExtendedMessage
    shouldStartEditing.value = false
    showMessageDialog.value = true
  }
}

const handleOpenMessageDialogEdit = (message: ExtendedMessage | UnsentMessage) => {
  // Only allow dialog for sent messages (ExtendedMessage), not unsent ones
  if ('created_at' in message) {
    selectedMessage.value = message as ExtendedMessage
    shouldStartEditing.value = true
    showMessageDialog.value = true
  }
}

const handleCloseMessageDialog = () => {
  showMessageDialog.value = false
  selectedMessage.value = null
  shouldStartEditing.value = false
}

const handleEditMessage = async (messageId: number, content: string) => {
  try {
    if (!appStore.currentChannelId) return
    
    const response = await apiService.updateMessage(appStore.currentChannelId, messageId, content)
    
    // Update the message in the local store
    const messageIndex = appStore.currentMessages.findIndex(m => m.id === messageId)
    if (messageIndex !== -1) {
      const updatedMessage = { ...appStore.currentMessages[messageIndex], content: content }
      appStore.updateMessage(messageId, updatedMessage)
    }
    
    // Update the selected message for the dialog
    if (selectedMessage.value && selectedMessage.value.id === messageId) {
      selectedMessage.value = { ...selectedMessage.value, content: content }
    }
    
    toastStore.success('Message updated successfully')
    handleCloseMessageDialog()
    
  } catch (error) {
    console.error('Failed to edit message:', error)
    toastStore.error('Failed to update message')
  }
}

const handleDeleteMessage = async (messageId: number) => {
  try {
    if (!appStore.currentChannelId) return

    // Capture the message before deletion so we can re-add it on undo.
    const deletedMessage = appStore.currentMessages.find(m => m.id === messageId)

    await apiService.deleteMessage(appStore.currentChannelId, messageId)

    // Remove the message from the local store
    const messageIndex = appStore.currentMessages.findIndex(m => m.id === messageId)
    if (messageIndex !== -1) {
      appStore.currentMessages.splice(messageIndex, 1)
    }

    // Server delete confirmed — record it so Ctrl+Z can re-add it.
    if (deletedMessage) {
      recordMessageDeletion(deletedMessage, deletedMessage.channel_id ?? appStore.currentChannelId)
    }

    toastStore.success('Message deleted — Ctrl+Z to undo')
    handleCloseMessageDialog()
    
  } catch (error) {
    console.error('Failed to delete message:', error)
    toastStore.error('Failed to delete message')
  }
}

const handleMoveMessage = async (messageId: number, targetChannelId: number) => {
  try {
    if (!appStore.currentChannelId) return
    
    // Find the source channel for the message
    let sourceChannelId = appStore.currentChannelId
    const currentMessage = appStore.currentMessages.find(m => m.id === messageId)
    if (currentMessage) {
      sourceChannelId = currentMessage.channel_id
    }
    
    await apiService.moveMessage(sourceChannelId, messageId, targetChannelId)
    
    // Optimistically update local state
    appStore.moveMessage(messageId, sourceChannelId, targetChannelId)
    
    toastStore.success('Message moved successfully')
    handleCloseMessageDialog()
    
  } catch (error) {
    console.error('Failed to move message:', error)
    toastStore.error('Failed to move message')
  }
}

const handleChannelCreated = async (channelId: number) => {
  showChannelDialog.value = false
  await selectChannel(channelId)
}

const handleChannelInfo = (channel: Channel) => {
  selectedChannelForInfo.value = channel
  showChannelInfoDialog.value = true
}

const isUnsentMessage = (messageId: string | number): boolean => {
  return typeof messageId === 'string' && messageId.startsWith('unsent_')
}

// Update document title when channel changes
watch(() => appStore.currentChannel, (channel) => {
  if (channel) {
    document.title = `${channel.name} - Notebrook`
  } else {
    document.title = 'Notebrook'
  }
}, { immediate: true })

// Initialize
onMounted(async () => {
  // 1. Load saved state first (offline-first)
  console.log('Loading local state...')
  await appStore.loadState()
  console.log('Local state loaded. Channels:', appStore.channels.length, 'Current channel:', appStore.currentChannelId, 'Unsent messages:', appStore.unsentMessages.length)
  
  // 2. Try to sync with server (when online)
  try {
    console.log('Syncing with server...')
    await syncService.fullSync()
    toastStore.success('Synced with server')
  } catch (error) {
    console.log('Failed to sync with server, working offline with cached data')
    if (appStore.channels.length === 0) {
      toastStore.error('No internet connection and no cached data available')
    } else {
      toastStore.info('Working offline with cached data')
    }
  }
  
  // 3. WebSocket connection (will gracefully fail if offline)
  useWebSocket()
  
  // 4. Set up keyboard shortcuts + paste-to-upload + drag-drop safety net
  setupKeyboardShortcuts()
  document.addEventListener('paste', handlePaste)
  window.addEventListener('dragover', preventStrayFileDrop)
  window.addEventListener('drop', preventStrayFileDrop)
  
  // 5. Auto-select first channel if none selected and we have channels
  if (!appStore.currentChannelId && appStore.channels.length > 0) {
    const firstChannel = appStore.channels[0]
    if (firstChannel) {
      await selectChannel(firstChannel.id)
    }
  }
  
  // 6. Auto-focus message input on page load
  nextTick(() => {
    messageInput.value?.focus()
  })
  
  // 7. Set up periodic sync for unsent messages
  const syncInterval = setInterval(async () => {
    if (appStore.unsentMessages.length > 0) {
      try {
        console.log(`Attempting to sync ${appStore.unsentMessages.length} unsent messages`)
        await syncService.retryUnsentMessages()
      } catch (error) {
        console.log('Background sync failed, will try again later')
      }
    }
  }, 30000) // Every 30 seconds
  
  // Cleanup interval on unmount
  const cleanup = () => clearInterval(syncInterval)
  window.addEventListener('beforeunload', cleanup)
})

onUnmounted(() => {
  document.removeEventListener('paste', handlePaste)
  window.removeEventListener('dragover', preventStrayFileDrop)
  window.removeEventListener('drop', preventStrayFileDrop)
})
</script>

<style scoped>
.main-view {
  display: flex;
  height: var(--vh-dynamic, 100vh);
  background: #ffffff;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative; /* positioning context for the drag-drop overlay */
}

/* Drag-and-drop upload overlay */
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(59, 130, 246, 0.12);
  backdrop-filter: blur(1px);
  pointer-events: none; /* let drag events reach .main-content underneath */
}

.drop-overlay__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 3rem;
  border: 2px dashed #3b82f6;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.9);
  color: #1e40af;
  font-weight: 600;
}

.drop-overlay__icon {
  font-size: 2.5rem;
  line-height: 1;
}

.drop-overlay__text {
  margin: 0;
  font-size: 1rem;
}

@media (prefers-color-scheme: dark) {
  .drop-overlay {
    background: rgba(59, 130, 246, 0.18);
  }
  .drop-overlay__inner {
    background: rgba(31, 41, 55, 0.92);
    color: #bfdbfe;
    border-color: #60a5fa;
  }
}

.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.no-channel {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #6b7280;
  font-size: 1.125rem;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .main-view {
    background: #111827;
  }
  
  .no-channel {
    color: rgba(255, 255, 255, 0.6);
  }
}

.mobile-header {
  display: none;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  padding-top: calc(1rem + var(--safe-area-inset-top));
  padding-left: calc(1rem + var(--safe-area-inset-left));
  padding-right: calc(1rem + var(--safe-area-inset-right));
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 500; /* Higher than sidebar to prevent conflicts */
}

.mobile-menu-button,
.mobile-search-button {
  background: none;
  border: none;
  padding: 0.75rem;
  cursor: pointer;
  color: #6b7280;
  min-height: 2.75rem; /* 44px minimum for iOS */
  min-width: 2.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  /* iOS-specific optimizations */
  -webkit-appearance: none;
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
}

.mobile-menu-button:hover,
.mobile-search-button:hover {
  color: #374151;
}

.mobile-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
  color: #111827;
}

.sidebar-overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 200;
}

/* Responsive design */
@media (max-width: 768px) {
  .main-view {
    flex-direction: column;
    height: var(--vh-dynamic, 100vh);
  }
  
  .mobile-header {
    display: flex;
    flex-shrink: 0;
  }
  
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    height: var(--vh-dynamic, 100vh);
    transform: translateX(-100%);
    transition: transform 0.3s ease, visibility 0.3s ease;
    z-index: 400; /* Lower than mobile header but higher than overlay */
    visibility: hidden; /* Completely hide when closed */
  }
  
  .sidebar.sidebar-open {
    transform: translateX(0);
    visibility: visible;
  }
  
  .sidebar-overlay {
    display: block;
  }
  
  .main-content {
    flex: 1;
    overflow: hidden;
    padding-top: var(--header-total-height); /* Account for fixed header height with safe area */
  }
  
  .chat-container {
    height: 100%;
  }
  
  .desktop-header {
    display: none;
  }
}

@media (prefers-color-scheme: dark) {
  .mobile-header {
    background: #1f2937;
    border-bottom-color: #374151;
  }
  
  .mobile-title {
    color: rgba(255, 255, 255, 0.87);
  }
  
  .mobile-menu-button,
  .mobile-search-button {
    color: rgba(255, 255, 255, 0.6);
  }
  
  .mobile-menu-button:hover,
  .mobile-search-button:hover {
    color: rgba(255, 255, 255, 0.87);
  }
}
</style>
