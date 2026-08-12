import { apiService } from './api'
import { useAppStore } from '@/stores/app'
import type { ExtendedMessage, UnsentMessage } from '@/types'

export class SyncService {
  private getAppStore() {
    return useAppStore()
  }

  /**
   * Map the backend's camelCase message rows onto the frontend shape and put
   * them in chronological order.
   */
  private normalizeServerMessages(serverMessages: any[]): ExtendedMessage[] {
    return serverMessages
      .map((msg: any): ExtendedMessage => ({
        id: msg.id,
        channel_id: msg.channelId || msg.channel_id,
        content: msg.content,
        created_at: msg.createdAt || msg.created_at,
        file_id: msg.fileId || msg.file_id,
        checked: typeof msg.checked === 'number' ? (msg.checked === 1) : (typeof msg.checked === 'boolean' ? msg.checked : null),
        // Map the flattened file fields from backend
        fileId: msg.fileId,
        filePath: msg.filePath,
        fileType: msg.fileType,
        fileSize: msg.fileSize,
        originalName: msg.originalName,
        fileCreatedAt: msg.fileCreatedAt
      }))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }

  /**
   * Sync messages for a channel: replace local data with server data
   *
   * Prunes any local messages that are no longer present on the server
   * instead of keeping them around. We still keep unsent messages in the
   * separate unsent queue handled elsewhere.
   */
  async syncChannelMessages(channelId: number): Promise<void> {
    try {
      console.log(`Syncing messages for channel ${channelId}`)
      
      const appStore = this.getAppStore()
      
      // Get server messages
      const serverResponse = await apiService.getMessages(channelId)
      const serverMessages = serverResponse.messages

      console.log(`Server has ${serverMessages.length} messages, replacing local set for channel ${channelId}`)

      // Transform and sort server messages only (pruning locals not on server)
      const normalizedServerMessages = this.normalizeServerMessages(serverMessages)

      console.log(`Pruned + normalized result: ${normalizedServerMessages.length} messages`)

      // Update local storage with server truth
      appStore.setMessages(channelId, normalizedServerMessages)
      await appStore.saveState()
      
    } catch (error) {
      console.warn(`Failed to sync messages for channel ${channelId}:`, error)
      throw error
    }
  }

  /**
   * Fill the local cache for several channels at once.
   *
   * Cross-channel search matches against cached messages, but a full sync only
   * ever pulls the channel you're looking at — so channels you haven't opened
   * on this device are invisible until they're fetched. Failures are tolerated
   * per channel (an offline search still works over whatever is cached), and
   * state is persisted once at the end instead of per channel.
   *
   * Returns the number of channels successfully fetched.
   */
  async syncChannels(channelIds: number[]): Promise<number> {
    if (channelIds.length === 0) return 0

    const appStore = this.getAppStore()

    const outcomes = await Promise.allSettled(
      channelIds.map(async (channelId) => {
        const response = await apiService.getMessages(channelId)
        appStore.setMessages(channelId, this.normalizeServerMessages(response.messages))
      })
    )

    const failures = outcomes.filter((outcome) => outcome.status === 'rejected')
    if (failures.length > 0) {
      console.warn(`Failed to fetch ${failures.length}/${channelIds.length} channels for search`)
    }

    await appStore.saveState()

    return outcomes.length - failures.length
  }

  /**
   * Attempt to send all unsent messages (text and file messages)
   */
  async retryUnsentMessages(): Promise<void> {
    const appStore = this.getAppStore()
    const unsentMessages = appStore.unsentMessages
    console.log(`Attempting to send ${unsentMessages.length} unsent messages`)
    
    for (const unsentMsg of [...unsentMessages]) {
      try {
        console.log(`Sending unsent ${unsentMsg.messageType || 'text'} message: ${unsentMsg.content}`)
        
        if (unsentMsg.messageType === 'voice' || unsentMsg.messageType === 'image') {
          // Handle file message retry
          if (!unsentMsg.fileData) {
            console.error(`File message ${unsentMsg.id} missing file data, removing`)
            appStore.removeUnsentMessage(unsentMsg.id)
            continue
          }
          
          // Create message and upload file
          const response = await apiService.createMessage(unsentMsg.channelId, unsentMsg.content)
          
          // Create file from stored blob data
          const file = new File([unsentMsg.fileData.blob], unsentMsg.fileData.fileName, {
            type: unsentMsg.fileData.fileType
          })
          
          // Upload file
          const uploadedFile = await apiService.uploadFile(unsentMsg.channelId, response.id, file)
          
          // Create complete message with file metadata
          const sentMessage: ExtendedMessage = {
            id: response.id,
            channel_id: unsentMsg.channelId,
            content: unsentMsg.content,
            created_at: response.created_at,
            file_id: uploadedFile.id,
            fileId: uploadedFile.id,
            filePath: uploadedFile.file_path,
            fileType: uploadedFile.file_type,
            fileSize: uploadedFile.file_size,
            originalName: uploadedFile.original_name,
            fileCreatedAt: uploadedFile.created_at
          }
          
          appStore.addMessage(sentMessage)
          console.log(`Successfully sent unsent ${unsentMsg.messageType} message, got ID: ${response.id}`)
          
        } else {
          // Handle text message retry (existing logic)
          const response = await apiService.createMessage(unsentMsg.channelId, unsentMsg.content)
          console.log(`Successfully sent unsent text message, got ID: ${response.id}`)
          
          // Create the sent message
          const sentMessage: ExtendedMessage = {
            id: response.id,
            channel_id: unsentMsg.channelId,
            content: unsentMsg.content,
            created_at: new Date().toISOString()
          }
          
          appStore.addMessage(sentMessage)
        }
        
        // Remove from unsent messages
        appStore.removeUnsentMessage(unsentMsg.id)
        
        // Save state immediately after successful send to ensure UI updates
        await appStore.saveState()
        
        console.log(`Moved unsent message ${unsentMsg.id} to sent messages`)
        console.log(`Unsent messages remaining: ${appStore.unsentMessages.length}`)
        
      } catch (error) {
        console.warn(`Failed to send unsent message ${unsentMsg.id}:`, error)
        
        // Increment retry count
        unsentMsg.retries = (unsentMsg.retries || 0) + 1
        
        // Remove if too many retries (optional)
        if (unsentMsg.retries >= 5) {
          console.log(`Giving up on unsent message ${unsentMsg.id} after ${unsentMsg.retries} retries`)
          appStore.removeUnsentMessage(unsentMsg.id)
        }
      }
    }
    
    // Save state after processing
    await appStore.saveState()
  }

