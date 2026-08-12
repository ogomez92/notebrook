<template>
  <div class="messages-container" ref="containerRef" @keydown="handleKeydown" @focusin="handleFocusIn" tabindex="-1" role="listbox"
    :aria-label="messagesAriaLabel">
    <div class="messages" role="presentation">
      <!-- Regular Messages -->
      <MessageItem v-for="(message, index) in messages" :key="message.id" :message="message"
        :tabindex="index === focusedMessageIndex ? 0 : -1" :data-message-index="index"
        :aria-selected="index === focusedMessageIndex ? 'true' : 'false'"
        :channel-name="showChannelNames ? channelNameFor(message.channel_id) : undefined"
        :match-indices="highlights?.[message.id]"
        @focus="focusedMessageIndex = index"
        @open-dialog="emit('open-message-dialog', $event)"
        @open-dialog-edit="emit('open-message-dialog-edit', $event)"
        @open-links="(links, msg) => emit('open-links', links, msg)" />

      <!-- Unsent Messages -->
      <MessageItem v-for="(unsentMsg, index) in unsentMessages" :key="unsentMsg.id" :message="unsentMsg"
        :is-unsent="true" :tabindex="(messages.length + index) === focusedMessageIndex ? 0 : -1"
        :aria-selected="(messages.length + index) === focusedMessageIndex ? 'true' : 'false'"
        :data-message-index="messages.length + index"
        :channel-name="showChannelNames ? channelNameFor(unsentMsg.channelId) : undefined"
        :match-indices="highlights?.[unsentMsg.id]"
        @focus="focusedMessageIndex = messages.length + index"
        @open-dialog="emit('open-message-dialog', $event)"
        @open-dialog-edit="emit('open-message-dialog-edit', $event)"
        @open-links="(links, msg) => emit('open-links', links, msg)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, watch, computed } from 'vue'
import MessageItem from './MessageItem.vue'
import { useAppStore } from '@/stores/app'
import type { ExtendedMessage, UnsentMessage } from '@/types'
import { extractUrls } from '@/utils/urls'

interface Props {
  messages: ExtendedMessage[]
  unsentMessages?: UnsentMessage[]
  /**
   * Pull focus into the list on mount and when new messages arrive. On for the
   * live channel; off for lists the user is scanning from somewhere else (the
   * search dialog keeps focus in its input until Enter).
   */
  autoFocus?: boolean
  /** Which end `focusList()` jumps to — newest for a channel, best match first for search. */
  focusEdge?: 'first' | 'last'
  /** Override the listbox label. */
  ariaLabel?: string
  /** Fuzzy-match character positions to highlight, keyed by message id. */
  highlights?: Record<string | number, number[]>
  /** Label each message with its channel — for lists that span channels. */
  showChannelNames?: boolean
}

const emit = defineEmits<{
  'message-selected': [message: ExtendedMessage | UnsentMessage, index: number]
  'open-message-dialog': [message: ExtendedMessage | UnsentMessage]
  'open-message-dialog-edit': [message: ExtendedMessage | UnsentMessage]
  'open-links': [links: string[], message: ExtendedMessage | UnsentMessage]
}>()

const props = withDefaults(defineProps<Props>(), {
  unsentMessages: () => [],
  autoFocus: true,
  focusEdge: 'last',
  showChannelNames: false
})

const appStore = useAppStore()

const containerRef = ref<HTMLElement>()
const focusedMessageIndex = ref(0)

// Combined messages array for easier navigation
const allMessages = computed(() => [...props.messages, ...props.unsentMessages])
const totalMessages = computed(() => allMessages.value.length)

const channelNameFor = (channelId: number): string => {
  const channel = appStore.channels.find(c => c.id === channelId)
  return channel?.name || `Channel ${channelId}`
}

// ARIA labels for screen readers
const messagesAriaLabel = computed(() => {
  if (props.ariaLabel) return props.ariaLabel

  const total = totalMessages.value

  if (total === 0) {
    return 'Messages list, no messages'
  } else if (total === 1) {
    return 'Messages list, 1 message'
  } else {
    return `Messages list, ${total} messages`
  }
})

const navigationHint = 'Use arrow keys to navigate, Page Up/Down to jump 10 messages, Home/End for first/last, Enter to select'

