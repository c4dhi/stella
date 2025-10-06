# LLM Service - Unified Language Model Interface

## Overview

The LLM Service provides a unified interface for all language model interactions in the conversational AI system. It abstracts away provider-specific implementations and provides consistent streaming, error handling, and usage tracking across the entire system.

## Key Benefits

✅ **Provider Flexibility**: Switch between OpenAI, Anthropic, or local models with configuration changes
✅ **Centralized Configuration**: All LLM settings managed in one place
✅ **Consistent Streaming**: Unified streaming interface across all providers
✅ **Automatic Retries**: Built-in retry logic with exponential backoff
✅ **Usage Tracking**: Monitor tokens, costs, and performance across components
✅ **Easy Testing**: Mock provider for reliable unit tests
✅ **Error Handling**: Graceful degradation when providers are unavailable

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    LLM Service                          │
├─────────────────┬─────────────────┬─────────────────────┤
│   Input Gate    │   Expert Pool   │     Aggregator      │
│                 │                 │                     │
│ ┌─────────────┐ │ ┌─────────────┐ │ ┌─────────────────┐ │
│ │ Routing     │ │ │ Medical     │ │ │ Response        │ │
│ │ Decisions   │ │ │ Legal       │ │ │ Synthesis       │ │
│ │ Safety      │ │ │ Ethics      │ │ │ Streaming       │ │
│ └─────────────┘ │ │ Financial   │ │ └─────────────────┘ │
│                 │ └─────────────┘ │                     │
└─────────────────┴─────────────────┴─────────────────────┘
                           │
                ┌─────────────────────────────────┐
                │        Provider Layer           │
                ├─────────────────┬───────────────┤
                │ OpenAI          │ Mock/Test     │
                │ (LangChain)     │ Provider      │
                └─────────────────┴───────────────┘
```

## Quick Start

### 1. Configuration

Create or modify `llm_config.json`:

```json
{
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "max_tokens": 800,
  "provider": "openai_langchain",
  "streaming": true,
  "timeout": 30.0,
  "retry_attempts": 3,
  "retry_delay": 1.0
}
```

### 2. Basic Usage

```python
from message_processing.llm_service import LLMService, LLMMessage

# Initialize service
llm_service = LLMService(config_path="llm_config.json")

# Simple request
messages = [LLMMessage(role="user", content="Hello, world!")]
response = await llm_service.generate(
    messages=messages,
    component_name="my_component"
)
print(response.content)
```

### 3. Streaming Usage

```python
from message_processing.llm_service import LLMStreamingCallback

class MyCallback(LLMStreamingCallback):
    async def on_token(self, token: str, accumulated_text: str):
        print(token, end='', flush=True)

    async def on_complete(self, final_response):
        print(f"\nDone! Used {final_response.usage_tokens} tokens")

    async def on_error(self, error):
        print(f"Error: {error}")

# Stream response
callback = MyCallback()
response = await llm_service.generate(
    messages=messages,
    callback=callback,
    component_name="streaming_test"
)
```

## Configuration Options

### Core Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `model` | string | `"gpt-4o-mini"` | LLM model to use |
| `temperature` | float | `0.7` | Creativity level (0.0-2.0) |
| `max_tokens` | int | `800` | Maximum response length |
| `provider` | string | `"openai_langchain"` | LLM provider to use |
| `streaming` | bool | `true` | Enable streaming responses |
| `timeout` | float | `30.0` | Request timeout in seconds |
| `retry_attempts` | int | `3` | Number of retry attempts |
| `retry_delay` | float | `1.0` | Delay between retries |

### Supported Providers

- **`openai_langchain`**: OpenAI models via LangChain (recommended)
- **`openai_direct`**: Direct OpenAI API calls (future)
- **`anthropic`**: Anthropic Claude models (future)
- **`local`**: Mock provider for testing

## Component Integration

### Input Gate

The input gate uses the LLM service for routing decisions:

```python
# Automatic integration - no code changes needed
input_gate = InputGate(stream_service, tts_service, llm_service)
result = await input_gate.process_streaming(user_input, context)
```

### Expert Pool

Expert agents automatically use the shared LLM service:

```python
# Experts inherit LLM configuration
expert_pool = ExpertPool(stream_service, llm_service=llm_service)
results = await expert_pool.run_parallel(agent_names, user_input, context)
```

### Aggregator

Response synthesis uses streaming LLM service:

```python
# Streaming synthesis with TTS integration
aggregator = Aggregator(stream_service, tts_service, llm_service)
result = await aggregator.synthesize_streaming(user_input, expert_findings)
```

## Usage Monitoring

### Real-time Statistics

```python
stats = llm_service.get_usage_stats()
print(f"Total requests: {stats['total_requests']}")
print(f"Success rate: {stats['success_rate']:.1f}%")
print(f"Average response time: {stats['avg_response_time']:.2f}s")
print(f"Total tokens used: {stats['total_tokens']}")
```

### Per-Provider Metrics

```python
for provider, metrics in stats['providers'].items():
    print(f"{provider}: {metrics['requests']} requests, {metrics['tokens']} tokens")
