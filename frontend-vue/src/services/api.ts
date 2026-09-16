import type { Channel, Message, ExtendedMessage, FileAttachment, PushConfig, PushDevice, PushPlatform } from '@/types'

class ApiService {
  private baseUrl = import.meta.env.DEV ? 'http://localhost:3000' : ''
  private token = ''
  private deviceId: number | null = null

  setToken(token: string) {
    this.token = token
    console.log('API service token set:', token ? `${token.substring(0, 10)}...` : 'null')
  }

  setBaseUrl(url: string) {
    this.baseUrl = url
    console.log('API service base URL set:', url)
  }

  /**
   * Push device this browser registered as. Sent on every request so the
   * server doesn't push our own messages back to us.
   */
  setDeviceId(id: number | null) {
    this.deviceId = id
  }

  private getHeaders(): Record<string, string> {
    return {
      ...this.getFormHeaders(),
      'Content-Type': 'application/json'
    }
  }

  private getFormHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Authorization': this.token }
    if (this.deviceId !== null) {
      headers['X-Device-Id'] = String(this.deviceId)
    }
    return headers
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const headers = {
      ...this.getHeaders(),
      ...options.headers
    }
    
    console.log('Making API request to:', url, 'with headers:', headers)
    
    const response = await fetch(url, {
      ...options,
      headers
    })

    if (!response.ok) {
      console.error('API request failed:', response.status, response.statusText)
      // Surface the server's reason when it sent one ({ error: "..." }).
      let detail = `${response.status} ${response.statusText}`
      try {
        const body = await response.json()
        if (body && typeof body.error === 'string') detail = body.error
      } catch {
        // Not JSON; keep the status line.
      }
      throw new Error(`API request failed: ${detail}`)
    }

    return response.json()
  }

  // Authentication
  async checkToken(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/check-token`, {
        headers: { Authorization: this.token }
      })
      return response.ok
    } catch {
      return false
    }
  }

  // Channels
  async getChannels(): Promise<{ channels: Channel[] }> {
    return this.request('/channels')
  }

  async createChannel(name: string): Promise<Channel> {
    return this.request('/channels', {
      method: 'POST',
      body: JSON.stringify({ name })
    })
  }

  async updateChannel(channelId: number, name: string): Promise<{ message: string }> {
    return this.request(`/channels/${channelId}`, {
      method: 'PUT',
      body: JSON.stringify({ name })
    })
  }

  async deleteChannel(channelId: number): Promise<{ message: string }> {
    return this.request(`/channels/${channelId}`, {
      method: 'DELETE'
    })
  }

  async mergeChannels(sourceChannelId: number, targetChannelId: number): Promise<{ message: string }> {
    return this.request(`/channels/${sourceChannelId}/merge`, {
      method: 'PUT',
      body: JSON.stringify({ targetChannelId: targetChannelId.toString() })
    })
  }

  /** Mark or unmark a channel so new messages in it are pushed to devices. */
  async setChannelNotify(channelId: number, notify: boolean): Promise<{ id: number, notify: boolean }> {
    return this.request(`/channels/${channelId}/notify`, {
      method: 'PUT',
      body: JSON.stringify({ notify })
    })
  }

  // Push notifications (see backend/PUSH.md)
  async getPushConfig(): Promise<PushConfig> {
    return this.request('/push/config')
  }

  async registerPushDevice(input: {
    platform: PushPlatform
    token: string
    data?: Record<string, unknown> | null
    name?: string | null
  }): Promise<PushDevice> {
    return this.request('/push/devices', {
      method: 'POST',
      body: JSON.stringify(input)
    })
  }

  async deletePushDevice(deviceId: number): Promise<{ message: string }> {
    return this.request(`/push/devices/${deviceId}`, {
      method: 'DELETE'
    })
  }

  async testPushDevice(deviceId: number): Promise<{ message: string }> {
    return this.request(`/push/devices/${deviceId}/test`, {
      method: 'POST'
    })
  }

  // Messages
  async getMessages(channelId: number): Promise<{ messages: ExtendedMessage[] }> {
    return this.request(`/channels/${channelId}/messages`)
  }

  async createMessage(channelId: number, content: string): Promise<Message> {
    return this.request(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content })
    })
  }

  async updateMessage(channelId: number, messageId: number, content: string): Promise<{ id: string, content: string }> {
    return this.request(`/channels/${channelId}/messages/${messageId}`, {
      method: 'PUT',
      body: JSON.stringify({ content })
    })
  }

  async deleteMessage(channelId: number, messageId: number): Promise<{ message: string }> {
    return this.request(`/channels/${channelId}/messages/${messageId}`, {
      method: 'DELETE'
    })
  }

  async setMessageChecked(channelId: number, messageId: number, checked: boolean | null): Promise<{ id: number, checked: boolean | null }> {
    return this.request(`/channels/${channelId}/messages/${messageId}/checked`, {
      method: 'PUT',
      body: JSON.stringify({ checked })
    })
  }

  async moveMessage(channelId: number, messageId: number, targetChannelId: number): Promise<{ message: string, messageId: number, targetChannelId: number }> {
    return this.request(`/channels/${channelId}/messages/${messageId}/move`, {
      method: 'PUT',
      body: JSON.stringify({ targetChannelId })
    })
  }

  // Files
  async uploadFile(channelId: number, messageId: number, file: File): Promise<FileAttachment> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${this.baseUrl}/channels/${channelId}/messages/${messageId}/files`, {
      method: 'POST',
      headers: this.getFormHeaders(),
      body: formData
    })

    if (!response.ok) {
      throw new Error(`File upload failed: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  async getFiles(channelId: number, messageId: number): Promise<{ files: FileAttachment[] }> {
    return this.request(`/channels/${channelId}/messages/${messageId}/files`)
  }

  // Search
  async search(query: string, channelId?: number): Promise<{ results: Message[] }> {
    const params = new URLSearchParams({ query })
    if (channelId) {
      params.append('channelId', channelId.toString())
    }
    return this.request(`/search?${params.toString()}`)
  }

  // File URL helper
  getFileUrl(filePath: string): string {
    return `${this.baseUrl}/uploads/${filePath.replace(/^.*\/uploads\//, '')}`
  }

  // Trigger a browser download of an uploaded file attachment
  async downloadFile(file: Pick<FileAttachment, 'file_path' | 'original_name'>): Promise<void> {
    const url = this.getFileUrl(file.file_path)
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`)
      }
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = file.original_name
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100)
    } catch (error) {
      console.error('Failed to download file:', error)
      // Fallback to a direct link download
      const link = document.createElement('a')
      link.href = url
      link.download = file.original_name
      link.target = '_blank'
      link.click()
    }
  }

  // Backup - returns a download URL
  async downloadBackup(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/backup`, {
      headers: { Authorization: this.token }
    })

    if (!response.ok) {
      throw new Error(`Backup failed: ${response.status} ${response.statusText}`)
    }

    // Get filename from Content-Disposition header or use default
    const contentDisposition = response.headers.get('Content-Disposition')
    let filename = 'notebrook-backup.db'
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?(.+?)"?(?:;|$)/)
      if (match && match[1]) filename = match[1]
    }

    // Download the file
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }

  // Restore - upload a .db file
  async restoreBackup(file: File): Promise<{ success: boolean; message: string; stats: { channels: number; messages: number; files: number } }> {
    const formData = new FormData()
    formData.append('database', file)

    const response = await fetch(`${this.baseUrl}/backup`, {
      method: 'POST',
      headers: { Authorization: this.token },
      body: formData
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `Restore failed: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }
}

export const apiService = new ApiService()
