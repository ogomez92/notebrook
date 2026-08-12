<template>
  <div class="search-dialog">
    <form class="search-form" role="search" @submit.prevent="commitSearch">
      <BaseInput
        ref="searchInput"
        v-model="query"
        autofocus
        autocomplete="off"
        :placeholder="placeholder"
        aria-label="Search query"
        :aria-describedby="statusId"
        @keydown="handleInputKeydown"
      />

      <div class="search-filters">
        <label class="scope-label" for="search-scope">In</label>
        <select id="search-scope" v-model="selectedChannelId" class="channel-filter">
          <option :value="null">All channels</option>
          <option v-for="channel in appStore.channels" :key="channel.id" :value="channel.id">
            {{ channel.name }}
          </option>
        </select>

        <BaseButton type="submit" :disabled="!query.trim()">
          Search
        </BaseButton>
      </div>
    </form>

    <p :id="statusId" class="search-status" role="status" aria-live="polite">
      {{ statusText }}
    </p>

    <!-- Results are a real message list: same component, same keys, same actions. -->
    <div v-if="hasResults" class="search-results" @keydown="handleResultsKeydown">
      <MessagesContainer
        ref="resultsContainer"
        :messages="resultMessages"
        :unsent-messages="resultUnsentMessages"
        :highlights="highlights"
        :auto-focus="false"
        focus-edge="first"
        :show-channel-names="selectedChannelId === null"
        :aria-label="resultsAriaLabel"
        @message-selected="handleGoToMessage"
        @open-message-dialog="emit('open-message-dialog', $event)"
        @open-message-dialog-edit="emit('open-message-dialog-edit', $event)"
        @open-links="(links, message) => emit('open-links', links, message)"
      />
    </div>

    <div v-else class="search-empty">
      <p v-if="isHydrating">Loading messages from your other channels…</p>
      <p v-else-if="!debouncedQuery.trim()">
        Type to search. Matching forgives typos and partial words —
        <em>releaes</em> and <em>releas</em> both find <em>release</em>.
      </p>
      <p v-else>No messages match “{{ debouncedQuery.trim() }}”.</p>
    </div>

    <details class="search-help">
      <summary>Keyboard shortcuts</summary>
      <dl>
        <div><dt>Enter</dt><dd>in the box, move to the results; on a result, jump to it in its channel</dd></div>
        <div><dt>↑ ↓ Home End</dt><dd>move between results</dd></div>
        <div><dt>Shift + Enter</dt><dd>open the result's link, or download its file</dd></div>
        <div><dt>E</dt><dd>edit the result</dd></div>
        <div><dt>C</dt><dd>copy it &nbsp;·&nbsp; <kbd>R</kbd> read it aloud &nbsp;·&nbsp; <kbd>Space</kbd> check it</dd></div>
        <div><dt>Delete</dt><dd>delete it (Ctrl+Z undoes)</dd></div>
        <div><dt>Escape</dt><dd>from the results, back to the box; from the box, close</dd></div>
      </dl>
    </details>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import { syncService } from '@/services/sync'
import { fuzzyFilter } from '@/utils/fuzzy'
import BaseInput from '@/components/base/BaseInput.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import MessagesContainer from '@/components/chat/MessagesContainer.vue'
import type { ExtendedMessage, UnsentMessage } from '@/types'

interface Props {
  /** 'channel' scopes to `channelId`; 'global' searches everything. */
  scope?: 'channel' | 'global'
  channelId?: number | null
}

const props = withDefaults(defineProps<Props>(), {
  scope: 'global',
  channelId: null
})

const emit = defineEmits<{
  close: []
  'select-message': [message: ExtendedMessage]
  'open-message-dialog': [message: ExtendedMessage | UnsentMessage]
  'open-message-dialog-edit': [message: ExtendedMessage | UnsentMessage]
  'open-links': [links: string[], message: ExtendedMessage | UnsentMessage]
}>()

const appStore = useAppStore()
const toastStore = useToastStore()

/** Rendering every hit would make a broad query janky; the ranking means the tail is noise anyway. */
const MAX_RESULTS = 200
const DEBOUNCE_MS = 120

/**
 * Channels already pulled into the cache for search, so re-opening the dialog
 * doesn't re-request them. Module scope: the dialog is unmounted when closed.
 * Live edits keep arriving over the WebSocket, so the cache stays warm.
 */
