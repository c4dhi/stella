# main.py
import asyncio
import os
import json
import uuid
import numpy as np
from datetime import datetime, timezone
from typing import Optional
from livekit import rtc
from livekit.rtc import AudioStream, TrackSource
from livekit.api import AccessToken, VideoGrants

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

# TTS Provider Configuration - centralized selection in main.py
TTS_PROVIDER = os.getenv("TTS_PROVIDER", "opensource").lower()
print(f"[startup] TTS Provider configured: {TTS_PROVIDER}")

# Validate TTS configuration
if TTS_PROVIDER == "elevenlabs":
    elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY")
    if elevenlabs_api_key:
        print(f"[startup] ElevenLabs API key found: {elevenlabs_api_key[:8]}...")
        print(f"[startup] ElevenLabs voice ID: {os.getenv('ELEVENLABS_VOICE_ID', '21m00Tcm4TlvDq8ikWAM')}")
        print(f"[startup] ElevenLabs model: {os.getenv('ELEVENLABS_MODEL_ID', 'eleven_turbo_v2_5')}")
    else:
        print("[startup] WARNING: ElevenLabs provider selected but no API key found!")
        print("[startup] Please set ELEVENLABS_API_KEY environment variable")
        print("[startup] Falling back to opensource provider")
        TTS_PROVIDER = "opensource"
elif TTS_PROVIDER == "opensource":
    print("[startup] Using open source TTS engines (Edge TTS, Kokoro, pyttsx3)")
    kokoro_cache = os.getenv("KOKORO_CACHE_DIR", "/root/.cache/kokoro")
    print(f"[startup] Kokoro cache directory: {kokoro_cache}")
else:
    print(f"[startup] WARNING: Unknown TTS provider '{TTS_PROVIDER}', falling back to opensource")
    TTS_PROVIDER = "opensource"

# STT Provider Configuration - centralized selection in main.py
STT_PROVIDER = os.getenv("STT_PROVIDER", "sherpa").lower()
print(f"[startup] STT Provider configured: {STT_PROVIDER}")

# Validate STT configuration
if STT_PROVIDER == "faster-whisper":
    print("[startup] Using faster-whisper (container-compatible, local/opensource)")
    print(f"[startup] Whisper model: {os.getenv('WHISPER_MODEL', 'small.en')}")
    print(f"[startup] Whisper device: {os.getenv('WHISPER_DEVICE', 'cpu')}")
    print(f"[startup] Compute type: {os.getenv('WHISPER_COMPUTE_TYPE', 'int8')}")
    print(f"[startup] VAD threshold: {os.getenv('VAD_THRESHOLD', '0.5')}")
    print(f"[startup] Streaming chunks: {os.getenv('ENABLE_STREAMING_CHUNKS', 'true')}")
elif STT_PROVIDER == "sherpa":
    print("[startup] Using sherpa-onnx for offline STT (default, lightweight)")
else:
    print(f"[startup] WARNING: Unknown STT provider '{STT_PROVIDER}', falling back to sherpa")
    STT_PROVIDER = "sherpa"

# Import the new message processing system
from message_processing.processor import MessageProcessor

LIVEKIT_URL = os.getenv("LIVEKIT_URL", "ws://localhost:7880")
ROOM_NAME = os.getenv("ROOM_NAME", "test-room")
IDENTITY = os.getenv("IDENTITY", "python-listener")
AGENT_NAME = os.getenv("AGENT_NAME", IDENTITY)  # Human-friendly agent name
AGENT_ICON = os.getenv("AGENT_ICON", "🤖")  # Agent emoji icon
PLAN_ID = os.getenv("PLAN_ID")  # Optional plan to load on startup
# set LIVEKIT_API_KEY and LIVEKIT_API_SECRET in your env

print(f"[startup] Agent Identity: {AGENT_ICON}  {AGENT_NAME}")
if PLAN_ID:
    print(f"[startup] Plan ID configured: {PLAN_ID}")
else:
    print("[startup] No plan ID configured, agent will run without a pre-loaded plan")

async def make_join_token(room: str, identity: str) -> str:
    # Uses env LIVEKIT_API_KEY and LIVEKIT_API_SECRET
    return (
        AccessToken()
        .with_identity(identity)
        .with_name(AGENT_NAME)  # Use agent name from environment
        .with_grants(VideoGrants(room_join=True, room=room))
        .to_jwt()
    )

class MessageBuilder:
    """Simple message builder for transcript chunks."""

    @staticmethod
    def create_transcript_chunk(
        text: str,
        is_final: bool = True,
        participant_id: str = "transcription-server",
        transcript_id: Optional[str] = None
    ) -> dict:
        """Create a transcript chunk for user transcription or assistant responses."""
        return {
            "type": "transcript_chunk",
            "data": {
                "text": text,
                "is_final": is_final,
                "confidence": 1.0,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "participant_id": participant_id,
                "chunk_id": f"python_{uuid.uuid4().hex[:8]}",
                "transcript_id": transcript_id or f"python_transcript_{uuid.uuid4().hex[:8]}"
            }
        }

