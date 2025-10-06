"""
Multi-room connection manager for LiveKit message recording.
Manages connections to multiple LiveKit rooms simultaneously.
"""
import asyncio
import json
import os
from typing import Dict, Optional, Set
from livekit import rtc
from livekit.api import AccessToken, VideoGrants
from datetime import datetime


class RoomManager:
    """Manages connections to multiple LiveKit rooms"""

    def __init__(self, livekit_url: str, message_client):
        self.livekit_url = livekit_url
        self.message_client = message_client
        self.rooms: Dict[str, rtc.Room] = {}  # session_id -> Room instance
        self.api_key = os.getenv('LIVEKIT_API_KEY')
        self.api_secret = os.getenv('LIVEKIT_API_SECRET')

        if not self.api_key or not self.api_secret:
            raise ValueError("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set")

    async def sync_rooms(self, active_sessions: list):
        """
        Synchronize room connections with active sessions.
        Joins new rooms, leaves inactive ones.
        """
        active_session_ids = {s['id'] for s in active_sessions}
        current_session_ids = set(self.rooms.keys())

        # Join new rooms
        to_join = active_session_ids - current_session_ids
        for session_id in to_join:
            session = next(s for s in active_sessions if s['id'] == session_id)
            try:
                await self.join_room(session)
            except Exception as e:
                print(f"❌ Error joining room for session {session_id}: {e}")

        # Leave inactive rooms
        to_leave = current_session_ids - active_session_ids
        for session_id in to_leave:
            try:
                await self.leave_room(session_id)
            except Exception as e:
                print(f"❌ Error leaving room for session {session_id}: {e}")

        # Log current state
        print(f"📊 Managing {len(self.rooms)} rooms: {list(self.rooms.keys())}")

    async def join_room(self, session: dict):
        """Connect to a LiveKit room for the given session"""
        session_id = session['id']
        room_name = session['room']['livekitRoomName']

        print(f"🔌 Connecting to room: {room_name} (session: {session_id})")

        # Create new room instance
        room = rtc.Room()

        # Set up event handlers for this room
        self._setup_event_handlers(room, session_id, room_name)

        # Generate access token
        token = await self._generate_token(room_name)

        # Connect to the room
        await room.connect(self.livekit_url, token)

        # Store room reference
        self.rooms[session_id] = room

        print(f"✅ Connected to room: {room_name} (session: {session_id})")

        # Log to dashboard
        await self.message_client.post_log(
            'log',
            f'Connected to room {room_name}',
            session_id=session_id
        )

    async def leave_room(self, session_id: str):
        """Disconnect from a room"""
        room = self.rooms.pop(session_id, None)
        if room:
            try:
                await room.disconnect()
                print(f"👋 Disconnected from session: {session_id}")
            except Exception as e:
                print(f"⚠️  Error disconnecting from session {session_id}: {e}")

    def _setup_event_handlers(self, room: rtc.Room, session_id: str, room_name: str):
        """Set up event handlers for a room"""

        @room.on("connected")
        def on_connected():
            print(f"🟢 Room connected: {room_name}")

        @room.on("disconnected")
        def on_disconnected(reason):
            print(f"🔴 Room disconnected: {room_name}, reason: {reason}")

        @room.on("participant_connected")
        def on_participant_connected(participant: rtc.RemoteParticipant):
            # Skip logging for the monitor itself
            if participant.identity == "message-recorder":
                return
            print(f"👤 Participant joined {room_name}: {participant.identity} ({participant.name})")

            # Store join event to conversation timeline
            asyncio.create_task(
                self.message_client.store_participant_event(
                    session_id,
                    'joined',
                    participant.identity,
                    participant.name
                )
            )

        @room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            if participant.identity == "message-recorder":
                return
            print(f"👋 Participant left {room_name}: {participant.identity}")

            # Store leave event to conversation timeline
            asyncio.create_task(
                self.message_client.store_participant_event(
                    session_id,
                    'left',
                    participant.identity,
                    participant.name
                )
            )

        @room.on("data_received")
        def on_data_received(data_packet: rtc.DataPacket):
            """Handle incoming data messages - THIS IS THE CORE RECORDING LOGIC"""
            # Process in background task to not block event handler
            asyncio.create_task(
                self._handle_data_message(session_id, room_name, data_packet)
            )

    async def _handle_data_message(self, session_id: str, room_name: str, data_packet: rtc.DataPacket):
        """Process and store a data message"""
        try:
            # Decode the message
            message_text = data_packet.data.decode('utf-8')
            envelope = json.loads(message_text)

            # Extract participant info from envelope FIRST (authoritative source)
            # The envelope's participant_id is set by the sender and represents the logical sender
            envelope_participant_id = envelope.get('participant_id')

            # Fallback to LiveKit packet participant if envelope doesn't have it
            packet_participant_identity = None
            packet_participant_name = None
            if data_packet.participant:
                packet_participant_identity = data_packet.participant.identity
                packet_participant_name = data_packet.participant.name

            # Use envelope participant_id first (more accurate for message attribution)
            # Fall back to packet participant if envelope doesn't specify
            participant_identity = envelope_participant_id or packet_participant_identity
            participant_name = packet_participant_name  # Use LiveKit display name

            # Log message (but not audio chunks to avoid spam)
            message_type = envelope.get('type', 'unknown')
            if message_type != 'audio_stream_chunk':
                print(f"📨 Message in {room_name}: type={message_type}, from={participant_identity}")

                # Log transcript messages to dashboard
                if message_type == 'transcript_chunk':
                    is_final = envelope.get('data', {}).get('is_final', True)
                    status = 'final' if is_final else 'partial'
                    await self.message_client.post_log(
                        'debug',
                        f'Received {status} transcript from {participant_identity or "unknown"}',
                        session_id=session_id,
                        data={'type': message_type, 'is_final': is_final}
                    )

            # Store complete message envelope via API
            await self.message_client.store_message(
                session_id=session_id,
                message_envelope=envelope,
                participant_identity=participant_identity,
                participant_name=participant_name
            )

        except json.JSONDecodeError as e:
            print(f"⚠️  Invalid JSON in message from {room_name}: {e}")
            await self.message_client.post_log(
                'warn',
                f'Invalid JSON in data message: {str(e)}',
                session_id=session_id
            )
        except Exception as e:
            print(f"❌ Error handling message from {room_name}: {e}")
            await self.message_client.post_log(
                'error',
                f'Error handling message: {str(e)}',
                session_id=session_id
            )

    async def _generate_token(self, room_name: str) -> str:
        """Generate a JWT token for joining a room"""
        token = (
            AccessToken(self.api_key, self.api_secret)
            .with_identity("message-recorder")
            .with_name("Message Recorder")
            .with_grants(VideoGrants(room_join=True, room=room_name))
        )
        return token.to_jwt()

    async def disconnect_all(self):
        """Disconnect from all rooms (cleanup on shutdown)"""
        print("🔌 Disconnecting from all rooms...")
        disconnect_tasks = [self.leave_room(sid) for sid in list(self.rooms.keys())]
        await asyncio.gather(*disconnect_tasks, return_exceptions=True)
        print("✅ All rooms disconnected")
