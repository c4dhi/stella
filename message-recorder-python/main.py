"""
Message Recorder Service - Main Entry Point

A single service that monitors all active LiveKit rooms and records
data messages to the session management server.

Features:
- Auto-discovers active sessions via API polling
- Connects to multiple LiveKit rooms simultaneously
- Records all data messages (transcripts, events, etc.)
- Automatically joins new rooms and leaves inactive ones
"""
import asyncio
import os
import signal
import sys
from datetime import datetime

from room_manager import RoomManager
from message_client import MessageClient


# Configuration from environment variables
LIVEKIT_URL = os.getenv('LIVEKIT_URL', 'ws://livekit:7880')
SESSION_SERVER_URL = os.getenv('SESSION_SERVER_URL', 'http://session-management-server:3000')
POLL_INTERVAL = int(os.getenv('POLL_INTERVAL', '2'))  # seconds


class MessageRecorderService:
    """Main service coordinator"""

    def __init__(self):
        self.message_client = MessageClient(base_url=SESSION_SERVER_URL)
        self.room_manager = RoomManager(
            livekit_url=LIVEKIT_URL,
            message_client=self.message_client
        )
        self.running = True

    async def start(self):
        """Start the message recorder service"""
        print("="*60)
        print("🎙️  Message Recorder Service Starting")
        print("="*60)
        print(f"📡 LiveKit URL: {LIVEKIT_URL}")
        print(f"🌐 Session Server: {SESSION_SERVER_URL}")
        print(f"⏱️  Poll Interval: {POLL_INTERVAL}s")
        print(f"🕐 Started at: {datetime.now().isoformat()}")
        print("="*60)

        # Post startup log to dashboard
        await self.message_client.post_log(
            'log',
            f'Message Recorder Service started - polling every {POLL_INTERVAL}s',
            data={'livekit_url': LIVEKIT_URL, 'poll_interval': POLL_INTERVAL}
        )

        # Set up graceful shutdown
        self._setup_signal_handlers()

        # Main polling loop
        poll_count = 0
        error_count = 0

        while self.running:
            try:
                poll_count += 1
                print(f"\n📊 Poll #{poll_count} at {datetime.now().strftime('%H:%M:%S')}")

                # Get active sessions from API
                active_sessions = await self.message_client.get_active_sessions()
                print(f"📋 Found {len(active_sessions)} active sessions")

                # Synchronize room connections
                await self.room_manager.sync_rooms(active_sessions)

                # Update monitoring status with connected sessions
                connected_session_ids = list(self.room_manager.rooms.keys())
                await self.message_client.update_monitoring_status(connected_session_ids)

                # Reset error count on successful poll
                error_count = 0

                # Wait before next poll
                await asyncio.sleep(POLL_INTERVAL)

            except KeyboardInterrupt:
                print("\n⚠️  Keyboard interrupt received")
                break
            except Exception as e:
                error_count += 1
                print(f"❌ Error in main loop (attempt {error_count}): {e}")

                # Exponential backoff on errors, max 60s
                backoff = min(5 * error_count, 60)
                print(f"⏳ Waiting {backoff}s before retry...")
                await asyncio.sleep(backoff)

        # Cleanup
        await self.shutdown()

    async def shutdown(self):
        """Graceful shutdown"""
        print("\n" + "="*60)
        print("🛑 Shutting down Message Recorder Service")
        print("="*60)

        try:
            # Disconnect from all rooms
            await self.room_manager.disconnect_all()

            # Close HTTP client
            await self.message_client.close()

            print("✅ Shutdown complete")
        except Exception as e:
            print(f"⚠️  Error during shutdown: {e}")

    def _setup_signal_handlers(self):
        """Set up handlers for graceful shutdown"""
        def signal_handler(signum, frame):
            print(f"\n⚠️  Received signal {signum}")
            self.running = False

        signal.signal(signal.SIGTERM, signal_handler)
        signal.signal(signal.SIGINT, signal_handler)


async def main():
    """Main entry point"""
    service = MessageRecorderService()

    try:
        await service.start()
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    # Run the service
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Service stopped by user")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        sys.exit(1)