async def send_message(room: rtc.Room, message: dict) -> bool:
    """Send a message to the frontend via LiveKit data channel."""
    try:
        message_json = json.dumps(message)
        message_bytes = message_json.encode("utf-8")
        await room.local_participant.publish_data(message_bytes, reliable=True)
        return True
    except Exception as e:
        print(f"[send_error] Failed to send message: {e}")
        return False

async def handle_user_message(processor: MessageProcessor, user_text: str, participant_identity: str, enable_voice_narration: bool = True):
    """Handle user text message through the AI processing pipeline."""
    try:
        # Use global voice narration state, but respect per-message override
        global_voice_enabled = processor.get_voice_narration_enabled()
        final_voice_enabled = enable_voice_narration and global_voice_enabled

        print(f"[user_message] Processing: {user_text} (voice: {final_voice_enabled}, global: {global_voice_enabled}, per-msg: {enable_voice_narration})")

        # Process the message through the full AI pipeline with voice narration preference
        success = await processor.process_message(user_text, participant_identity, is_voice_transcription=False, enable_voice_narration=final_voice_enabled)

        if success:
            print(f"[processing] Successfully processed: {user_text}")
        else:
            print(f"[processing] Failed to process: {user_text}")

    except Exception as e:
        print(f"[handle_error] Failed to handle user message: {e}")

