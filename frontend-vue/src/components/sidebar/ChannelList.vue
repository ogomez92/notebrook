<template>
  <div class="channel-list-container">
    <ul
      ref="listRef"
      class="channel-list"
      role="listbox"
      aria-label="Channels"
      @keydown="handleKeydown"
      @focusin="handleFocusin"
    >
      <ChannelListItem
        v-for="channel in channels"
        :key="channel.id"
        :channel="channel"
        :is-active="channel.id === currentChannelId"
        :unread-count="unreadCounts[channel.id]"
        :tabbable="channel.id === tabStopId"
        @select="emit('select-channel', $event)"
      />
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import ChannelListItem from './ChannelListItem.vue'
import type { Channel } from '@/types'

interface Props {
  channels: Channel[]
  currentChannelId: number | null
  unreadCounts: Record<number, number>
}

const emit = defineEmits<{
  'select-channel': [channelId: number]
  'channel-info': [channel: Channel]
}>()

const props = defineProps<Props>()

const listRef = ref<HTMLUListElement>()

// Roving tabindex: exactly one option is tabbable. It's tracked by channel id
// rather than position so it stays on the same channel when channels are added
// or reordered. Until the user moves it, it sits on the current channel.
const focusedChannelId = ref<number | null>(null)

const tabStopId = computed(() => {
  const has = (id: number | null) => id !== null && props.channels.some(c => c.id === id)
  if (has(focusedChannelId.value)) return focusedChannelId.value
  if (has(props.currentChannelId)) return props.currentChannelId
  return props.channels[0]?.id ?? null
})

// Switching channels from elsewhere (search, create) moves the tab stop along.
watch(() => props.currentChannelId, () => {
  focusedChannelId.value = null
})

const optionElement = (channelId: number) =>
  listRef.value?.querySelector<HTMLElement>(`[role="option"][data-channel-id="${channelId}"]`)

const channelIdFromEvent = (event: Event): number | null => {
  const id = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]')?.dataset.channelId
  return id === undefined ? null : Number(id)
}

const focusChannel = (index: number) => {
  const channel = props.channels[index]
  if (channel) optionElement(channel.id)?.focus()
}

const handleFocusin = (event: FocusEvent) => {
  const id = channelIdFromEvent(event)
  if (id !== null) focusedChannelId.value = id
}

// Type-ahead. Typing a name ("in") moves to the next channel starting with it;
// repeating one character ("i", "i", "i") cycles through channels starting
// with that character. The buffer clears after a pause.
const TYPEAHEAD_RESET_MS = 1000
let typeaheadBuffer = ''
let typeaheadTimer: ReturnType<typeof setTimeout> | undefined

const typeahead = (char: string, fromIndex: number) => {
  clearTimeout(typeaheadTimer)
  typeaheadTimer = setTimeout(() => { typeaheadBuffer = '' }, TYPEAHEAD_RESET_MS)
  const key = char.toLocaleLowerCase()
  typeaheadBuffer += key

  const isRepeat = Array.from(typeaheadBuffer).every(c => c === key)
  const query = isRepeat ? key : typeaheadBuffer
  // A lone or repeated character moves past the focused channel; a longer
  // name may still match it, in which case focus stays put.
  const start = isRepeat ? fromIndex + 1 : fromIndex

  const count = props.channels.length
  for (let offset = 0; offset < count; offset++) {
    const index = (start + offset) % count
    if (props.channels[index]?.name.toLocaleLowerCase().startsWith(query)) {
      focusChannel(index)
      return
    }
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  const channelId = channelIdFromEvent(event)
  const index = props.channels.findIndex(c => c.id === channelId)
  const channel = props.channels[index]
  if (!channel) return

  // Alt+Enter - settings for the focused channel (the "properties" key, as in
  // Windows Explorer). It needs a modifier: bare letters belong to type-ahead.
  if (event.key === 'Enter' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    event.preventDefault()
    emit('channel-info', channel)
    return
  }

  // Leave other modified keys to the global shortcuts
  if (event.ctrlKey || event.altKey || event.metaKey) return

  const lastIndex = props.channels.length - 1

  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault()
      focusChannel(Math.max(0, index - 1))
      break
    case 'ArrowDown':
      event.preventDefault()
      focusChannel(Math.min(lastIndex, index + 1))
      break
    case 'Home':
      event.preventDefault()
      focusChannel(0)
      break
    case 'End':
      event.preventDefault()
      focusChannel(lastIndex)
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      emit('select-channel', channel.id)
      break
    default:
      // Any single printable character, including accented letters
      if (Array.from(event.key).length === 1) {
        event.preventDefault()
        typeahead(event.key, index)
      }
  }
}

// Move focus into the list, onto its tab stop. Returns whether focus landed,
// which it can't while the sidebar is hidden (mobile, menu closed).
const focus = () => {
  const option = tabStopId.value === null ? undefined : optionElement(tabStopId.value)
  option?.focus()
  return !!option && document.activeElement === option
}

defineExpose({ focus })
</script>

<style scoped>
.channel-list-container {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0;
  scroll-behavior: smooth;
}

.channel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

/* Scrollbar styling */
.channel-list-container::-webkit-scrollbar {
  width: 6px;
}

.channel-list-container::-webkit-scrollbar-track {
  background: transparent;
}

.channel-list-container::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

.channel-list-container::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .channel-list-container::-webkit-scrollbar-thumb {
    background: #4b5563;
  }

  .channel-list-container::-webkit-scrollbar-thumb:hover {
    background: #6b7280;
  }
}
</style>
