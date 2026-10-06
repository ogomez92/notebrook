<template>
  <li
    :class="[
      'channel-item',
      { 'channel-item--active': isActive }
    ]"
    :data-channel-id="channel.id"
    role="option"
    :aria-selected="isActive ? 'true' : 'false'"
    :aria-label="channelAriaLabel"
    :tabindex="tabbable ? 0 : -1"
    @click="emit('select', channel.id)"
  >
    <span class="channel-name">{{ channel.name }}</span>
    <span
      v-if="channel.notify"
      class="channel-notify"
      aria-hidden="true"
      title="Push notifications on"
    >🔔</span>
    <span v-if="unreadCount" class="channel-unread" aria-hidden="true">
      {{ unreadCount }}
    </span>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Channel } from '@/types'

interface Props {
  channel: Channel
  isActive: boolean
  unreadCount?: number
  // The list's single roving tab stop
  tabbable: boolean
}

// The <li role="option"> is itself the focus target: a listbox option can't
// contain interactive children, so there's no inner button. Channel settings
// live in the chat header (and Alt+Enter on the option). Keyboard handling
// belongs to the parent listbox.
const emit = defineEmits<{
  select: [channelId: number]
}>()

const props = defineProps<Props>()

// Spoken name: the badges are aria-hidden, so their meaning goes in here
const channelAriaLabel = computed(() => {
  let label = props.channel.name
  if (props.channel.notify) {
    label += ', notifications on'
  }
  if (props.unreadCount) {
    label += `, ${props.unreadCount} unread message${props.unreadCount > 1 ? 's' : ''}`
  }
  return label
})
</script>

<style scoped>
.channel-item {
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  color: #6b7280;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
  border-radius: 6px;
  margin: 0 0.5rem 0.25rem 0.5rem;
}

.channel-item:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #374151;
}

.channel-item:focus {
  outline: none;
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.channel-item--active {
  background: #3b82f6;
  color: white;
}

.channel-item--active:hover {
  background: #2563eb;
}

/* The active option keeps its fill when focused, so give it a ring that
   still reads against the blue. */
.channel-item--active:focus {
  background: #3b82f6;
  color: white;
  box-shadow: 0 0 0 2px #1e3a8a;
}

.channel-name {
  flex: 1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-notify {
  font-size: 0.75rem;
  line-height: 1;
  opacity: 0.8;
  flex-shrink: 0;
  margin-right: 0.375rem;
}

.channel-unread {
  background: #ef4444;
  color: white;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.125rem 0.375rem;
  border-radius: 10px;
  min-width: 1.25rem;
  height: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.channel-item--active .channel-unread {
  background: rgba(255, 255, 255, 0.9);
  color: #3b82f6;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .channel-item {
    color: rgba(255, 255, 255, 0.6);
  }
  
  .channel-item:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.87);
  }
  
  .channel-item:focus {
    background: rgba(96, 165, 250, 0.1);
    color: #60a5fa;
    box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.2);
  }
  
  .channel-item--active {
    background: #3b82f6;
    color: white;
  }
  
  .channel-item--active:hover {
    background: #2563eb;
  }

  .channel-item--active:focus {
    background: #3b82f6;
    color: white;
    box-shadow: 0 0 0 2px #93c5fd;
  }
}
</style>