```

## Error Handling & Fallbacks

The LLM service provides robust error handling:

1. **Provider Unavailable**: Automatically fallback to available providers
2. **Rate Limiting**: Built-in retry with exponential backoff
3. **Network Issues**: Configurable timeouts and retries
4. **API Errors**: Graceful error propagation with context

```python
try:
    response = await llm_service.generate(messages)
except Exception as e:
    # Service handles retries automatically
    # Only unrecoverable errors are raised
    print(f"LLM request failed: {e}")
```

## Testing

### Mock Provider

For testing, use the built-in mock provider:

```python
from message_processing.llm_service import LLMService, LLMProvider, LLMConfig

# Configure for testing
config = LLMConfig(provider=LLMProvider.LOCAL)  # Uses mock provider
llm_service = LLMService()

# Mock responses are predictable
response = await llm_service.generate(messages, config=config)
assert "mock response" in response.content.lower()
```

### Test Script

Run the included test script:

```bash
cd conversational-ai-server-python
python test_llm_service.py
```

## Provider Migration

### Switching Providers

To switch from OpenAI to a future provider, just update the config:

```json
{
  "provider": "anthropic",
  "model": "claude-3-sonnet",
  "temperature": 0.5
}
```

No code changes required! ✨

### Adding New Providers

To add a new LLM provider:

1. Create a class implementing `LLMProvider_Interface`
2. Add it to the `LLMService._initialize_providers()` method
3. Update the `LLMProvider` enum

Example:

```python
class AnthropicProvider(LLMProvider_Interface):
    def get_provider_name(self) -> str:
        return "anthropic"

    async def generate(self, messages, config, callback=None):
        # Implementation here
        pass
```

## Performance Optimization

### Connection Pooling

The service automatically manages connections and can be extended with:

- Connection pooling for high-throughput scenarios
- Request batching for multiple simultaneous requests
- Response caching for repeated queries

### Token Optimization

Monitor token usage to optimize costs:

```python
# Per-component token usage
stats = llm_service.get_usage_stats()
for provider, data in stats['providers'].items():
    cost_per_token = 0.00001  # Example rate
    estimated_cost = data['tokens'] * cost_per_token
    print(f"{provider}: ~${estimated_cost:.4f}")
```

## Migration from Legacy Code

The refactoring is **backwards compatible**. All existing functionality works unchanged, but now benefits from:

- Unified configuration
- Better error handling
- Usage tracking
- Provider flexibility
- Easier testing

### Before (scattered OpenAI calls):
```python
# input_gate.py
self.llm = ChatOpenAI(model_name="gpt-4o-mini", temperature=0.3)

# expert_pool.py
llm = ChatOpenAI(model_name="gpt-4o-mini", temperature=0.3)

# aggregator.py
self.llm = ChatOpenAI(model_name="gpt-4o-mini", temperature=0.7)
```

### After (unified service):
```python
# All components share one LLM service
llm_service = LLMService(config_path="llm_config.json")
input_gate = InputGate(stream_service, tts_service, llm_service)
expert_pool = ExpertPool(stream_service, llm_service=llm_service)
aggregator = Aggregator(stream_service, tts_service, llm_service)
```

## Troubleshooting

### Common Issues

**"No LLM providers available"**
- Check OpenAI API key is set: `export OPENAI_API_KEY=your_key`
- Verify LangChain installation: `pip install langchain langchain-openai`

**High response times**
- Check network connectivity
- Consider increasing timeout in config
- Monitor token usage (longer responses = slower)

**Rate limiting errors**
- Reduce concurrent requests
- Increase retry_delay in config
- Check OpenAI account limits

### Debug Mode

Enable verbose logging:

```python
import logging
logging.getLogger("message_processing.llm_service").setLevel(logging.DEBUG)
```

## Future Enhancements

- 🔄 Response caching
- 📊 Advanced analytics dashboard
- 🔌 Plugin system for custom providers
- ⚡ Request batching and connection pooling
- 💰 Cost optimization recommendations
- 🛡️ Rate limiting and quota management