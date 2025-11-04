import type {
  Envelope,
  Transport,
  TranscriptChunk,
  ProcessingMessage,
  ProcessingMessageType,
  DecisionStreamData,
  PromptExecutionData,
  ExpertStatusData,
  SafetyCheckData,
  CompleteTodoListMessage,
  PlanProgressUpdate,
  PlanDeliverableUpdate,
  StateChangeNotification,
} from '../lib/types'
import { Room, RoomEvent, Track, RemoteTrack, RemoteAudioTrack, RemoteParticipant, DataPacket_Kind, RoomConnectOptions, ConnectionState } from 'livekit-client'
import { getRuntimeConfig } from '../config/runtime'
import { generateUUID } from '../lib/uuid'

export class PeerTransport implements Transport {
  room?: Room
  remoteAudio?: HTMLAudioElement
  micStream?: MediaStream
  publishedAudioTrack?: any
  pausedAudioTime?: number
  isStreamingPaused: boolean = false
  private userName: string = 'User'  // Default fallback name

  // Set the user's actual name for proper message attribution
  setUserName(name: string) {
    this.userName = name
  }

  onConnected = () => {}
  onDisconnected = (_reason?: string) => {}
  onError = (_err: Error) => {}
  onRemoteAudioTrack = (_track: MediaStreamTrack) => {}
  onTranscript = (_chunk: TranscriptChunk) => {}
  onProcessingMessage = (_message: ProcessingMessage) => {}
  onServerMessage = (_msg: unknown) => {}
  onTTSStart = () => {}
  onTTSStop = () => {}
  onTodoListUpdate = (_data: CompleteTodoListMessage) => {}
  onPlanProgress = (_data: PlanProgressUpdate) => {}
  onDeliverableUpdate = (_data: PlanDeliverableUpdate) => {}
  onStateChange = (_data: StateChangeNotification) => {}
  onParticipantJoined = (_participantId: string, _participantName?: string) => {}
  onParticipantLeft = (_participantId: string, _participantName?: string) => {}
  onLLMConfig = (_config: any) => {}