const hydratedChannels = new Set<number>()

const query = ref('')
const debouncedQuery = ref('')
const selectedChannelId = ref<number | null>(props.scope === 'channel' ? props.channelId : null)
const isHydrating = ref(false)
const searchInput = ref<InstanceType<typeof BaseInput>>()
const resultsContainer = ref<InstanceType<typeof MessagesContainer>>()
const statusId = `search-status-${Math.random().toString(36).slice(2, 9)}`

let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch(query, (value) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { debouncedQuery.value = value }, DEBOUNCE_MS)
})

// Re-opening with a different shortcut (Ctrl+F vs Ctrl+Shift+F) retargets a dialog
// that is already on screen.
watch(
  () => [props.scope, props.channelId] as const,
  ([scope, channelId]) => {
    selectedChannelId.value = scope === 'channel' ? channelId ?? null : null
  }
)

const placeholder = computed(() =>
  selectedChannelId.value === null
    ? 'Search all channels…'
    : `Search ${channelName(selectedChannelId.value)}…`
)

const channelName = (channelId: number): string =>
  appStore.channels.find((c) => c.id === channelId)?.name || `Channel ${channelId}`

/**
 * Newest first, so that when scores tie the recent message wins — `fuzzyFilter`
 * sorts stably, which preserves this order within a score band.
 */
const searchPool = computed<ExtendedMessage[]>(() => {
  const scoped = selectedChannelId.value
  const pool = scoped === null
    ? Object.values(appStore.messages).flat()
    : appStore.messages[scoped] ?? []

  return [...pool].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
})

/** Messages typed while offline live outside `messages`, but they're on screen, so they're searchable. */
const unsentPool = computed<UnsentMessage[]>(() => {
  const scoped = selectedChannelId.value
  return scoped === null
    ? appStore.unsentMessages
    : appStore.unsentMessages.filter((message) => message.channelId === scoped)
})

const matches = computed(() => fuzzyFilter(debouncedQuery.value, searchPool.value, (m) => m.content))
const unsentMatches = computed(() =>
  fuzzyFilter(debouncedQuery.value, unsentPool.value, (m) => m.content)
)

const totalMatches = computed(() => matches.value.length + unsentMatches.value.length)

const resultMessages = computed(() => matches.value.slice(0, MAX_RESULTS).map((r) => r.item))
const resultUnsentMessages = computed(() =>
  unsentMatches.value.slice(0, Math.max(0, MAX_RESULTS - matches.value.length)).map((r) => r.item)
)
const shownMatches = computed(() => resultMessages.value.length + resultUnsentMessages.value.length)

const highlights = computed(() => {
  const map: Record<string | number, number[]> = {}
  for (const result of matches.value.slice(0, MAX_RESULTS)) map[result.item.id] = result.indices
  for (const result of unsentMatches.value) map[result.item.id] = result.indices
  return map
})

const hasResults = computed(() => shownMatches.value > 0)

const resultsAriaLabel = computed(
  () => `Search results, ${shownMatches.value} ${shownMatches.value === 1 ? 'message' : 'messages'}`
)

const statusText = computed(() => {
  if (isHydrating.value) return 'Loading messages from your other channels…'

  const trimmed = debouncedQuery.value.trim()
  const where = selectedChannelId.value === null
    ? 'all channels'
    : channelName(selectedChannelId.value)

  if (!trimmed) return `Searching ${where}. Press Enter to move to the results.`
  if (totalMatches.value === 0) return `No matches in ${where}.`

  const counted = shownMatches.value < totalMatches.value
    ? `Showing the top ${shownMatches.value} of ${totalMatches.value} matches`
    : `${totalMatches.value} ${totalMatches.value === 1 ? 'match' : 'matches'}`

  return `${counted}. Press Enter to move to the results.`
})

const focusInput = () => {
  searchInput.value?.focus()
  searchInput.value?.inputRef?.select()
}

/** Move focus to the results; stay put (and say so) when there's nothing to move to. */
const commitSearch = async () => {
  // Skip the debounce so Enter immediately after typing searches what's on screen.
  clearTimeout(debounceTimer)
  debouncedQuery.value = query.value
  await nextTick()

  if (!query.value.trim()) return

  if (!resultsContainer.value?.focusList()) {
    toastStore.info(`No messages match “${query.value.trim()}”`)
  }
}

