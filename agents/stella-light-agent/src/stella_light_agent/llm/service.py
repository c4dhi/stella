"""
Unified LLM Service for handling all language model interactions.
Provides a consistent interface across different LLM providers with streaming support.
"""

import asyncio
import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Any, List, Optional, Union
from pathlib import Path
from datetime import datetime, timezone


class LLMProvider(Enum):
    """Supported LLM providers."""
    OPENAI_LANGCHAIN = "openai_langchain"
    OPENAI_DIRECT = "openai_direct"
    ANTHROPIC = "anthropic"
    OLLAMA = "ollama"
    MOCK = "mock"


@dataclass
class LLMToolCall:
    """Represents a tool call from the LLM."""
    id: str
    name: str
    arguments: Dict[str, Any]


@dataclass
class LLMConfig:
    """Configuration for LLM requests."""
    model: str = "gpt-4o-mini"
    temperature: float = 0.7
    max_tokens: int = 800
    provider: LLMProvider = LLMProvider.OPENAI_LANGCHAIN
    streaming: bool = True
    timeout: float = 30.0
    retry_attempts: int = 3
    retry_delay: float = 1.0
    base_url: Optional[str] = None
    context_length: int = 4096
    # Tool calling configuration
    tools: Optional[List[Dict[str, Any]]] = None  # OpenAI-format tool schemas
    tool_choice: str = "auto"  # "auto", "none", "required", or specific tool name


@dataclass
class LLMMessage:
    """Standard message format for LLM interactions."""
    role: str  # "system", "user", "assistant", "tool"
    content: str
    metadata: Optional[Dict[str, Any]] = None
    # For assistant messages with tool calls
    tool_calls: Optional[List[LLMToolCall]] = None
    # For tool result messages
    tool_call_id: Optional[str] = None


@dataclass
class LLMResponse:
    """Standard response format from LLM providers."""
    content: str
    model: str
    provider: str
    usage_tokens: int = 0
    cost_usd: float = 0.0
    response_time: float = 0.0
    metadata: Optional[Dict[str, Any]] = None
    # Tool calls made by the LLM
    tool_calls: Optional[List[LLMToolCall]] = None


class LLMStreamingCallback(ABC):
    """Abstract callback interface for streaming LLM responses."""

    @abstractmethod
    async def on_token(self, token: str, accumulated_text: str) -> None:
        """Called when a new token arrives."""
        pass

    @abstractmethod
    async def on_complete(self, final_response: LLMResponse) -> None:
        """Called when streaming is complete."""
        pass

    @abstractmethod
    async def on_error(self, error: Exception) -> None:
        """Called when an error occurs."""
        pass

    async def on_tool_call(self, tool_call: LLMToolCall) -> None:
        """Called when a tool call is made by the LLM.

        Default implementation does nothing. Override if you need to handle
        tool calls during streaming.
        """
        pass


