# Voice Narration Control Feature

## Overview

The conversational AI server now supports optional voice narration control for user text messages. Clients can specify whether they want the AI's response to be narrated through text-to-speech (TTS) or delivered silently as text only.

## Key Features

- **Optional Control**: Each user message can optionally specify voice narration preference
- **Backwards Compatibility**: Legacy message format continues to work with voice narration enabled by default
- **End-to-End Integration**: Voice preference flows through the entire pipeline (InputGate → Aggregator)
- **Real-Time Control**: Can be toggled on a per-message basis

## Message Formats

### Enhanced Format (Recommended)

Send user text messages with the enhanced object format:

```json
{
  "type": "user_text",
  "data": {
    "text": "Your message text here",
    "enable_voice_narration": true
  }
}
```

**Fields:**
- `text` (string, required): The user's message text
- `enable_voice_narration` (boolean, optional): Whether to enable voice narration
  - `true`: AI response will be narrated via TTS (default)
  - `false`: AI response will be text-only, no voice narration

### Legacy Format (Still Supported)

The original simple string format continues to work:

```json
{
  "type": "user_text",
  "data": "Your message text here"
}
```

**Behavior:** Defaults to `enable_voice_narration: true` for backwards compatibility.

## Frontend Implementation Examples

### JavaScript/TypeScript

```javascript
// Send message with voice narration enabled
function sendMessageWithVoice(text) {
  const message = {
    type: "user_text",
    data: {
      text: text,
      enable_voice_narration: true
    }
  };
  sendToLiveKit(message);
}

// Send message without voice narration (text-only)
function sendMessageTextOnly(text) {
  const message = {
    type: "user_text",
    data: {
      text: text,
      enable_voice_narration: false
    }
  };
  sendToLiveKit(message);
}

// Dynamic control based on user preference
function sendMessage(text, userWantsVoice) {
  const message = {
    type: "user_text",
    data: {
      text: text,
      enable_voice_narration: userWantsVoice
    }
  };
  sendToLiveKit(message);
}

// UI Toggle Example
class ChatInterface {
  constructor() {
    this.voiceEnabled = true; // Default state
  }

  toggleVoiceNarration() {
    this.voiceEnabled = !this.voiceEnabled;
    this.updateVoiceButton();
  }

  sendUserMessage(text) {
    const message = {
      type: "user_text",
      data: {
        text: text,
        enable_voice_narration: this.voiceEnabled
      }
    };
    this.sendToLiveKit(message);
  }
}
```

### React Component Example

```jsx
import { useState, useCallback } from 'react';

function ChatInterface({ liveKitRoom }) {
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [message, setMessage] = useState('');

  const sendMessage = useCallback(() => {
    if (!message.trim()) return;

    const messageData = {
      type: "user_text",
      data: {
        text: message,
        enable_voice_narration: voiceEnabled
      }
    };

    // Send via LiveKit data channel
    const messageBytes = new TextEncoder().encode(JSON.stringify(messageData));
    liveKitRoom.localParticipant.publishData(messageBytes, { reliable: true });

    setMessage('');
  }, [message, voiceEnabled, liveKitRoom]);

  return (
    <div className="chat-interface">
      {/* Voice control toggle */}
      <div className="voice-controls">
        <label>
          <input
            type="checkbox"
            checked={voiceEnabled}
            onChange={(e) => setVoiceEnabled(e.target.checked)}
          />
          Enable voice narration
        </label>
      </div>

      {/* Message input */}
      <div className="message-input">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type your message..."
        />
        <button onClick={sendMessage}>
          Send {voiceEnabled ? '🔊' : '🔇'}
        </button>
      </div>
    </div>
  );
}
```

## Use Cases

### 1. User Preference Settings
Allow users to set a default voice preference in their profile:

```javascript
class UserSettings {
  constructor() {
    this.defaultVoiceEnabled = localStorage.getItem('voiceEnabled') !== 'false';
  }

  sendMessage(text) {
    return {
      type: "user_text",
      data: {
        text: text,
        enable_voice_narration: this.defaultVoiceEnabled
      }
    };
  }
}
```