  /**
   * Full sync: channels and messages
   */
  async fullSync(): Promise<void> {
    try {
      console.log('Starting full sync...')
      
      const appStore = this.getAppStore()
      
      // 1. Sync channels
      const channelsResponse = await apiService.getChannels()
      appStore.setChannels(channelsResponse.channels)
      
      // 2. Retry unsent messages first
      await this.retryUnsentMessages()
      
      // 3. Sync messages for current channel
      if (appStore.currentChannelId) {
        await this.syncChannelMessages(appStore.currentChannelId)
      }
      
      // 4. Save everything
      await appStore.saveState()
      
      console.log('Full sync completed')
      
    } catch (error) {
      console.error('Full sync failed:', error)
      throw error
    }
  }

  /**
   * Optimistic message sending with automatic sync
   */
  async sendMessage(channelId: number, content: string): Promise<void> {
    try {
      console.log(`Optimistically sending message: ${content}`)
      
      // Try to send immediately
      const response = await apiService.createMessage(channelId, content)
      
      // Success - add to local messages
      const message: ExtendedMessage = {
        id: response.id,
        channel_id: channelId,
        content: content,
        created_at: new Date().toISOString()
      }
      
      const appStore = this.getAppStore()
      appStore.addMessage(message)
      console.log(`Message sent successfully with ID: ${response.id}`)
      
    } catch (error) {
      console.warn('Failed to send message immediately, queuing for later:', error)
      
      // Failed - add to unsent messages
      const unsentMessage: UnsentMessage = {
        id: `unsent_${Date.now()}_${Math.random()}`,
        channelId: channelId,
        content: content,
        timestamp: Date.now(),
        retries: 0
      }
      
      const appStore = this.getAppStore()
      appStore.addUnsentMessage(unsentMessage)
      await appStore.saveState()
      
      throw error // Re-throw so caller knows it failed
    }
  }

  /**
   * Send a file message with optimistic updates and offline support
   */
  async sendFileMessage(channelId: number, content: string, file: File, messageType: 'voice' | 'image' = 'image'): Promise<void> {
    try {
      console.log(`Optimistically sending ${messageType} message: ${content}`)
      
      // Try to send immediately
      const message = await apiService.createMessage(channelId, content)
      
      // Upload file
      const uploadedFile = await apiService.uploadFile(channelId, message.id, file)
      
      // Success - create complete message with file metadata
      const completeMessage: ExtendedMessage = {
        id: message.id,
        channel_id: channelId,
        content: content,
        created_at: message.created_at,
        file_id: uploadedFile.id,
        fileId: uploadedFile.id,
        filePath: uploadedFile.file_path,
        fileType: uploadedFile.file_type,
        fileSize: uploadedFile.file_size,
        originalName: uploadedFile.original_name,
        fileCreatedAt: uploadedFile.created_at
      }
      
      const appStore = this.getAppStore()
      appStore.addMessage(completeMessage)
      console.log(`${messageType} message sent successfully with ID: ${message.id}`)
      
    } catch (error) {
      console.warn(`Failed to send ${messageType} message immediately, queuing for later:`, error)
      
      // Queue file message for retry when back online
      const unsentMessage: UnsentMessage = {
        id: `unsent_${messageType}_${Date.now()}_${Math.random()}`,
        channelId: channelId,
        content: content,
        timestamp: Date.now(),
        retries: 0,
        messageType: messageType,
        fileData: {
          blob: file,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size
        }
      }
      
      const appStore = this.getAppStore()
      appStore.addUnsentMessage(unsentMessage)
      await appStore.saveState()
      
      throw error // Re-throw so caller knows it failed
    }
  }
}

export const syncService = new SyncService()