// Keyboard navigation
const handleKeydown = (event: KeyboardEvent) => {
  if (totalMessages.value === 0) return

  // Derive current index from actual focused DOM if possible
  const activeIdx = getActiveMessageIndex()
  let currentIndex = activeIdx != null ? activeIdx : focusedMessageIndex.value
  let newIndex = currentIndex

  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault()
      newIndex = Math.max(0, currentIndex - 1)
      break

    case 'ArrowDown':
      event.preventDefault()
      newIndex = Math.min(totalMessages.value - 1, currentIndex + 1)
      break

    case 'PageUp':
      event.preventDefault()
      newIndex = Math.max(0, currentIndex - 10)
      break

    case 'PageDown':
      event.preventDefault()
      newIndex = Math.min(totalMessages.value - 1, currentIndex + 10)
      break

    case 'Home':
      event.preventDefault()
      newIndex = 0
      break

    case 'End':
      event.preventDefault()
      newIndex = totalMessages.value - 1
      break

    case 'Enter':
    case ' ':
      event.preventDefault()
      selectCurrentMessage()
      return

    default:
      return
  }

  if (newIndex !== focusedMessageIndex.value) {
    focusMessage(newIndex)
  }
}

const handleFocusIn = (event: FocusEvent) => {
  const target = event.target as HTMLElement | null
  if (!target) return
  const el = target.closest('[data-message-index]') as HTMLElement | null
  if (!el) return
  const idxAttr = el.getAttribute('data-message-index')
  if (idxAttr == null) return
  const idx = parseInt(idxAttr, 10)
  if (!Number.isNaN(idx) && idx !== focusedMessageIndex.value) {
    focusedMessageIndex.value = idx
  }
}

