// Notification store for real-time user notifications using Zustand
import { create } from 'zustand'
import { apiClient } from '../services/ApiClient'
import type { UserMessage, UserNotificationEvent } from '../lib/api-types'

interface NotificationState {
  unreadCount: number
  messages: UserMessage[]
  isConnected: boolean
  isLoading: boolean
  error: string | null
}

interface NotificationActions {
  // Initialize SSE connection and fetch initial data
  initialize: () => void
  // Disconnect SSE
  disconnect: () => void
  // Fetch unread count (manual refresh)
  fetchUnreadCount: () => Promise<void>
  // Fetch messages (manual refresh)
  fetchMessages: (page?: number, limit?: number) => Promise<void>
  // Mark message as read
  markAsRead: (messageId: string) => Promise<void>
  // Delete message (calls API)
  deleteMessage: (messageId: string) => Promise<void>
  // Remove message from local state only (no API call)
  removeMessageFromState: (messageId: string) => void
  // Handle incoming SSE event
  handleEvent: (event: UserNotificationEvent) => void
  // Clear error
  clearError: () => void
}

// Store the cleanup function outside the store to prevent re-renders
let sseCleanup: (() => void) | null = null

export const useNotificationStore = create<NotificationState & NotificationActions>((set, get) => ({
  // Initial state
  unreadCount: 0,
  messages: [],
  isConnected: false,
  isLoading: false,
  error: null,

  // Actions
  initialize: () => {
    // Prevent multiple connections
    if (sseCleanup) {
      return
    }

    // Fetch initial data
    get().fetchUnreadCount()

    // Set up SSE connection
    sseCleanup = apiClient.subscribeToUserNotifications(
      // On event
      (event) => {
        get().handleEvent(event)
      },
      // On error
      (error) => {
        console.error('SSE connection error:', error)
        set({ isConnected: false, error: 'Connection lost. Reconnecting...' })
        // Attempt to reconnect after a delay
        setTimeout(() => {
          if (sseCleanup) {
            sseCleanup()
            sseCleanup = null
          }
          get().initialize()
        }, 5000)
      },
      // On open
      () => {
        set({ isConnected: true, error: null })
      }
    )
  },

  disconnect: () => {
    if (sseCleanup) {
      sseCleanup()
      sseCleanup = null
    }
    set({ isConnected: false })
  },

  fetchUnreadCount: async () => {
    try {
      const response = await apiClient.getUnreadMessageCount()
      set({ unreadCount: response.count })
    } catch (error) {
      console.error('Failed to fetch unread count:', error)
    }
  },

  fetchMessages: async (page = 1, limit = 20) => {
    set({ isLoading: true, error: null })
    try {
      const response = await apiClient.getMessages({ page, limit })
      set({ messages: response.messages, isLoading: false })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch messages',
        isLoading: false,
      })
    }
  },

  markAsRead: async (messageId: string) => {
    try {
      await apiClient.markMessageAsRead(messageId)
      // Update local state
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId ? { ...msg, read: true } : msg
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      }))
    } catch (error) {
      console.error('Failed to mark message as read:', error)
    }
  },

  deleteMessage: async (messageId: string) => {
    try {
      await apiClient.deleteMessage(messageId)
      // Update local state
      set((state) => {
        const deletedMsg = state.messages.find((msg) => msg.id === messageId)
        return {
          messages: state.messages.filter((msg) => msg.id !== messageId),
          unreadCount: deletedMsg && !deletedMsg.read
            ? Math.max(0, state.unreadCount - 1)
            : state.unreadCount,
        }
      })
    } catch (error) {
      console.error('Failed to delete message:', error)
    }
  },

  removeMessageFromState: (messageId: string) => {
    // Remove message from local state without calling API
    // Used when backend already deletes the message (e.g., after accepting/declining invitation)
    set((state) => {
      const deletedMsg = state.messages.find((msg) => msg.id === messageId)
      return {
        messages: state.messages.filter((msg) => msg.id !== messageId),
        unreadCount: deletedMsg && !deletedMsg.read
          ? Math.max(0, state.unreadCount - 1)
          : state.unreadCount,
      }
    })
  },

  handleEvent: (event: UserNotificationEvent) => {
    switch (event.type) {
      case 'message.created':
        // Add new message to the list and update unread count
        if (event.message) {
          set((state) => ({
            messages: [event.message!, ...state.messages],
            unreadCount: event.unreadCount ?? state.unreadCount + 1,
          }))
        }
        break

      case 'message.deleted':
        // This would need messageId in the event - for now just refresh
        get().fetchMessages()
        get().fetchUnreadCount()
        break

      case 'unread_count.changed':
        if (event.unreadCount !== undefined) {
          set({ unreadCount: event.unreadCount })
        }
        break
    }
  },

  clearError: () => set({ error: null }),
}))