### 2. Context-Aware Voice Control
Disable voice in specific contexts (e.g., quiet environments):

```javascript
class ContextAwareChat {
  constructor() {
    this.isInQuietMode = false;
    this.userVoicePreference = true;
  }

  sendMessage(text) {
    const shouldUseVoice = this.userVoicePreference && !this.isInQuietMode;

    return {
      type: "user_text",
      data: {
        text: text,
        enable_voice_narration: shouldUseVoice
      }
    };
  }

  enableQuietMode() {
    this.isInQuietMode = true;
  }
}
```

### 3. Accessibility Features
Provide voice control for accessibility needs:

```javascript
class AccessibleChat {
  constructor() {
    this.userNeedsVoice = this.detectVoiceNeeds();
  }

  detectVoiceNeeds() {
    // Check for screen reader or other accessibility indicators
    return window.navigator.userAgent.includes('NVDA') ||
           window.speechSynthesis.speaking ||
           localStorage.getItem('accessibilityVoice') === 'true';
  }

  sendMessage(text) {
    return {
      type: "user_text",
      data: {
        text: text,
        enable_voice_narration: this.userNeedsVoice
      }
    };
  }
}
```

## Server-Side Behavior

When voice narration is disabled:

1. **InputGate**: Streaming callback receives `null` instead of TTS service
2. **Aggregator**: Streaming callback receives `null` instead of TTS service
3. **TTS Processing**: No text chunks are sent to TTS service
4. **Audio Output**: No audio generated or played
5. **Text Delivery**: Response still delivered as text via transcript chunks

When voice narration is enabled (default):
1. **Normal Operation**: Full TTS processing occurs
2. **Audio Generation**: Text-to-speech generates audio
3. **Audio Playback**: Audio is streamed to client

## Migration Guide

### From Legacy Format
If you're currently sending messages like this:

```javascript
// Old way
const message = {
  type: "user_text",
  data: "Hello, can you help me?"
};
```

You can continue using this format (it defaults to voice enabled), or upgrade to:

```javascript
// New way with explicit control
const message = {
  type: "user_text",
  data: {
    text: "Hello, can you help me?",
    enable_voice_narration: true  // or false
  }
};
```

### Gradual Adoption
1. **Phase 1**: Add voice toggle UI but keep using legacy format
2. **Phase 2**: Start sending enhanced format with user's voice preference
3. **Phase 3**: Implement context-aware voice control

## Error Handling

The server gracefully handles various message formats:

```javascript
// All of these work:

// Enhanced format with voice control
{ type: "user_text", data: { text: "Hello", enable_voice_narration: false } }

// Enhanced format with default voice (true assumed)
{ type: "user_text", data: { text: "Hello" } }

// Legacy format (voice defaults to true)
{ type: "user_text", data: "Hello" }

// Invalid format falls back to text extraction
{ type: "user_text", data: { message: "Hello" } } // Extracts empty text
```

## Testing

You can test voice narration control by:

1. **Check Audio Output**: Monitor whether audio is generated
2. **Inspect Network**: Look for TTS-related requests
3. **Debug Logs**: Server logs show `(voice: true/false)` in message processing
4. **UI Feedback**: Provide visual indicators for voice state

```javascript
// Test helper
function testVoiceControl() {
  // Test with voice enabled
  sendMessage("Test with voice", true);

  // Test with voice disabled
  sendMessage("Test without voice", false);

  // Test legacy format
  sendLegacyMessage("Test legacy format");
}
```

## Best Practices

1. **Default to Voice Enabled**: Maintains backwards compatibility
2. **Persist User Preference**: Remember user's choice across sessions
3. **Visual Indicators**: Show current voice state in UI
4. **Context Awareness**: Auto-disable in appropriate contexts
5. **Accessibility**: Support voice control for accessibility needs

This feature provides fine-grained control over voice narration while maintaining full backwards compatibility with existing implementations.