  async connect(roomName?: string) {
    try {
      // Create LiveKit room
      const room = new Room()
      this.room = room

      // Set up event listeners
      room.on(RoomEvent.Connected, () => {
        this.onConnected()
      })

      room.on(RoomEvent.Disconnected, (reason) => {
        this.onDisconnected(reason?.toString())
      })

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          const audioTrack = track as RemoteAudioTrack
          const audioEl = audioTrack.attach()
          audioEl.autoplay = true
          this.remoteAudio = audioEl
          this.setupAudioEventListeners(audioEl)
          this.onRemoteAudioTrack(audioTrack.mediaStreamTrack)
        }
      })

      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const decoder = new TextDecoder()
          const message = decoder.decode(payload)

          const env: Envelope<any> = JSON.parse(message)

          // console.log('🔍 [DEBUG] Parsed message envelope:', {
          //   type: env.type,
          //   data: env.data
          // })

          if (env.type === 'transcript' || env.type === 'transcript_chunk') {
            // Transform server transcript chunk format to frontend format
            const serverData = env.data

            // WORKAROUND: Server timestamps are unreliable (2 hours behind)
            // Use client time for consistent timestamps with participant events
            // TODO: Fix server to send proper UTC timestamps with 'Z' suffix
            const startedAtMs = Date.now()

            // Keep diagnostic logging to monitor server timestamp issues
            if (serverData.timestamp) {
              try {
                const serverParsedMs = new Date(serverData.timestamp).getTime()
                const timeDiffMs = startedAtMs - serverParsedMs
                const timeDiffHours = timeDiffMs / (1000 * 60 * 60)

                // Log if server timestamp differs significantly from client time
                if (Math.abs(timeDiffHours) > 0.5) {
                  console.warn(`⏰ [TIMESTAMP] Server timestamp is ${timeDiffHours.toFixed(2)} hours behind client time - using client time`)
                  console.log(`   Server sent: ${serverData.timestamp} → ${new Date(serverParsedMs).toISOString()}`)
                  console.log(`   Using client: ${new Date(startedAtMs).toISOString()}`)
                }
              } catch (e) {
                // Ignore parse errors - we're using client time anyway
              }
            }

            // Determine role based on participant_id:
            // - If it matches current user's name → 'user' (messages from the logged-in user)
            // - Otherwise → 'assistant' (messages from agents or other participants)
            const isUserMessage = serverData.participant_id === this.userName

            const transcriptChunk: TranscriptChunk = {
              id: serverData.transcript_id || generateUUID(),
              role: isUserMessage ? 'user' : 'assistant',
              text: serverData.text,
              status: serverData.is_final ? 'final' : 'partial',
              startedAt: startedAtMs,
              finalizedAt: serverData.is_final ? startedAtMs : undefined,
              participant_id: serverData.participant_id
            }

            this.onTranscript(transcriptChunk)
          } else if (this.isProcessingMessage(env.type)) {
            // Handle new processing messages
            const processingMessage = this.transformProcessingMessage(env)
            this.onProcessingMessage(processingMessage)
          } else if (env.type === 'tts_start') {
            // Handle TTS start event from backend
            this.onTTSStart()
          } else if (env.type === 'tts_stop' || env.type === 'tts_end') {
            // Handle TTS stop/end event from backend
            this.onTTSStop()
          } else if (env.type === 'tts_paused') {
            // Handle TTS pause confirmation from backend
            this.isStreamingPaused = true
          } else if (env.type === 'tts_resumed') {
            // Handle TTS resume confirmation from backend
            this.isStreamingPaused = false
          } else if (env.type === 'complete_todo_list') {
            // Handle complete todo list update with state machine architecture
            const todoData = env.data as CompleteTodoListMessage
            console.log(`🔄 [STATE MACHINE] Todo list update - Trigger: ${todoData.update_trigger}`)
            this.onTodoListUpdate(todoData)
          } else if (env.type === 'plan_progress_update') {
            // Handle plan progress update with state tracking
            const progressData = env.data as PlanProgressUpdate
            console.log(`📈 [PROGRESS] ${progressData.progress.percentage.toFixed(1)}% - State: ${progressData.current_state?.title || 'unknown'}`)
            this.onPlanProgress(progressData)
          } else if (env.type === 'plan_deliverable_update') {
            // Handle enhanced deliverable update with reasoning
            const deliverableData = env.data as PlanDeliverableUpdate
            console.log(`✅ [DELIVERABLE] ${deliverableData.deliverable_key} = ${deliverableData.deliverable_value} (${Math.round(deliverableData.confidence * 100)}% confidence)`)
            this.onDeliverableUpdate(deliverableData)
          } else if (env.type === 'state_change_notification') {
            // Handle state change in state machine
            const stateChangeData = env.data as StateChangeNotification
            console.log(`🔀 [STATE CHANGE] ${stateChangeData.previous_state} → ${stateChangeData.current_state}: ${stateChangeData.state_title || 'unknown'}`)
            this.onStateChange(stateChangeData)
          } else if (env.type === 'task_progress_update') {
            // Handle task progress update (backward compatibility)
            console.log(`📝 [TASK UPDATE] Legacy task progress update received`)
            this.onServerMessage(env)
          } else if (env.type === 'llm_config') {
            // Handle LLM configuration from backend
            const llmConfig = env.data
            console.log(`🤖 [LLM CONFIG] Provider: ${llmConfig.provider}, Model: ${llmConfig.model}`)
            this.onLLMConfig(llmConfig)
          } else {
            // console.log('🔍 [DEBUG] Other message type:', env.type)
            this.onServerMessage(env)
          }
        } catch (error) {
          console.error('❌ [ERROR] Error parsing data message:', error)
        }
      })

      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (state === ConnectionState.Disconnected) {
          this.onError(new Error('LiveKit connection failed'))
        }
      })

      // Listen for participant join/leave events
      room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        this.onParticipantJoined(participant.identity, participant.name)
      })

      room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        this.onParticipantLeft(participant.identity, participant.name)
      })

      // Generate a simple access token (in production, this should come from your server)
      const token = await this.generateAccessToken(roomName)

      // Connect to room
      const connectOptions: RoomConnectOptions = {
        autoSubscribe: true
      }

      const config = getRuntimeConfig()
      await room.connect(config.livekitUrl, token, connectOptions)

      console.log(`👤 [USER] Connected as: ${room.localParticipant.identity}`)

      // Publish microphone if available
      if (this.micStream) {
        const audioTrack = this.micStream.getAudioTracks()[0]
        if (audioTrack) {
          this.publishedAudioTrack = await room.localParticipant.publishTrack(audioTrack)
        }
      }

    } catch (error) {
      console.error('Failed to connect to LiveKit:', error)
      this.onError(error as Error)
    }
  }

  async disconnect() {
    if (this.room) {
      await this.room.disconnect()
      this.room = undefined
    }
    this.remoteAudio?.pause()
    this.remoteAudio = undefined
    this.publishedAudioTrack = undefined
    this.onDisconnected('client disconnect')
  }

  sendUserText(text: string) {
    if (!this.room) {
      console.error('[PeerTransport] Cannot send message: Room not initialized')
      return
    }

    // More detailed state checking
    const roomState = this.room.state
    if (roomState !== 'connected') {
      console.error(`[PeerTransport] Cannot send message: Room not connected (current state: ${roomState})`)
      console.log('[PeerTransport] Waiting for connection... Please try again once connected.')
      return
    }

    // Additional check for local participant
    if (!this.room.localParticipant) {
      console.error('[PeerTransport] Cannot send message: Local participant not available')
      return
    }

    const env: Envelope<string> = {
      type: 'user_text',
      data: text,
      participant_id: this.userName  // Use actual user name for proper attribution
    }
    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(env))
    try {
      this.room.localParticipant.publishData(data, { reliable: true })
      console.log(`[PeerTransport] ✓ Message sent: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`)
    } catch (error) {
      console.error('[PeerTransport] Error sending data:', error)
    }
  }


  sendControl(kind: string, payload?: unknown) {
    if (!this.room || this.room.state !== 'connected' || !this.room.localParticipant) {
      console.warn(`[PeerTransport] Cannot send control message '${kind}': Room not ready`)
      return
    }

    const env: Envelope<any> = { type: kind as any, data: payload }
    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(env))
    try {
      this.room.localParticipant.publishData(data, { reliable: true })
      console.log(`[PeerTransport] ✓ Control message sent: ${kind}`)
    } catch (error) {
      console.error(`[PeerTransport] Error sending control message '${kind}':`, error)
    }
  }

  // Send PCM16 audio frame data for real-time transcription
  sendAudioFrame(pcmData: ArrayBuffer, format: string = 'pcm16') {
    if (!this.room || this.room.state !== 'connected') {
      console.warn('Cannot send audio frame - room not connected')
      return
    }

    const audioArray = Array.from(new Uint8Array(pcmData))
    const env: Envelope<any> = {
      type: 'audio_stream_chunk',
      participant_id: this.userName,
      data: {
        audio: audioArray,
        format: format,
        chunkIndex: Date.now(),
        timestamp: Date.now(),
        isLastChunk: false
      }
    }
    
    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(env))
    
    try {
      this.room.localParticipant.publishData(data, { reliable: true })
    } catch (error) {
      console.error('Error sending audio frame:', error)
    }
  }

  // Start audio streaming session
  startAudioStream(sessionId?: string, format: string = 'pcm16', sampleRate: number = 16000) {
    if (!this.room || this.room.state !== 'connected') {
      console.warn('Cannot start audio stream - room not connected')
      return
    }

    const env: Envelope<any> = {
      type: 'audio_stream_start',
      participant_id: this.userName,
      data: {
        sessionId: sessionId || `session_${Date.now()}`,
        format: format,
        sampleRate: sampleRate,
        timestamp: Date.now()
      }
    }
    
    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(env))
    
    try {
      this.room.localParticipant.publishData(data, { reliable: true })
    } catch (error) {
      console.error('Error starting audio stream:', error)
    }
  }

  // Stop audio streaming session
  stopAudioStream() {
    if (!this.room || this.room.state !== 'connected') {
      console.warn('Cannot stop audio stream - room not connected')
      return
    }

    const env: Envelope<any> = {
      type: 'audio_stream_stop',
      participant_id: this.userName,
      data: {
        timestamp: Date.now()
      }
    }

    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(env))

    try {
      this.room.localParticipant.publishData(data, { reliable: true })
    } catch (error) {
      console.error('Error stopping audio stream:', error)
    }
  }

  // Send mute signal to trigger VAD endpoint
  sendMuteSignal() {
    if (!this.room || this.room.state !== 'connected') {
      console.warn('Cannot send mute signal - room not connected')
      return
    }

    const env: Envelope<any> = {
      //@ts-ignore
      type: 'audio_stream_mute',
      data: {
        timestamp: Date.now(),
        reason: 'user_muted'
      }
    }

    const encoder = new TextEncoder()
    const data = encoder.encode(JSON.stringify(env))

    try {
      this.room.localParticipant.publishData(data, { reliable: true })
    } catch (error) {
      console.error('Error sending mute signal:', error)
    }
  }

  async attachMicStream(stream: MediaStream) {
    this.micStream = stream
    if (this.room && this.room.state === 'connected') {
      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) {
        this.publishedAudioTrack = await this.room.localParticipant.publishTrack(audioTrack)
      }
    }
  }

  // Publish microphone audio track to LiveKit
  async publishAudioTrack(stream: MediaStream) {
    if (!this.room || this.room.state !== 'connected') {
      console.warn('Cannot publish audio track - room not connected')
      return false
    }

    try {
      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) {
        console.log('🔊 [AUDIO] Publishing audio track')
        this.publishedAudioTrack = await this.room.localParticipant.publishTrack(audioTrack)
        this.micStream = stream
        return true
      }
    } catch (error) {
      console.error('Error publishing audio track:', error)
      return false
    }
    return false
  }

  // Unpublish and stop microphone audio track
  async unpublishAudioTrack() {
    if (!this.room) {
      return
    }

    try {
      if (this.publishedAudioTrack) {
        console.log('🔇 [AUDIO] Unpublishing audio track')

        // Send mute signal to trigger VAD endpoint
        this.sendMuteSignal()

        // Unpublish the track from LiveKit
        await this.room.localParticipant.unpublishTrack(this.publishedAudioTrack.track!)

        // Stop the media track
        if (this.micStream) {
          this.micStream.getTracks().forEach(track => track.stop())
          this.micStream = undefined
        }

        this.publishedAudioTrack = undefined
      }
    } catch (error) {
      console.error('Error unpublishing audio track:', error)
    }
  }

  // Mute the microphone by disabling the audio track (deprecated - use unpublishAudioTrack instead)
  async muteAudio() {
    if (this.publishedAudioTrack) {
      console.log('🔇 [AUDIO] Muting audio track')
      await this.publishedAudioTrack.mute()
      this.sendMuteSignal()
    }
  }

  // Unmute the microphone by enabling the audio track (deprecated - use publishAudioTrack instead)
  async unmuteAudio() {
    if (this.publishedAudioTrack) {
      console.log('🔊 [AUDIO] Unmuting audio track')
      await this.publishedAudioTrack.unmute()
    }
  }

  // Check if audio is currently muted
  isAudioMuted(): boolean {
    return this.publishedAudioTrack ? this.publishedAudioTrack.isMuted : true
  }

  // Generate a development token for LiveKit dev mode
  private async generateAccessToken(roomName?: string): Promise<string> {
    // For MVP, let's try the simplest possible approach
    // Use the LiveKit dev server's built-in token generation

    // Use fixed "human" identity for the frontend user
    const identity = 'human'
    const actualRoomName = roomName || 'voice-ai-room'
    const config = getRuntimeConfig()

    console.log(`🔗 Chat connecting to LiveKit room: "${actualRoomName}" at ${config.livekitUrl}`)

    // Try using a minimal token that dev mode might accept
    try {
      // Option 1: Try to get a dev token from the server
      // Convert WebSocket URL to HTTP URL for the token endpoint
      const tokenUrl = config.livekitUrl
        .replace(/^ws:\/\//, 'http://')
        .replace(/^wss:\/\//, 'https://')

      console.log(`🔑 [TOKEN] Fetching dev token from: ${tokenUrl}/devtoken`)
      const response = await fetch(`${tokenUrl}/devtoken?identity=${identity}&room=${actualRoomName}`)
      if (response.ok) {
        const token = await response.text()
        console.log('✓ [TOKEN] Successfully obtained dev token')
        return token
      } else {
        console.warn(`[TOKEN] Dev token endpoint returned ${response.status}`)
      }
    } catch (e) {
      console.log('Dev token endpoint not available, using manual token generation')
    }

    // Option 2: Create a properly signed JWT with HMAC-SHA256
    const header = { alg: "HS256", typ: "JWT" }
    const now = Math.floor(Date.now() / 1000)
    const payload = {
      iss: config.livekitApiKey,
      sub: identity,
      iat: now,
      exp: now + 3600,
      nbf: now,
      jti: identity,
      // Standard LiveKit token format
      video: {
        room: actualRoomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canSubscribeData: true,
        canUpdateOwnMetadata: true
      },
      // Additional fields for compatibility
      room: actualRoomName,
      identity: identity,
      name: this.userName  // Use actual user name for proper attribution
    }
    
    const headerB64 = this.base64UrlEncode(JSON.stringify(header))
    const payloadB64 = this.base64UrlEncode(JSON.stringify(payload))

    // Simple HMAC-SHA256 implementation for dev mode
    const signature = await this.hmacSha256(`${headerB64}.${payloadB64}`, config.livekitApiSecret)
    
    return `${headerB64}.${payloadB64}.${signature}`
  }
  
  private base64UrlEncode(str: string): string {
    return window.btoa(str)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
  }
  
  private async hmacSha256(data: string, secret: string): Promise<string> {
    // Check if crypto.subtle is available (requires secure context)
    if (!crypto.subtle) {
      const currentUrl = window.location.href
      const isSecureContext = window.isSecureContext

      console.error('❌ [CRYPTO] crypto.subtle is not available')
      console.error('   This requires a secure context (HTTPS or localhost)')
      console.error(`   Current URL: ${currentUrl}`)
      console.error(`   Is secure context: ${isSecureContext}`)
      console.error('')
      console.error('💡 Solutions:')
      console.error('   1. Access via localhost: http://localhost:5173')
      console.error('   2. Use HTTPS with SSL certificates')
      console.error('   3. Ask your backend team to add a token generation endpoint')

      throw new Error(
        'crypto.subtle unavailable - requires secure context (HTTPS or localhost). ' +
        `Current URL: ${currentUrl}. Try accessing via localhost instead.`
      )
    }

    // Simple HMAC-SHA256 for dev purposes
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    return this.base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)))
  }

  private isProcessingMessage(type: string): boolean {
    return ['decision_stream', 'prompt_execution', 'expert_status', 'safety_check'].includes(type)
  }

  private transformProcessingMessage(env: Envelope<any>): ProcessingMessage {
    const serverData = env.data
    const messageType = this.mapToProcessingMessageType(env.type)

    // Use client timestamp for consistency (server timestamps are unreliable)
    const timestamp = Date.now()

    return {
      id: generateUUID(),
      type: messageType,
      role: 'system',
      status: 'final',
      startedAt: timestamp,
      finalizedAt: timestamp,
      streamId: serverData.stream_id,
      data: serverData
    }
  }

  private mapToProcessingMessageType(serverType: string): ProcessingMessageType {
    switch (serverType) {
      case 'decision_stream':
        return 'decision'
      case 'prompt_execution':
        return 'prompt_execution'
      case 'expert_status':
        return 'expert_status'
      case 'safety_check':
        return 'safety_check'
      default:
        return 'decision'
    }
  }

  pauseTTSPlayback() {
    if (this.remoteAudio && !this.isStreamingPaused) {
      this.isStreamingPaused = true
      console.log('⏸️ [TTS] Sending pause/barge-in signal to backend')

      // Send multiple signals to ensure backend responds
      // 1. Explicit pause signal
      this.sendControl('tts_pause', {
        action: 'pause_stream',
        timestamp: Date.now(),
        message: 'User requested TTS pause'
      })

      // 2. Barge-in signal (might be what backend expects)
      this.sendControl('barge_in', {
        action: 'pause',
        reason: 'user_pause_request',
        timestamp: Date.now()
      })
    }
  }

  resumeTTSPlayback() {
    if (this.remoteAudio && this.isStreamingPaused) {
      this.isStreamingPaused = false
      console.log('▶️ [TTS] Sending resume signal to backend')

      // Send clear resume signal to backend to continue TTS streaming
      this.sendControl('tts_resume', {
        action: 'resume_stream',
        timestamp: Date.now(),
        message: 'User requested TTS resume'
      })
    }
  }

  private setupAudioEventListeners(audioEl: HTMLAudioElement) {
    // Detect when audio starts playing (TTS begins)
    audioEl.addEventListener('play', () => {
      if (!this.isStreamingPaused) {
        console.log('🔊 [TTS] Audio playback started (detected)')
        this.onTTSStart()
      }
    })

    // Detect when audio ends (TTS completes)
    audioEl.addEventListener('ended', () => {
      console.log('🔇 [TTS] Audio playback ended (detected)')
      this.isStreamingPaused = false
      this.onTTSStop()
    })

    // Detect when audio has data and is ready to play
    audioEl.addEventListener('canplay', () => {
      console.log('🔊 [TTS] Audio ready to play (detected)')
      // Only trigger TTS start if it's not already paused by user
      if (!this.isStreamingPaused) {
        this.onTTSStart()
      }
    })

    // Handle when streaming stops naturally (no more data)
    audioEl.addEventListener('pause', () => {
      // Only trigger stop if it's not user-initiated pause
      if (!this.isStreamingPaused) {
        console.log('🔇 [TTS] Audio stream paused naturally')
        this.onTTSStop()
      }
    })
  }

}
