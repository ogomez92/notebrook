import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ExtendedMessage } from '@/types'

export interface DeletedMessage {
  channelId: number
  message: ExtendedMessage // snapshot taken at the moment of deletion
  deletedAt: number
}

// Cap the stack so a long-running session can't grow it without bound.
const MAX_UNDO = 25

export const useUndoStore = defineStore('undo', () => {
  // In-memory only — intentionally NOT persisted to IndexedDB. The undo
  // history lives for the lifetime of the page/session and is dropped on reload.
  const deletedMessages = ref<DeletedMessage[]>([])

  const canUndo = computed(() => deletedMessages.value.length > 0)
  const undoDepth = computed(() => deletedMessages.value.length)

  // Push the most recently deleted message onto the stack.
  const recordDeletedMessage = (message: ExtendedMessage, channelId: number) => {
    deletedMessages.value.push({
      channelId,
      message: { ...message },
      deletedAt: Date.now()
    })

    if (deletedMessages.value.length > MAX_UNDO) {
      deletedMessages.value.shift()
    }
  }

  // Pop the most recent deletion for re-adding (repeated calls walk the stack).
  const popDeletedMessage = (): DeletedMessage | null => {
    return deletedMessages.value.pop() ?? null
  }

  const clear = () => {
    deletedMessages.value = []
  }

  return {
    deletedMessages,
    canUndo,
    undoDepth,
    recordDeletedMessage,
    popDeletedMessage,
    clear
  }
})