const handleInputKeydown = (event: KeyboardEvent) => {
  // ArrowDown is the other conventional way into a result list.
  if (event.key === 'Enter' || event.key === 'ArrowDown') {
    event.preventDefault()
    commitSearch()
  }
}

const handleResultsKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return

  // Escape steps back to the box rather than closing outright. Stop it here so
  // BaseDialog's document-level handler doesn't also close the dialog.
  event.preventDefault()
  event.stopPropagation()
  focusInput()
}

const handleGoToMessage = (message: ExtendedMessage | UnsentMessage) => {
  // Unsent messages have no server id to navigate to; they're only in the composer queue.
  if (!('created_at' in message)) {
    toastStore.info('That message hasn\'t finished sending yet')
    return
  }

  emit('select-message', message)
  emit('close')
}

/**
 * Cross-channel search can only match what's cached, and a channel you've never
 * opened on this device has nothing cached. Fetch those in the background; the
 * results are computed from the store, so they fill in as the fetches land.
 */
const hydrateChannels = async () => {
  const missing = appStore.channels
    .filter(
      (channel) =>
        !hydratedChannels.has(channel.id) &&
        (appStore.messages[channel.id]?.length ?? 0) === 0
    )
    .map((channel) => channel.id)

  if (missing.length === 0) return

  isHydrating.value = true
  try {
    await syncService.syncChannels(missing)
    // Marked even on partial failure: an empty channel stays empty, and a
    // channel that failed will be retried by the next full sync anyway.
    for (const channelId of missing) hydratedChannels.add(channelId)
  } catch (error) {
    console.warn('Could not load every channel for search:', error)
  } finally {
    isHydrating.value = false
  }
}

watch(
  () => selectedChannelId.value,
  (scoped) => { if (scoped === null) hydrateChannels() }
)

onMounted(() => {
  focusInput()
  if (selectedChannelId.value === null) hydrateChannels()
})

onUnmounted(() => {
  clearTimeout(debounceTimer)
})

defineExpose({ focusInput })
</script>

<style scoped>
.search-dialog {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 24rem;
  max-height: 70vh;
}

.search-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.search-filters {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.scope-label {
  font-size: 0.875rem;
  color: #6b7280;
}

.channel-filter {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  color: #111827;
  font-size: 0.875rem;
  min-width: 8rem;
}

.channel-filter:focus {
  outline: none;
  border-color: #646cff;
  box-shadow: 0 0 0 3px rgba(100, 108, 255, 0.1);
}

.search-status {
  margin: 0;
  font-size: 0.875rem;
  color: #4b5563;
}

/* Lets the message list inside scroll rather than stretching the dialog. */
.search-results {
  flex: 1;
  min-height: 12rem;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.search-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  text-align: center;
  color: #6b7280;
  border: 1px dashed #e5e7eb;
  border-radius: 8px;
}

.search-empty p {
  margin: 0;
}

.search-help {
  font-size: 0.8125rem;
  color: #6b7280;
}

.search-help summary {
  cursor: pointer;
  padding: 0.25rem 0;
}

.search-help summary:focus-visible {
  outline: 2px solid #646cff;
  outline-offset: 2px;
  border-radius: 4px;
}

.search-help dl {
  margin: 0.5rem 0 0;
  display: grid;
  gap: 0.25rem;
}

.search-help dl > div {
  display: flex;
  gap: 0.5rem;
}

.search-help dt,
.search-help kbd {
  flex-shrink: 0;
  font-family: inherit;
  font-weight: 600;
  color: #374151;
}

.search-help dt {
  min-width: 7rem;
}

.search-help dd {
  margin: 0;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .channel-filter {
    background: #374151;
    color: rgba(255, 255, 255, 0.87);
    border-color: #4b5563;
  }

  .scope-label,
  .search-status {
    color: #9ca3af;
  }

  .search-results {
    border-color: #374151;
  }

  .search-empty {
    border-color: #374151;
    color: #9ca3af;
  }

  .search-help dt,
  .search-help kbd {
    color: #d1d5db;
  }
}
</style>