class LLMProviderInterface(ABC):
    """Abstract interface for LLM providers."""

    @abstractmethod
    async def generate(
        self,
        messages: List[LLMMessage],
        config: LLMConfig,
        callback: Optional[LLMStreamingCallback] = None
    ) -> LLMResponse:
        """Generate a response from the LLM."""
        pass

    @abstractmethod
    async def generate_stream(
        self,
        messages: List[LLMMessage],
        config: LLMConfig,
        callback: LLMStreamingCallback
    ) -> LLMResponse:
        """Generate a streaming response from the LLM."""
        pass

    @abstractmethod
    def get_provider_name(self) -> str:
        """Get the provider name."""
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Check if the provider is available."""
        pass


class OpenAILangChainProvider(LLMProviderInterface):
    """OpenAI provider using LangChain."""

    def __init__(self):
        self.available = False
        self.ChatOpenAI = None
        self._initialize()

    def _initialize(self):
        """Initialize the LangChain OpenAI client."""
        try:
            from langchain_openai import ChatOpenAI
            self.ChatOpenAI = ChatOpenAI
            self.available = True
            print("[LLMService] OpenAI LangChain provider initialized")
        except ImportError as e:
            print(f"[LLMService] OpenAI LangChain provider not available: {e}")
            self.available = False

    def get_provider_name(self) -> str:
        return "openai_langchain"

    def is_available(self) -> bool:
        return self.available

    def _create_client(self, config: LLMConfig):
        """Create a LangChain ChatOpenAI client."""
        if not self.available:
            raise RuntimeError("OpenAI LangChain provider not available")

        return self.ChatOpenAI(
            model_name=config.model,
            temperature=config.temperature,
            max_tokens=config.max_tokens,
            streaming=config.streaming,
            request_timeout=config.timeout
        )

    def _convert_messages(self, messages: List[LLMMessage]) -> List[tuple]:
        """Convert LLMMessage to LangChain format."""
        return [(msg.role, msg.content) for msg in messages]

    async def generate(
        self,
        messages: List[LLMMessage],
        config: LLMConfig,
        callback: Optional[LLMStreamingCallback] = None
    ) -> LLMResponse:
        """Generate a non-streaming response."""
        start_time = time.time()

        try:
            client = self._create_client(config)
            langchain_messages = self._convert_messages(messages)

            client.streaming = False
            result = await client.ainvoke(langchain_messages)

            if hasattr(result, 'content'):
                content = result.content
            elif isinstance(result, dict):
                content = result.get('text', str(result))
            else:
                content = str(result)

            response_time = time.time() - start_time

            response = LLMResponse(
                content=content,
                model=config.model,
                provider=self.get_provider_name(),
                response_time=response_time,
                usage_tokens=int(len(content.split()) * 1.3),
                cost_usd=0.0
            )

            if callback:
                await callback.on_complete(response)

            return response

        except Exception as e:
            if callback:
                await callback.on_error(e)
            raise

    async def generate_stream(
        self,
        messages: List[LLMMessage],
        config: LLMConfig,
        callback: LLMStreamingCallback
    ) -> LLMResponse:
        """Generate a streaming response."""
        start_time = time.time()
        accumulated_content = ""

        try:
            client = self._create_client(config)
            langchain_messages = self._convert_messages(messages)

            client.streaming = True
            async for chunk in client.astream(langchain_messages):
                if hasattr(chunk, 'content') and chunk.content:
                    accumulated_content += chunk.content
                    await callback.on_token(chunk.content, accumulated_content)

            response_time = time.time() - start_time

            response = LLMResponse(
                content=accumulated_content,
                model=config.model,
                provider=self.get_provider_name(),
                response_time=response_time,
                usage_tokens=int(len(accumulated_content.split()) * 1.3),
                cost_usd=0.0
            )

            await callback.on_complete(response)
            return response

        except Exception as e:
            await callback.on_error(e)
            raise


class OllamaProvider(LLMProviderInterface):
    """Ollama provider for local LLMs."""

    def __init__(self):
        self.available = False
        self.requests = None
        self._initialize()

    def _initialize(self):
        """Initialize the Ollama client."""
        try:
            import requests
            self.requests = requests
            self.available = True
            print("[LLMService] Ollama provider initialized")
        except ImportError:
            print("[LLMService] Ollama provider requires 'requests' package")
            self.available = False

    def get_provider_name(self) -> str:
        return "ollama"

    def is_available(self) -> bool:
        return self.available

    async def generate(
        self,
        messages: List[LLMMessage],
        config: LLMConfig,
        callback: Optional[LLMStreamingCallback] = None
    ) -> LLMResponse:
        """Generate a non-streaming response using Ollama."""
        if not self.available:
            raise RuntimeError("Ollama provider not available")

        start_time = time.time()
        base_url = config.base_url or "http://localhost:11434"

        prompt = self._build_prompt(messages)

        payload = {
            "model": config.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": config.temperature,
                "num_predict": config.max_tokens,
                "num_ctx": config.context_length
            }
        }

        try:
            response = self.requests.post(
                f"{base_url}/api/generate",
                json=payload,
                timeout=config.timeout
            )
            response.raise_for_status()
            result = response.json()

            content = result.get("response", "")
            response_time = time.time() - start_time

            llm_response = LLMResponse(
                content=content,
                model=config.model,
                provider=self.get_provider_name(),
                response_time=response_time,
                usage_tokens=int(len(content.split()) * 1.3),
                cost_usd=0.0
            )

            if callback:
                await callback.on_complete(llm_response)

            return llm_response

        except Exception as e:
            if callback:
                await callback.on_error(e)
            raise

    async def generate_stream(
        self,
        messages: List[LLMMessage],
        config: LLMConfig,
        callback: LLMStreamingCallback
    ) -> LLMResponse:
        """Generate a streaming response using Ollama."""
        if not self.available:
            raise RuntimeError("Ollama provider not available")

        start_time = time.time()
        base_url = config.base_url or "http://localhost:11434"
        accumulated_content = ""

        prompt = self._build_prompt(messages)

        payload = {
            "model": config.model,
            "prompt": prompt,
            "stream": True,
            "options": {
                "temperature": config.temperature,
                "num_predict": config.max_tokens,
                "num_ctx": config.context_length
            }
        }

        try:
            response = self.requests.post(
                f"{base_url}/api/generate",
                json=payload,
                stream=True,
                timeout=config.timeout
            )
            response.raise_for_status()

            for line in response.iter_lines():
                if line:
                    try:
                        chunk_data = json.loads(line.decode('utf-8'))
                        if "response" in chunk_data:
                            token = chunk_data["response"]
                            accumulated_content += token
                            await callback.on_token(token, accumulated_content)

                        if chunk_data.get("done", False):
                            break
                    except json.JSONDecodeError:
                        continue

            response_time = time.time() - start_time

            llm_response = LLMResponse(
                content=accumulated_content,
                model=config.model,
                provider=self.get_provider_name(),
                response_time=response_time,
                usage_tokens=int(len(accumulated_content.split()) * 1.3),
                cost_usd=0.0
            )

            await callback.on_complete(llm_response)
            return llm_response

        except Exception as e:
            await callback.on_error(e)
            raise

    def _build_prompt(self, messages: List[LLMMessage]) -> str:
        """Convert messages to a single prompt string."""
        prompt_parts = []
        for msg in messages:
            if msg.role == "system":
                prompt_parts.append(f"System: {msg.content}")
            elif msg.role == "user":
                prompt_parts.append(f"User: {msg.content}")
            elif msg.role == "assistant":
                prompt_parts.append(f"Assistant: {msg.content}")
        prompt_parts.append("Assistant:")
        return "\n\n".join(prompt_parts)


class OpenAIDirectProvider(LLMProviderInterface):
    """Direct OpenAI provider with full tool calling support."""

    def __init__(self):
        self.available = False
        self.openai = None
        self._initialize()

    def _initialize(self):
        """Initialize the OpenAI client."""
        try:
            import openai
            self.openai = openai
            self.client = openai.AsyncOpenAI()
            self.available = True
            print("[LLMService] OpenAI Direct provider initialized")
        except ImportError as e:
            print(f"[LLMService] OpenAI Direct provider not available: {e}")
            self.available = False

    def get_provider_name(self) -> str:
        return "openai_direct"

    def is_available(self) -> bool:
        return self.available

    def _convert_messages(self, messages: List[LLMMessage]) -> List[Dict[str, Any]]:
        """Convert LLMMessage to OpenAI API format."""
        result = []
        for msg in messages:
            message_dict: Dict[str, Any] = {
                "role": msg.role,
                "content": msg.content or ""
            }
            # Handle tool call results
            if msg.role == "tool" and msg.tool_call_id:
                message_dict["tool_call_id"] = msg.tool_call_id
            # Handle assistant messages with tool calls
            if msg.tool_calls:
                message_dict["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": json.dumps(tc.arguments)
                        }
                    }
                    for tc in msg.tool_calls
                ]
            result.append(message_dict)
        return result

    def _parse_tool_calls(self, openai_tool_calls) -> List[LLMToolCall]:
        """Parse OpenAI tool calls into LLMToolCall objects."""
        if not openai_tool_calls:
            return []

        result = []
        for tc in openai_tool_calls:
            try:
                arguments = json.loads(tc.function.arguments)
            except json.JSONDecodeError:
                arguments = {}

            result.append(LLMToolCall(
                id=tc.id,
                name=tc.function.name,
                arguments=arguments
            ))
        return result

    async def generate(
        self,
        messages: List[LLMMessage],
        config: LLMConfig,
        callback: Optional[LLMStreamingCallback] = None
    ) -> LLMResponse:
        """Generate a non-streaming response with tool support."""
        if not self.available:
            raise RuntimeError("OpenAI Direct provider not available")

        start_time = time.time()

        try:
            openai_messages = self._convert_messages(messages)

            # Build request kwargs
            kwargs = {
                "model": config.model,
                "messages": openai_messages,
                "temperature": config.temperature,
                "max_tokens": config.max_tokens,
            }

            # Add tools if provided
            if config.tools:
                kwargs["tools"] = config.tools
                if config.tool_choice != "auto":
                    kwargs["tool_choice"] = config.tool_choice

            result = await self.client.chat.completions.create(**kwargs)

            choice = result.choices[0]
            content = choice.message.content or ""
            tool_calls = self._parse_tool_calls(choice.message.tool_calls)

            response_time = time.time() - start_time

            response = LLMResponse(
                content=content,
                model=config.model,
                provider=self.get_provider_name(),
                response_time=response_time,
                usage_tokens=result.usage.total_tokens if result.usage else 0,
                cost_usd=0.0,
                tool_calls=tool_calls if tool_calls else None
            )

            if callback:
                # Notify about tool calls
                for tc in tool_calls:
                    await callback.on_tool_call(tc)
                await callback.on_complete(response)

            return response

        except Exception as e:
            if callback:
                await callback.on_error(e)
            raise

    async def generate_stream(
        self,
        messages: List[LLMMessage],
        config: LLMConfig,
        callback: LLMStreamingCallback
    ) -> LLMResponse:
        """Generate a streaming response with tool support."""
        if not self.available:
            raise RuntimeError("OpenAI Direct provider not available")

        start_time = time.time()
        accumulated_content = ""
        tool_calls_builder: Dict[int, Dict[str, Any]] = {}

        try:
            openai_messages = self._convert_messages(messages)

            # Build request kwargs
            kwargs = {
                "model": config.model,
                "messages": openai_messages,
                "temperature": config.temperature,
                "max_tokens": config.max_tokens,
                "stream": True,
            }

            # Add tools if provided
            if config.tools:
                kwargs["tools"] = config.tools
                if config.tool_choice != "auto":
                    kwargs["tool_choice"] = config.tool_choice

            stream = await self.client.chat.completions.create(**kwargs)

            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None

                if delta:
                    # Handle content tokens
                    if delta.content:
                        accumulated_content += delta.content
                        await callback.on_token(delta.content, accumulated_content)

                    # Handle tool call deltas
                    if delta.tool_calls:
                        for tc_delta in delta.tool_calls:
                            idx = tc_delta.index
                            if idx not in tool_calls_builder:
                                tool_calls_builder[idx] = {
                                    "id": "",
                                    "name": "",
                                    "arguments": ""
                                }

                            if tc_delta.id:
                                tool_calls_builder[idx]["id"] = tc_delta.id
                            if tc_delta.function:
                                if tc_delta.function.name:
                                    tool_calls_builder[idx]["name"] = tc_delta.function.name
                                if tc_delta.function.arguments:
                                    tool_calls_builder[idx]["arguments"] += tc_delta.function.arguments

            # Build final tool calls list
            tool_calls = []
            for idx in sorted(tool_calls_builder.keys()):
                tc_data = tool_calls_builder[idx]
                try:
                    arguments = json.loads(tc_data["arguments"]) if tc_data["arguments"] else {}
                except json.JSONDecodeError:
                    arguments = {}

                tc = LLMToolCall(
                    id=tc_data["id"],
                    name=tc_data["name"],
                    arguments=arguments
                )
                tool_calls.append(tc)
                await callback.on_tool_call(tc)

            response_time = time.time() - start_time

            response = LLMResponse(
                content=accumulated_content,
                model=config.model,
                provider=self.get_provider_name(),
                response_time=response_time,
                usage_tokens=int(len(accumulated_content.split()) * 1.3),
                cost_usd=0.0,
                tool_calls=tool_calls if tool_calls else None
            )

            # Debug: Print response details
            print(f"[OpenAIDirectProvider] Response content: '{accumulated_content[:200]}...' ({len(accumulated_content)} chars)" if accumulated_content else "[OpenAIDirectProvider] Response content: EMPTY")
            print(f"[OpenAIDirectProvider] Tool calls: {len(tool_calls)} - {[tc.name for tc in tool_calls]}" if tool_calls else "[OpenAIDirectProvider] Tool calls: NONE")

            await callback.on_complete(response)
            return response

        except Exception as e:
            await callback.on_error(e)
            raise


class MockLLMProvider(LLMProviderInterface):
    """Mock provider for testing."""

    def __init__(self, mock_responses: List[str] = None):
        self.mock_responses = mock_responses or ["This is a mock response."]
        self.response_index = 0

    def get_provider_name(self) -> str:
        return "mock"

    def is_available(self) -> bool:
        return True

    async def generate(
        self,
        messages: List[LLMMessage],
        config: LLMConfig,
        callback: Optional[LLMStreamingCallback] = None
    ) -> LLMResponse:
        """Generate a mock response."""
        await asyncio.sleep(0.1)

        content = self.mock_responses[self.response_index % len(self.mock_responses)]
        self.response_index += 1

        response = LLMResponse(
            content=content,
            model="mock-model",
            provider="mock",
            response_time=0.1,
            usage_tokens=len(content.split()),
            cost_usd=0.0
        )

        if callback:
            await callback.on_complete(response)

        return response

    async def generate_stream(
        self,
        messages: List[LLMMessage],
        config: LLMConfig,
        callback: LLMStreamingCallback
    ) -> LLMResponse:
        """Generate a mock streaming response."""
        content = self.mock_responses[self.response_index % len(self.mock_responses)]
        self.response_index += 1

        accumulated = ""
        for word in content.split():
            accumulated += word + " "
            await callback.on_token(word + " ", accumulated)
            await asyncio.sleep(0.05)

        response = LLMResponse(
            content=content,
            model="mock-model",
            provider="mock",
            response_time=0.1,
            usage_tokens=len(content.split()),
            cost_usd=0.0
        )

        await callback.on_complete(response)
        return response


@dataclass
class LLMUsageStats:
    """Track LLM usage statistics."""
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    total_tokens_used: int = 0
    total_cost_usd: float = 0.0
    avg_response_time: float = 0.0
    provider_stats: Dict[str, Dict[str, Any]] = field(default_factory=dict)


class LLMService:
    """Main LLM service that manages providers and handles requests."""

    def __init__(self, config_path: Optional[str] = None):
        self.providers: Dict[LLMProvider, LLMProviderInterface] = {}
        self.default_config = LLMConfig()
        self.usage_stats = LLMUsageStats()
        self.config_path = config_path

        self._initialize_providers()
        self._load_config()

    def _initialize_providers(self):
        """Initialize all available providers."""
        openai_langchain_provider = OpenAILangChainProvider()
        if openai_langchain_provider.is_available():
            self.providers[LLMProvider.OPENAI_LANGCHAIN] = openai_langchain_provider

        openai_direct_provider = OpenAIDirectProvider()
        if openai_direct_provider.is_available():
            self.providers[LLMProvider.OPENAI_DIRECT] = openai_direct_provider

        ollama_provider = OllamaProvider()
        if ollama_provider.is_available():
            self.providers[LLMProvider.OLLAMA] = ollama_provider

        self.providers[LLMProvider.MOCK] = MockLLMProvider()

        print(f"[LLMService] Initialized {len(self.providers)} providers: {list(self.providers.keys())}")

    def _load_config(self):
        """Load configuration from file if available."""
        if self.config_path and Path(self.config_path).exists():
            try:
                with open(self.config_path) as f:
                    config_data = json.load(f)
                    for key, value in config_data.items():
                        if hasattr(self.default_config, key):
                            if key == "provider" and isinstance(value, str):
                                try:
                                    value = LLMProvider(value)
                                except ValueError:
                                    print(f"[LLMService] Unknown provider '{value}', using default")
                                    continue
                            setattr(self.default_config, key, value)
                print(f"[LLMService] Loaded config from {self.config_path}")

                provider_name = getattr(self.default_config.provider, 'value', str(self.default_config.provider))
                print(f"[LLMService] Provider: {provider_name}, Model: {self.default_config.model}")
            except Exception as e:
                print(f"[LLMService] Failed to load config: {e}")

    def get_available_providers(self) -> List[str]:
        """Get list of available provider names."""
        return [provider.get_provider_name() for provider in self.providers.values()]

    def get_provider(self, provider_type: LLMProvider) -> Optional[LLMProviderInterface]:
        """Get a specific provider."""
        return self.providers.get(provider_type)

    async def generate(
        self,
        messages: Union[List[LLMMessage], List[tuple], str],
        config: Optional[LLMConfig] = None,
        callback: Optional[LLMStreamingCallback] = None,
        component_name: str = "unknown"
    ) -> LLMResponse:
        """Generate a response using the configured provider."""

        if config is None:
            config = self.default_config

        if isinstance(messages, str):
            messages = [LLMMessage(role="user", content=messages)]
        elif isinstance(messages, list) and messages and isinstance(messages[0], tuple):
            messages = [LLMMessage(role=role, content=content) for role, content in messages]

        provider = self.providers.get(config.provider)
        if not provider:
            if self.providers:
                provider = list(self.providers.values())[0]
                print(f"[LLMService] Provider {config.provider} not available, using {provider.get_provider_name()}")
            else:
                raise RuntimeError("No LLM providers available")

        self.usage_stats.total_requests += 1

        try:
            if config.streaming and callback:
                response = await provider.generate_stream(messages, config, callback)
            else:
                response = await provider.generate(messages, config, callback)

            self.usage_stats.successful_requests += 1
            self.usage_stats.total_tokens_used += response.usage_tokens
            self.usage_stats.total_cost_usd += response.cost_usd

            total_time = self.usage_stats.avg_response_time * (self.usage_stats.successful_requests - 1) + response.response_time
            self.usage_stats.avg_response_time = total_time / self.usage_stats.successful_requests

            provider_name = provider.get_provider_name()
            if provider_name not in self.usage_stats.provider_stats:
                self.usage_stats.provider_stats[provider_name] = {
                    "requests": 0, "tokens": 0, "cost": 0.0, "avg_time": 0.0
                }

            stats = self.usage_stats.provider_stats[provider_name]
            stats["requests"] += 1
            stats["tokens"] += response.usage_tokens
            stats["cost"] += response.cost_usd
            stats["avg_time"] = (stats["avg_time"] * (stats["requests"] - 1) + response.response_time) / stats["requests"]

            print(f"[LLMService] {component_name}: {provider_name} response in {response.response_time:.2f}s")

            return response

        except Exception as e:
            self.usage_stats.failed_requests += 1
            print(f"[LLMService] {component_name}: Request failed: {e}")
            raise

    def get_usage_stats(self) -> Dict[str, Any]:
        """Get current usage statistics."""
        return {
            "total_requests": self.usage_stats.total_requests,
            "successful_requests": self.usage_stats.successful_requests,
            "failed_requests": self.usage_stats.failed_requests,
            "success_rate": (self.usage_stats.successful_requests / max(1, self.usage_stats.total_requests)) * 100,
            "total_tokens": self.usage_stats.total_tokens_used,
            "total_cost_usd": self.usage_stats.total_cost_usd,
            "avg_response_time": self.usage_stats.avg_response_time,
            "providers": self.usage_stats.provider_stats
        }

    def reset_stats(self):
        """Reset usage statistics."""
        self.usage_stats = LLMUsageStats()