async def main():
    print(f"[startup] Connecting to LiveKit: {LIVEKIT_URL}")
    print(f"[startup] Room: {ROOM_NAME}, Identity: {IDENTITY}")

    token = await make_join_token(ROOM_NAME, IDENTITY)
    print(f"[startup] Token generated successfully")

    room = rtc.Room()

    # Initialize the message processor with the room
    print("[startup] Initializing message processor...")
    processor = MessageProcessor(room, tts_provider=TTS_PROVIDER, stt_provider=STT_PROVIDER, agent_name=AGENT_NAME, agent_icon=AGENT_ICON, plan_id=PLAN_ID)

    # Initialize plan BEFORE connecting to room (eliminates all race conditions)
    print("[startup] Initializing plan state machine (pre-connection)...")
    try:
        plan_init_success = await processor.initialize_plan()
        if plan_init_success:
            print("[startup] ✅ Plan initialized successfully - ready to process messages")
        else:
            print("[startup] ⚠️  Plan initialization failed - agent may not respond correctly")
    except Exception as e:
        print(f"[startup] ERROR initializing plan: {e}")

    # Simplified: everything is room-level, no individual participant tracking

    # Simple room lifecycle logs
    @room.on("connected")
    def _on_connected():
        print("🟢 Python server connected to LiveKit room!")
        print(f"🤖 AI processing ready with {len(processor.expert_pool.agents)} expert agents")
        print(f"[DEBUG] Room connected: {room.isconnected()}")
        print(f"[DEBUG] Local participant: {room.local_participant.identity}")

        # Initialize TTS, STT, and send plan to frontend after connection
        async def _init_after_connection():
            print("[startup] Initializing TTS audio streaming after connection...")
            try:
                await processor.initialize_tts_audio_streaming()
                print("[startup] TTS audio streaming initialization completed successfully")
            except Exception as e:
                print(f"[startup] ERROR initializing TTS audio streaming: {e}")

            # Initialize STT (required for LiveKit Agent STT)
            print("[startup] Initializing STT after connection...")
            try:
                await processor.initialize_stt()
                print("[startup] STT initialization completed successfully")
            except Exception as e:
                print(f"[startup] ERROR initializing STT: {e}")

            # Send plan to frontend (plan already initialized pre-connection)
            print("[startup] Sending plan data to frontend...")
            try:
                await processor.send_plan_to_frontend()
                print("[startup] Plan data sent to frontend successfully")
            except Exception as e:
                print(f"[startup] ERROR sending plan to frontend: {e}")

        asyncio.create_task(_init_after_connection())

    @room.on("disconnected")
    def _on_disconnected(reason):
        print(f"🔴 Python server disconnected: {reason}")

    @room.on("participant_connected")
    def _on_participant_connected(participant):
        print(f"👤 Participant joined: {participant.identity} ({participant.name or 'no name'})")

    # Track primary user participant to avoid resetting on temporary disconnects
    primary_user_identity = "human"  # Frontend users use "human" as identity (name is in participant.name)
    participant_disconnect_times = {}  # Track disconnect times for reconnect detection

    @room.on("participant_disconnected")
    def _on_participant_disconnected(participant):
        print(f"👋 Participant left: {participant.identity} ({participant.name or 'no name'})")

        # Only reset conversation for primary user, and only after grace period
        # This allows reconnects without losing conversation state
        if participant.identity == primary_user_identity:
            # Store disconnect time for reconnect detection
            participant_disconnect_times[participant.identity] = asyncio.get_event_loop().time()

            async def _check_reconnect():
                # Wait grace period for potential reconnect
                await asyncio.sleep(5.0)  # 5 second grace period

                # Check if participant reconnected during grace period
                # If they're back in the room, don't reset
                is_reconnected = any(
                    p.identity == participant.identity
                    for p in room.remote_participants.values()
                )

                if is_reconnected:
                    print(f"[participant] {participant.identity} reconnected - preserving conversation state")
                else:
                    print(f"[participant] {participant.identity} did not reconnect - conversation preserved in memory")
                    # Note: Not resetting conversation to preserve state across disconnect/reconnect
                    # Conversation will persist until agent pod restarts

            asyncio.create_task(_check_reconnect())
        else:
            # For non-primary participants (e.g., other agents), don't reset conversation
            print(f"[participant] Non-primary participant {participant.identity} left - conversation preserved")

    # Subscribe to audio tracks for real-time transcription
    @room.on("track_subscribed")
    def _on_track_subscribed(
        track: rtc.Track,
        publication: rtc.TrackPublication,
        participant: rtc.RemoteParticipant
    ):
        """Handle incoming audio tracks from participants (e.g., mobile clients)."""
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            print(f"🎤 [AUDIO TRACK] Subscribed to audio from {participant.identity}")

            # Create async task to consume audio frames
            async def consume_audio_track():
                """Consume audio frames from the track and feed to STT."""
                try:
                    # Create AudioStream from the track (16kHz mono for Whisper)
                    audio_stream = AudioStream(
                        track=track,
                        sample_rate=16000,
                        num_channels=1
                    )

                    print(f"[AUDIO TRACK] AudioStream created for {participant.identity} (16kHz, mono)")

                    frame_count = 0
                    # Iterate over audio frames asynchronously
                    async for frame_event in audio_stream:
                        frame_count += 1

                        # Extract PCM data as int16 samples
                        pcm_data = np.frombuffer(frame_event.frame.data, dtype=np.int16)

                        # Feed to STT service for transcription
                        # Pass participant name (or identity as fallback) for proper message attribution
                        await processor.audio_transcription.process_audio_chunk(
                            pcm_data,
                            room_id=participant.name or participant.identity
                        )

                except Exception as e:
                    print(f"[AUDIO TRACK] Error consuming audio track: {e}")
                    import traceback
                    traceback.print_exc()

            # Launch the audio consumption task
            asyncio.create_task(consume_audio_track())

    # Receive classic data packets sent via reliable or lossy data
    @room.on("data_received")
    def _on_data(pkt: rtc.DataPacket):
        topic = pkt.topic or "(no topic)"
        try:
            payload = pkt.data.decode("utf-8", errors="replace")

            # Try to parse as JSON message
            try:
                message = json.loads(payload)
                message_type = message.get("type", "")

                # Get participant identity from message payload (more reliable than pkt.participant)
                who = message.get("participant_id", "unknown")
                if who == "unknown" and pkt.participant:
                    # Fallback to packet participant if available
                    who = pkt.participant.identity

                # Handle audio stream messages - use actual participant identity
                if message_type in ["audio_stream_chunk", "audio_stream_start", "audio_stream_stop", "audio_stream_mute"]:
                    # Only log non-chunk audio events to avoid spam
                    if message_type != "audio_stream_chunk":
                        print(f"[audio] type={message_type} from={who}")

                    # Use actual participant identity so voice transcriptions display correctly
                    if message_type == "audio_stream_start":
                        asyncio.create_task(processor.handle_audio_stream_start(message.get("data", {}), who))
                    elif message_type == "audio_stream_chunk":
                        asyncio.create_task(processor.handle_audio_stream_chunk(message.get("data", {}), who))
                    elif message_type == "audio_stream_stop":
                        asyncio.create_task(processor.handle_audio_stream_stop(message.get("data", {}), who))
                    elif message_type == "audio_stream_mute":
                        asyncio.create_task(processor.handle_audio_stream_mute(message.get("data", {}), who))
                    return

                # Log other message types normally
                print(f"[data] from={who} topic={topic} type={message_type}")

                if message_type == "user_text" and message.get("data"):
                    # Support both simple string format and enhanced object format
                    data = message["data"]
                    if isinstance(data, str):
                        # Legacy format: simple string
                        user_text = data
                        enable_voice_narration = True  # Default to enabled for backwards compatibility
                    else:
                        # Enhanced format: object with text and optional voice narration field
                        user_text = data.get("text", "")
                        enable_voice_narration = data.get("enable_voice_narration", True)  # Default to enabled

                    print(f"[user_text]: {user_text} (voice_narration: {enable_voice_narration})")

                    # Handle user message with full AI processing pipeline
                    # Use actual participant identity so messages display correctly in frontend
                    asyncio.create_task(handle_user_message(processor, user_text, who, enable_voice_narration))

                elif message_type == "tts_pause":
                    print(f"[tts_control] Received TTS pause request from {who}")
                    asyncio.create_task(processor.pause_tts())

                elif message_type == "tts_resume":
                    print(f"[tts_control] Received TTS resume request from {who}")
                    asyncio.create_task(processor.resume_tts())

                elif message_type == "barge_in":
                    # Handle barge-in control messages
                    barge_data = message.get("data", {})
                    action = barge_data.get("action", "unknown")

                    if action == "pause":
                        print(f"[barge_in] Received manual barge-in pause request from {who}")
                        asyncio.create_task(processor.pause_tts())
                    elif action == "enable":
                        print(f"[barge_in] Enabling barge-in detection from {who}")
                        if hasattr(processor.audio_transcription, 'enable_barge_in_detection'):
                            processor.audio_transcription.enable_barge_in_detection()
                    elif action == "disable":
                        print(f"[barge_in] Disabling barge-in detection from {who}")
                        if hasattr(processor.audio_transcription, 'disable_barge_in_detection'):
                            processor.audio_transcription.disable_barge_in_detection()
                    elif action == "status":
                        print(f"[barge_in] Status request from {who}")
                        if hasattr(processor, 'get_barge_in_status'):
                            status = processor.get_barge_in_status()
                            # Send status back to frontend
                            status_message = {
                                "type": "barge_in_status",
                                "data": status
                            }
                            asyncio.create_task(send_message(room, status_message))
                    elif action == "force_abandon":
                        print(f"[barge_in] Force abandon request from {who}")
                        if hasattr(processor, 'force_abandon_barge_in'):
                            asyncio.create_task(processor.force_abandon_barge_in())
                    else:
                        print(f"[barge_in] from={who} action={action}")

                elif message_type == "voice_narration_control":
                    # Handle voice narration control messages
                    action = message.get("action", "unknown")

                    if action == "enable":
                        print(f"[voice_narration] Enabling voice narration from {who}")
                        processor.set_voice_narration_enabled(True)
                    elif action == "disable":
                        print(f"[voice_narration] Disabling voice narration from {who}")
                        processor.set_voice_narration_enabled(False)
                    else:
                        print(f"[voice_narration] Unknown action from {who}: {action}")

                elif message_type == "barge_in_event":
                    # This message type is sent FROM the server TO the frontend
                    # Log if we receive it (shouldn't normally happen)
                    print(f"[barge_in_event] Unexpected barge-in event received from {who}: {message.get('data', {})}")

            except json.JSONDecodeError:
                # Not JSON, just log as plain text (but truncate if too long)
                log_payload = payload[:200] + "..." if len(payload) > 200 else payload
                print(f"[plain_text] from={who}: {log_payload}")

        except Exception as e:
            print(f"[data_error] from={who}: {e}")

    # Receive text streams on a given topic
    # For example, frontends often use topics like "chat" or "lk.chat"
    async def handle_text(reader: rtc.TextStreamReader, participant_identity: str):
        info = reader.info
        text = await reader.read_all()
        who = participant_identity or "server"
        print(f"[text] from={who} topic={info.topic} text={text}")

    # Register a handler for your chosen topic
    room.register_text_stream_handler("chat", handle_text)
    room.register_text_stream_handler("lk.chat", handle_text)  # common default for agents

    # Connect and keep the task alive
    print(f"[startup] Attempting to connect to room...")
    print(f"[startup] Room connected before: {room.isconnected()}")
    await room.connect(LIVEKIT_URL, token)
    print(f"[startup] Connect call completed, checking connection status...")
    print(f"[startup] Room connected after: {room.isconnected()}")

    # Manual initialization if the event didn't fire
    if room.isconnected():
        print("[startup] Room is connected, manually initializing if event didn't fire...")
        try:
            await processor.initialize_tts_audio_streaming()
            print("[startup] Manual TTS audio streaming initialization completed")

            # Initialize STT
            await processor.initialize_stt()
            print("[startup] Manual STT initialization completed")

            # Send plan to frontend (plan already initialized pre-connection)
            await processor.send_plan_to_frontend()
            print("[startup] Manual plan data sent to frontend")
        except Exception as e:
            print(f"[startup] ERROR in manual initialization: {e}")

    try:
        while room.isconnected():
            await asyncio.sleep(1)
        print(f"[startup] Connection loop exited - room no longer connected")
    finally:
        print(f"[startup] Disconnecting from room...")
        await room.disconnect()

if __name__ == "__main__":
    asyncio.run(main())