const focusMessage = (index: number) => {
  focusedMessageIndex.value = index
  nextTick(() => {
    const messageElement = containerRef.value?.querySelector(`[data-message-index="${index}"]`) as HTMLElement
    if (messageElement) {
      messageElement.focus()
      messageElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  })
}

const selectCurrentMessage = () => {
  const currentMessage = allMessages.value[focusedMessageIndex.value]
  if (currentMessage) {
    emit('message-selected', currentMessage, focusedMessageIndex.value)
  }
}

// Method to focus a specific message (for external use, like search results)
const focusMessageById = (messageId: string | number) => {
  const index = allMessages.value.findIndex(msg => msg.id === messageId)
  if (index !== -1) {
    focusMessage(index)
  }
}

/**
 * Move focus into the list, at whichever end `focusEdge` names. Returns false
 * when there is nothing to focus, so callers can leave focus where it was.
 */
const focusList = (): boolean => {
  if (totalMessages.value === 0) return false
  focusMessage(props.focusEdge === 'first' ? 0 : totalMessages.value - 1)
  return true
}

const isNearBottom = (threshold = 48) => {
  const el = containerRef.value
  if (!el) return true
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  return distance <= threshold
}

const isInputActive = () => {
  const active = document.activeElement as HTMLElement | null
  if (!active) return false
  // Keep focus on the message composer when typing/sending
  return !!active.closest('.message-input') && active.classList.contains('base-textarea__field')
}

// Index of the focused message *in this container* — scoped, because the search
// dialog renders a second list over the top of the channel's one.
const getActiveMessageIndex = (): number | null => {
  const active = document.activeElement as HTMLElement | null
  if (!active || !containerRef.value?.contains(active)) return null
  const el = active.closest('[data-message-index]') as HTMLElement | null
  if (!el) return null
  const idx = el.getAttribute('data-message-index')
  return idx != null ? parseInt(idx, 10) : null
}

const scrollToBottom = () => {
  nextTick(() => {
    if (containerRef.value) {
      containerRef.value.scrollTop = containerRef.value.scrollHeight
    }
  })
}

// Watch for list length changes
// - If items were added, move focus to the newest and scroll to bottom.
// - If items were removed, keep current index when possible; otherwise clamp.
watch(
  () => [props.messages.length, props.unsentMessages.length],
  ([newM, newU], [oldM = 0, oldU = 0]) => {
    if (!props.autoFocus) return

    const oldTotal = (oldM ?? 0) + (oldU ?? 0)
    const newTotal = (newM ?? 0) + (newU ?? 0)

    if (newTotal > oldTotal) {
      // New message(s) appended: only jump if user is near bottom and not typing
      const shouldStickToBottom = isNearBottom() || focusedMessageIndex.value === oldTotal - 1
      if (shouldStickToBottom && newTotal > 0) {
        if (isInputActive()) {
          // Preserve input focus; optionally keep scroll at bottom
          scrollToBottom()
        } else {
          focusMessage(newTotal - 1)
          scrollToBottom()
        }
      }
    }
    // For deletions, defer to the totalMessages watcher below to clamp and focus
  }
)

// Reset focus when messages change significantly
watch(() => totalMessages.value, (newTotal, oldTotal) => {
  if (newTotal === 0) return

  // Non-autofocus lists (search results) get re-populated wholesale while the
  // user is typing elsewhere. Keep the roving tabindex valid, but don't grab focus.
  if (!props.autoFocus) {
    const focusIsInList = getActiveMessageIndex() != null
    if (!focusIsInList || focusedMessageIndex.value >= newTotal) {
      focusedMessageIndex.value = props.focusEdge === 'first' ? 0 : newTotal - 1
    }
    return
  }

  if (isInputActive()) return
  const current = focusedMessageIndex.value
  let nextIndex = current
  if (current >= newTotal) {
    // If we deleted the last item, move to the new last
    nextIndex = Math.max(0, newTotal - 1)
  }
  // Avoid double focusing if the correct item is already focused
  const activeIdx = getActiveMessageIndex()
  if (activeIdx !== nextIndex) {
    focusMessage(nextIndex)
  }
})

onMounted(() => {
  if (!props.autoFocus) return

  scrollToBottom()
  // Focus the last message on mount
  if (totalMessages.value > 0) {
    focusMessage(totalMessages.value - 1)
  }
})

const getFocusedMessage = (): ExtendedMessage | UnsentMessage | null => {
  const messages = allMessages.value
  if (focusedMessageIndex.value >= 0 && focusedMessageIndex.value < messages.length) {
    return messages[focusedMessageIndex.value] ?? null
  }
  return null
}

// Handle open URL for the focused message (for mobile button)
const handleOpenUrlFocused = (): { action: 'none' | 'single' | 'multiple', urls: string[], message: ExtendedMessage | UnsentMessage | null } => {
  const message = getFocusedMessage()
  if (!message) {
    return { action: 'none', urls: [], message: null }
  }

  // Don't allow URL opening for unsent messages
  if ('channelId' in message) {
    return { action: 'none', urls: [], message }
  }

  const urls = extractUrls(message.content)

  if (urls.length === 0) {
    return { action: 'none', urls: [], message }
  } else if (urls.length === 1) {
    return { action: 'single', urls, message }
  } else {
    return { action: 'multiple', urls, message }
  }
}

defineExpose({
  scrollToBottom,
  focusMessage,
  focusMessageById,
  focusList,
  getFocusedMessage,
  handleOpenUrlFocused,
  extractUrls
})
</script>

<style scoped>
.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  background: #fafafa;
  /* iOS-specific scroll optimizations */
  -webkit-overflow-scrolling: touch;
  -webkit-scroll-behavior: smooth;
  scroll-behavior: smooth;
  scroll-padding-top: 1rem;
  scroll-padding-bottom: 1rem;
}

.messages-container:focus {
  outline: 2px solid #3b82f6;
  outline-offset: -2px;
}

.messages {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* Scrollbar styling */
.messages-container::-webkit-scrollbar {
  width: 8px;
}

.messages-container::-webkit-scrollbar-track {
  background: #f1f5f9;
}

.messages-container::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}

.messages-container::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .messages-container {
    background: #111827;
  }

  .messages-container:focus {
    outline-color: #60a5fa;
  }

  .messages-container::-webkit-scrollbar-track {
    background: #1f2937;
  }

  .messages-container::-webkit-scrollbar-thumb {
    background: #4b5563;
  }

  .messages-container::-webkit-scrollbar-thumb:hover {
    background: #6b7280;
  }
}
</style>
