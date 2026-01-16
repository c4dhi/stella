---
sidebar_position: 3
title: "🧱 Base Agent"
---

# 🧱 BaseAgent Class

The `BaseAgent` class is the foundation for all STELLA agents. It handles LiveKit connectivity, audio processing, and message passing.

## Class Definition

```python
from stella_sdk import BaseAgent

class BaseAgent:
    """Base class for all STELLA agents."""

    def __init__(self, config: AgentConfig = None):
        """Initialize the agent with optional configuration."""

    async def run(self):
        """Start the agent and connect to the room."""

    async def stop(self):
        """Stop the agent and disconnect from the room."""
```

## Lifecycle Methods

Override these methods to customize agent behavior:

### on_connect

```python
async def on_connect(self):
    """Called when the agent successfully connects to the LiveKit room.

    Use this to:
    - Send initial greeting
    - Set up state
    - Start background tasks
    """
    pass
```

### on_disconnect

```python
async def on_disconnect(self):
    """Called when the agent disconnects from the room.

    Use this to:
    - Clean up resources
    - Save state
    - Log final metrics
    """
    pass
```

### on_participant_joined

```python
async def on_participant_joined(self, participant: Participant):
    """Called when a new participant joins the room.

    Args:
        participant: The participant that joined
    """
    pass
```

### on_participant_left

```python
async def on_participant_left(self, participant: Participant):
    """Called when a participant leaves the room.

    Args:
        participant: The participant that left
    """
    pass
```

## Audio Methods

### on_transcript

```python
async def on_transcript(self, text: str, is_final: bool):
    """Called when speech is transcribed.

    Args:
        text: The transcribed text
        is_final: Whether this is a final or interim transcript
    """
    pass
```

### on_audio_frame

```python
async def on_audio_frame(self, frame: AudioFrame):
    """Called for each incoming audio frame.

    Args:
        frame: The audio frame data

    Note: This is called frequently. For most use cases,
    use on_transcript instead.
    """
    pass
```

### publish_audio

```python
async def publish_audio(self, audio: bytes | AudioStream):
    """Publish audio to the room.

    Args:
        audio: Audio data as bytes or a streaming source
    """
```

## Data Channel Methods

### on_data_message

```python
async def on_data_message(self, message: dict):
    """Called when a data message is received.

    Args:
        message: The parsed JSON message

    Common message types:
    - user_text: Text input from user
    - control: Control messages (pause, resume, etc.)
    """
    pass
```

### send

```python
async def send(self, message: Message):
    """Send a message through the data channel.

    Args:
        message: A Message object to send
    """
```

## Utility Methods

### send_status

```python
async def send_status(self, status: str, message: str = None):
    """Send a status update.

    Args:
        status: Status string ('listening', 'thinking', 'speaking', etc.)
        message: Optional status message
    """
```

### send_transcript

```python
async def send_transcript(self, text: str, speaker: str = "assistant", is_final: bool = True):
    """Send a transcript message.

    Args:
        text: The transcript text
        speaker: Who is speaking ('user' or 'assistant')
        is_final: Whether this is a final transcript
    """
```

### update_todo

```python
async def update_todo(self, items: list[TodoItem]):
    """Update the todo list.

    Args:
        items: List of TodoItem objects
    """
```

## Properties

### room_name

```python
@property
def room_name(self) -> str:
    """The name of the LiveKit room."""
```

### participant_identity

```python
@property
def participant_identity(self) -> str:
    """The agent's identity in the room."""
```

### participants

```python
@property
def participants(self) -> list[Participant]:
    """List of participants in the room."""
```

### is_connected

```python
@property
def is_connected(self) -> bool:
    """Whether the agent is connected to a room."""
```

## Configuration

The `AgentConfig` class configures agent behavior:

```python
from stella_sdk import AgentConfig

config = AgentConfig(
    # LiveKit settings
    livekit_url="wss://your-livekit-server.com",
    api_key="your-api-key",
    api_secret="your-api-secret",

    # Room settings
    room_name="my-room",
    participant_identity="my-agent",

    # Audio settings
    sample_rate=16000,
    channels=1,

    # Behavior settings
    auto_subscribe=True,
    publish_audio=True,
    publish_data=True,
)

agent = MyAgent(config)
```

## Complete Example

```python
from stella_sdk import BaseAgent, AgentConfig, AudioPipeline

class ConversationalAgent(BaseAgent):
    def __init__(self):
        super().__init__()
        self.pipeline = AudioPipeline()
        self.history = []

    async def on_connect(self):
        await self.send_status("ready")
        await self.greet()

    async def on_disconnect(self):
        print(f"Session ended. {len(self.history)} turns.")

    async def on_participant_joined(self, participant):
        print(f"Welcome {participant.identity}!")

    async def on_transcript(self, text: str, is_final: bool):
        if not is_final:
            return

        self.history.append({"role": "user", "content": text})

        await self.send_status("thinking")
        response = await self.generate_response()
        await self.send_status("speaking")

        await self.send_transcript(response, speaker="assistant")
        audio = await self.pipeline.text_to_speech(response)
        await self.publish_audio(audio)

        self.history.append({"role": "assistant", "content": response})
        await self.send_status("listening")

    async def greet(self):
        greeting = "Hello! How can I help you today?"
        await self.send_transcript(greeting, speaker="assistant")
        audio = await self.pipeline.text_to_speech(greeting)
        await self.publish_audio(audio)

    async def generate_response(self) -> str:
        # Your LLM logic here
        pass


if __name__ == "__main__":
    agent = ConversationalAgent()
    agent.run()
```

## See Also

- [Message Types](/docs/agent-sdk/message-types)
- [Audio Pipeline](/docs/agent-sdk/audio-pipeline)
- [Building Custom Agents](/docs/agent-sdk/building-custom-agent)
