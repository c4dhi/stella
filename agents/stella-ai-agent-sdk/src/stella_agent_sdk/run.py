"""
Run agent entry point for STELLA Agent SDK.

This module provides the run_agent_from_env() function - the ONLY entry point
for running agents. All configuration comes from environment variables set
by the session-management-server when deploying agent pods.

Usage:
    ```python
    import asyncio
    from stella_agent_sdk import BaseAgent, run_agent_from_env

    class MyAgent(BaseAgent):
        async def process(self, input):
            yield AgentOutput.text_final(input.session_id, "Hello!")

        async def on_interrupt(self, session_id):
            pass

    if __name__ == "__main__":
        asyncio.run(run_agent_from_env(MyAgent()))
    ```

Environment Variables (set by session-management-server):
    LIVEKIT_URL: LiveKit server WebSocket URL
    ROOM_NAME: Name of the LiveKit room to join
    AGENT_IDENTITY: Participant identity for the agent
    LIVEKIT_API_KEY: LiveKit API key for JWT authentication
    LIVEKIT_API_SECRET: LiveKit API secret for JWT signing
    STT_SERVICE_ADDRESS: Address of external STT service (gRPC)
    TTS_SERVICE_ADDRESS: Address of external TTS service (gRPC)
    SESSION_SERVER_URL: URL of session management server (for chat history)
    SESSION_ID: Database session ID (UUID) for chat history API calls
    AGENT_CONFIG: JSON string with agent-specific configuration (passed to on_session_start)
"""

import asyncio
import json
import logging
import os
import re
import signal
import time
import uuid
from typing import Optional, Dict, Any, Coroutine

import jwt

from stella_agent_sdk.agent.base import BaseAgent
from stella_agent_sdk.audio.pipeline import AudioPipeline
from stella_agent_sdk.livekit.room import RoomManager
from stella_agent_sdk.services.stt_client import STTClient
from stella_agent_sdk.services.tts_client import TTSClient
from stella_agent_sdk.services.history_client import HistoryClient
from stella_agent_sdk.services.agent_server_client import AgentServerClient
from stella_agent_sdk.messages.types import OutputType

logger = logging.getLogger(__name__)


def _parse_participant_event_config(agent_config: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Extract and normalize participant event message config from AGENT_CONFIG.

    Expected source path (set by Plan Builder Start node):
    agent_config.plan.metadata.plan_builder.start
      - on_participant_join: { enabled: bool, message_template: str }
      - on_participant_left: { enabled: bool, message_template: str }

    This function is defensive because AGENT_CONFIG is untyped JSON at runtime:
    missing/non-dict nodes are treated as absent and defaults are applied.

    Returns:
        {
            "joined": {"enabled": bool, "template": str},
            "left": {"enabled": bool, "template": str},
        }
    """
    plan = agent_config.get("plan")
    metadata = plan.get("metadata") if isinstance(plan, dict) else None
    plan_builder = metadata.get("plan_builder") if isinstance(metadata, dict) else None
    start_cfg = plan_builder.get("start") if isinstance(plan_builder, dict) else None

    join_cfg_raw = start_cfg.get("on_participant_join") if isinstance(start_cfg, dict) else None
    left_cfg_raw = start_cfg.get("on_participant_left") if isinstance(start_cfg, dict) else None

    join_enabled = isinstance(join_cfg_raw, dict) and join_cfg_raw.get("enabled") is True
    left_enabled = isinstance(left_cfg_raw, dict) and left_cfg_raw.get("enabled") is True

    join_template = (
        join_cfg_raw.get("message_template")
        if isinstance(join_cfg_raw, dict) and isinstance(join_cfg_raw.get("message_template"), str)
        else ""
    )
    left_template = (
        left_cfg_raw.get("message_template")
        if isinstance(left_cfg_raw, dict) and isinstance(left_cfg_raw.get("message_template"), str)
        else ""
    )

    return {
        "joined": {"enabled": join_enabled, "template": join_template},
        "left": {"enabled": left_enabled, "template": left_template},
    }


def _render_message_template(template: str, variables: Dict[str, str]) -> str:
    """Render `{variable}` placeholders in a message template.

    Supported placeholder syntax is `{key}` where `key` is alphanumeric/underscore.
    Any placeholder without a matching entry in `variables` is replaced with an
    empty string, so rendering never raises due to missing keys.
    """
    return re.sub(r"\{([a-zA-Z0-9_]+)\}", lambda m: variables.get(m.group(1), ""), template)


def _is_registered_participant_identity(identity: str) -> bool:
    """Check whether a LiveKit identity should trigger participant event speech.

    The join/left TTS feature should only fire for real invited/registered
    session participants. In this codebase those identities are generated with
    the ``participant-`` prefix (for both invitation and manual registration
    flows). Other identities such as organizer/admin (``human``), agents
    (``agent-*``), and system participants are intentionally excluded.

    Args:
        identity: LiveKit participant identity from room callbacks.

    Returns:
        ``True`` only for identities that start with ``participant-``.
    """
    return isinstance(identity, str) and identity.startswith("participant-")


async def run_agent_from_env(agent: BaseAgent) -> None:
    """
    Run an agent using environment variables for configuration.

    This is the main entry point for agents. All configuration comes from
    environment variables that are set by the session-management-server
    when deploying agent pods to Kubernetes.

    The function:
    1. Reads configuration from environment variables
    2. Connects to LiveKit room
    3. Connects to external STT service (via gRPC)
    4. Connects to external TTS service (via gRPC)
    5. Initializes the AudioPipeline
    6. Runs the agent's audio loop

    Required Environment Variables:
        LIVEKIT_URL: LiveKit server WebSocket URL
        ROOM_NAME: Name of the LiveKit room to join
        AGENT_IDENTITY: Participant identity (e.g., "agent-abc123")
        LIVEKIT_API_KEY: LiveKit API key for JWT authentication
        LIVEKIT_API_SECRET: LiveKit API secret for JWT signing
        STT_SERVICE_ADDRESS: Address of STT service (e.g., "stt-service:50051")
        TTS_SERVICE_ADDRESS: Address of TTS service (e.g., "tts-service:50052")
        SESSION_ID: Database session UUID for chat history API (optional, falls back to ROOM_NAME)

    Args:
        agent: The BaseAgent instance to run

    Example:
        ```python
        import asyncio
        from stella_agent_sdk import BaseAgent, run_agent_from_env

        class EchoAgent(BaseAgent):
            async def run_audio_loop(self) -> None:
                # Register barge-in handler
                self.audio.on_speech_started(self._handle_barge_in)

                async for event in self.audio.audio_in():
                    # event.is_final is always True (partials sent to LiveKit)
                    await self.audio.audio_out(f"You said: {event.text}")

            async def _handle_barge_in(self) -> None:
                await self.audio.stop_speaking()

        if __name__ == "__main__":
            asyncio.run(run_agent_from_env(EchoAgent()))
        ```
    """
    # Read configuration from environment
    livekit_url = os.environ["LIVEKIT_URL"]
    room_name = os.environ["ROOM_NAME"]
    identity = os.environ["AGENT_IDENTITY"]
    livekit_api_key = os.environ["LIVEKIT_API_KEY"]
    livekit_api_secret = os.environ["LIVEKIT_API_SECRET"]
    stt_address = os.environ.get("STT_SERVICE_ADDRESS", "stt-service:50051")
    tts_address = os.environ.get("TTS_SERVICE_ADDRESS", "tts-service:50052")
    session_server_url = os.environ.get("SESSION_SERVER_URL", "http://session-management-server:3000")

    # Session ID for database operations (different from room_name which is LiveKit room)
    # SESSION_ID is the database UUID, room_name is the LiveKit room name
    session_id = os.environ.get("SESSION_ID", room_name)

    # Agent metadata for message attribution
    agent_name = os.environ.get("AGENT_NAME", "Agent")
    agent_id = os.environ.get("AGENT_ID", identity)
    agent_icon = os.environ.get("AGENT_ICON", "🤖")

    # Agent-specific configuration (JSON string from AGENT_CONFIG env var)
    # Each agent interprets this config as needed (e.g., StellaAgent uses plan_id)
    agent_config_str = os.environ.get("AGENT_CONFIG", "{}")
    try:
        agent_config = json.loads(agent_config_str)
    except json.JSONDecodeError as e:
        logger.warning(f"Invalid AGENT_CONFIG JSON: {e}, using empty config")
        agent_config = {}

    logger.info(f"Starting agent {agent.agent_type} v{agent.agent_version}")
    logger.info(f"Agent config: {agent_config}")
    logger.info(f"Room: {room_name}, Identity: {identity}, Session: {session_id}")
    logger.info(f"STT: {stt_address}, TTS: {tts_address}")
    participant_event_config = _parse_participant_event_config(agent_config)
    logger.info(
        "Participant event speech config: joined=%s, left=%s",
        participant_event_config["joined"]["enabled"],
        participant_event_config["left"]["enabled"],
    )

    # Agent server address for registration (gRPC)
    # GRPC_SERVER is set by kubernetes.service.ts when deploying agent pods
    agent_server_address = os.environ.get("GRPC_SERVER", os.environ.get("AGENT_SERVER_ADDRESS", "session-management-server:50051"))

    # Initialize components
    room_manager: Optional[RoomManager] = None
    stt_client: Optional[STTClient] = None
    tts_client: Optional[TTSClient] = None
    audio_pipeline: Optional[AudioPipeline] = None
    history_client: Optional[HistoryClient] = None
    agent_server_client: Optional[AgentServerClient] = None
    shutdown_event = asyncio.Event()

    # Set up signal handlers for graceful shutdown
    def signal_handler(sig, frame):
        logger.info(f"Received signal {sig}, shutting down...")
        shutdown_event.set()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        # 1. Initialize RoomManager for LiveKit
        room_manager = RoomManager(
            livekit_url=livekit_url,
            api_key=livekit_api_key,
            api_secret=livekit_api_secret,
        )

        # 2. Connect to external STT service (gRPC)
        stt_client = STTClient(stt_address)
        await stt_client.connect()
        logger.info(f"Connected to STT service at {stt_address}")

        # 2b. Warm up STT model before user speaks (eliminates cold-start latency)
        if os.environ.get("STT_WARMUP_ENABLED", "true").lower() != "false":
            warmup_result = await stt_client.warmup(session_id=session_id)
            if warmup_result["success"]:
                logger.info(f"STT warmup completed in {warmup_result['warmup_time_ms']}ms ({warmup_result['provider']})")
            else:
                logger.warning(f"STT warmup failed: {warmup_result['message']}")

        # 3. Connect to external TTS service (gRPC) - conditional on TTS_ENABLED
        tts_enabled = os.environ.get("TTS_ENABLED", "true").lower() != "false"
        if tts_enabled:
            tts_client = TTSClient(tts_address)
            await tts_client.connect()
            logger.info(f"Connected to TTS service at {tts_address}")
        else:
            logger.info("TTS disabled (TTS_ENABLED=false) - skipping TTS connection")

        # 4. Connect to LiveKit room (with agent display name)
        await room_manager.connect(room_name, identity, name=agent_name)
        logger.info(f"Connected to LiveKit room: {room_name} as {agent_name}")

        # 5. Create AudioPipeline (orchestrates audio flow)
        # session_id was already set from SESSION_ID env var (or room_name as fallback)
        audio_pipeline = AudioPipeline(
            room_manager=room_manager,
            stt_client=stt_client,
            tts_client=tts_client,
            session_id=session_id,
            agent_name=agent_name,
            agent_id=agent_id,
        )

        # 6. Inject audio pipeline and agent identity into agent
        agent._audio_pipeline = audio_pipeline
        agent._session_id = session_id
        agent._agent_name = agent_name
        agent._agent_id = agent_id
        agent._agent_icon = agent_icon

        # 7. Create HistoryClient for chat history access
        # Generate JWT token with same claims as LiveKit token (for validation)
        now = int(time.time())
        token_claims = {
            "iss": livekit_api_key,
            "sub": identity,
            "iat": now,
            "exp": now + 3600,  # 1 hour expiry
            "nbf": now,
            "video": {
                "roomJoin": True,
                "room": room_name,
                "canPublish": True,
                "canSubscribe": True,
                "canPublishData": True,
            },
        }
        agent_token = jwt.encode(token_claims, livekit_api_secret, algorithm="HS256")

        history_client = HistoryClient(
            base_url=session_server_url,
            token=agent_token,
            session_id=session_id,
        )
        agent._history_client = history_client
        logger.info(f"Chat history client initialized for session {session_id}")
        logger.info(f"History client base_url: {session_server_url}")

        # 8. Start audio pipeline
        await audio_pipeline.start()

        # 9. Call agent's session start hook with the agent config
        # The config is passed through as-is - each agent interprets it as needed
        await agent.on_session_start(session_id, agent_config)
        logger.info(f"Agent session started with config keys: {list(agent_config.keys())}")

        # 10. Call on_ready hook to send initial outputs (e.g., progress state)
        async for output in agent.on_ready(session_id):
            if output.type == OutputType.PROGRESS_UPDATE:
                # Send progress update to frontend with agent identity metadata
                progress_data = output.metadata.get("progress_state", {}) if output.metadata else {}
                # Ensure metadata dict exists
                if "metadata" not in progress_data:
                    progress_data["metadata"] = {}
                # Always include agent identity for proper frontend attribution
                progress_data["metadata"]["agent_id"] = agent_id
                progress_data["metadata"]["agent_name"] = agent_name
                progress_data["metadata"]["agent_icon"] = agent_icon
                progress_payload = {
                    "type": "progress_update",
                    "data": progress_data
                }
                # Store on agent for re-sending to new participants
                agent._last_progress_payload = progress_payload
                logger.info(f"[INITIAL PROGRESS] Publishing: {progress_payload}")
                await audio_pipeline._room.publish_data(progress_payload)
            elif output.type == OutputType.DEBUG:
                # Forward debug messages
                debug_payload = {
                    "type": "debug",
                    "data": {
                        "content": output.content,
                        "component": output.metadata.get("component", "agent") if output.metadata else "agent",
                        "level": output.metadata.get("level", "info") if output.metadata else "info",
                        "metadata": output.metadata or {}
                    }
                }
                await audio_pipeline._room.publish_data(debug_payload)
            else:
                logger.debug(f"[ON_READY] Ignoring output type: {output.type}")

        # 10b. Register agent with session-management-server (marks status as RUNNING)
        logger.info(f"Registering agent: type='{agent.agent_type}', version='{agent.agent_version}'")
        agent_server_client = AgentServerClient(agent_server_address)
        try:
            await agent_server_client.connect()
            registration_result = await agent_server_client.register_agent(
                agent_type=agent.agent_type,
                agent_version=agent.agent_version,
            )
            if registration_result["success"]:
                logger.info(f"Agent registered with session-management-server: {registration_result['session_id']}")
            else:
                logger.warning(f"Agent registration response: {registration_result['message']}")
        except Exception as e:
            # Log but don't fail - agent can still work without registration
            logger.warning(f"Failed to register agent with session-management-server: {e}")
        finally:
            await agent_server_client.disconnect()
            agent_server_client = None

        # Track participant event tasks so they are not left unmanaged.
        participant_event_tasks: set[asyncio.Task[Any]] = set()

        def spawn_participant_event_task(coro: Coroutine[Any, Any, None]) -> None:
            task = asyncio.create_task(coro)
            participant_event_tasks.add(task)
            task.add_done_callback(participant_event_tasks.discard)

        async def emit_participant_event_message(
            event_type: str,
            participant_identity: str,
        ) -> None:
            """Render and speak configured join/left event messages.

            Called by LiveKit participant callbacks in this runtime.
            Behavior:
            - Reads normalized event config from ``participant_event_config``.
            - Returns early when event is disabled or template is blank.
            - Ignores non-participant identities (agent/admin/system).
            - Renders template placeholders using participant/agent variables.
            - Publishes rendered text as final agent text and speaks it via TTS.
            """
            try:
                cfg = participant_event_config.get(event_type, {})
                if cfg.get("enabled") is not True:
                    return

                if not _is_registered_participant_identity(participant_identity):
                    logger.info(
                        "[PARTICIPANT %s] Skipping non-participant identity: %s",
                        event_type.upper(),
                        participant_identity,
                    )
                    return

                template = cfg.get("template") or ""
                if not isinstance(template, str) or not template.strip():
                    return

                participant_name = room_manager.get_participant_name(participant_identity) or participant_identity
                variables = {
                    "participant_name": participant_name,
                    "agent_name": agent_name,
                }
                rendered = _render_message_template(template, variables).strip()
                if not rendered:
                    return

                transcript_id = f"participant_event_{event_type}_{uuid.uuid4().hex[:8]}"
                await audio_pipeline.publish_text(rendered, is_final=True, transcript_id=transcript_id)
                await audio_pipeline.speak(rendered)
                logger.info("[PARTICIPANT %s] Spoke configured message: %s", event_type.upper(), rendered)
            except Exception:
                logger.exception(
                    "[PARTICIPANT %s] Failed to emit configured message for identity: %s",
                    event_type.upper(),
                    participant_identity,
                )

        # 10c. Register callback to re-send progress when new participants join
        def on_participant_joined(participant_identity: str):
            # Use the agent's stored progress payload (updated by audio loop)
            logger.info(f"[PARTICIPANT JOINED] {participant_identity} - _last_progress_payload exists: {agent._last_progress_payload is not None}")

            # Warm up STT model when participant joins (in case agent was idle)
            # The warmup has a TTL, so this is a no-op if model is already warm
            if os.environ.get("STT_WARMUP_ENABLED", "true").lower() != "false":
                async def do_warmup():
                    result = await stt_client.warmup(session_id=session_id)
                    if result["success"]:
                        logger.info(f"STT warmup on participant join completed in {result['warmup_time_ms']}ms")
                asyncio.create_task(do_warmup())

            if agent._last_progress_payload:
                logger.info(f"[PARTICIPANT JOINED] {participant_identity} - re-sending progress state")
                # Schedule the async publish_data call
                asyncio.create_task(audio_pipeline._room.publish_data(agent._last_progress_payload))
            else:
                logger.warning(f"[PARTICIPANT JOINED] {participant_identity} - no progress payload to send!")

            spawn_participant_event_task(emit_participant_event_message("joined", participant_identity))

        def on_participant_left(participant_identity: str):
            """
            Handle participant left event. Currently only emits a TTS message if enabled and configured.

            Args:
                participant_identity: The LiveKit identity of the participant who left
            """
            logger.info(f"[PARTICIPANT LEFT] {participant_identity}")
            spawn_participant_event_task(emit_participant_event_message("left", participant_identity))

        # Register participant event callbacks with RoomManager
        room_manager.on_participant_joined(on_participant_joined)
        room_manager.on_participant_left(on_participant_left)

        # 10d. Send progress to any participants already in the room
        if agent._last_progress_payload and room_manager._room:
            existing_participants = list(room_manager._room.remote_participants.values())
            logger.info(f"[EXISTING PARTICIPANTS] Found {len(existing_participants)} participants already in room")
            for participant in existing_participants:
                logger.info(f"[EXISTING PARTICIPANTS] Sending progress to {participant.identity}")
                await audio_pipeline._room.publish_data(agent._last_progress_payload)

        # 11. Run the agent's audio loop until shutdown
        audio_loop_task = asyncio.create_task(agent.run_audio_loop())

        # Wait for either shutdown signal or audio loop completion
        done, pending = await asyncio.wait(
            [audio_loop_task, asyncio.create_task(shutdown_event.wait())],
            return_when=asyncio.FIRST_COMPLETED,
        )

        # Cancel pending tasks
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    except Exception as e:
        logger.error(f"Agent error: {e}")
        raise

    finally:
        # Cleanup in reverse order
        logger.info("Cleaning up...")

        # End session
        if agent._session_id:
            try:
                await agent.on_session_end(agent._session_id)
            except Exception as e:
                logger.error(f"Error in on_session_end: {e}")

        # Stop audio pipeline
        if audio_pipeline:
            try:
                await audio_pipeline.stop()
            except Exception as e:
                logger.error(f"Error stopping audio pipeline: {e}")

        # Clear agent's audio pipeline reference
        agent._audio_pipeline = None

        # Close history client
        if history_client:
            try:
                await history_client.close()
            except Exception as e:
                logger.error(f"Error closing history client: {e}")

        # Clear agent's history client reference
        agent._history_client = None

        # Disconnect from LiveKit
        if room_manager:
            try:
                await room_manager.disconnect()
            except Exception as e:
                logger.error(f"Error disconnecting from LiveKit: {e}")

        # Disconnect from STT service
        if stt_client:
            try:
                await stt_client.disconnect()
            except Exception as e:
                logger.error(f"Error disconnecting from STT: {e}")

        # Disconnect from TTS service
        if tts_client:
            try:
                await tts_client.disconnect()
            except Exception as e:
                logger.error(f"Error disconnecting from TTS: {e}")

        logger.info("Agent shutdown complete")
