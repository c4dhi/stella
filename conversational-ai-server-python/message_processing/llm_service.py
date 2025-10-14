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
from typing import Dict, Any, List, Optional, AsyncGenerator, Callable, Union
from pathlib import Path
from datetime import datetime, timezone


class LLMProvider(Enum):
    """Supported LLM providers."""
    OPENAI_LANGCHAIN = "openai_langchain"
    OPENAI_DIRECT = "openai_direct"
    ANTHROPIC = "anthropic"
    OLLAMA = "ollama"
    LLAMACPP = "llamacpp"
    HUGGINGFACE = "huggingface"
    MOCK = "mock"


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
    # Local model specific settings
    base_url: Optional[str] = None  # For Ollama, llama.cpp server
    model_path: Optional[str] = None  # For direct model loading
    device: str = "auto"  # "cpu", "cuda", "mps", "auto"
    context_length: int = 4096  # Context window size
    gpu_layers: int = 0  # Number of layers to run on GPU


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


@dataclass
class LLMMessage:
    """Standard message format for LLM interactions."""
    role: str  # "system", "user", "assistant"
    content: str
    metadata: Optional[Dict[str, Any]] = None


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


class LLMProvider_Interface(ABC):
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


class OpenAILangChainProvider(LLMProvider_Interface):
    """OpenAI provider using LangChain."""

    def __init__(self):
        self.available = False
        self.client = None
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

            # Use non-streaming mode
            client.streaming = False
            result = await client.ainvoke(langchain_messages)

            # Extract content from LangChain response
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
                usage_tokens=len(content.split()) * 1.3,  # Rough estimate
                cost_usd=0.0  # Would need to calculate based on model pricing
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

            # Use streaming mode
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
                usage_tokens=len(accumulated_content.split()) * 1.3,  # Rough estimate
                cost_usd=0.0  # Would calculate based on model pricing
            )

            await callback.on_complete(response)
            return response

        except Exception as e:
            await callback.on_error(e)
            raise


class MockLLMProvider(LLMProvider_Interface):
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
        await asyncio.sleep(0.1)  # Simulate processing time

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
        # Simulate streaming by sending word by word
        for word in content.split():
            accumulated += word + " "
            await callback.on_token(word + " ", accumulated)
            await asyncio.sleep(0.05)  # Simulate streaming delay

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


class LLMService:
    """Main LLM service that manages providers and handles requests."""

    def __init__(self, config_path: Optional[str] = None, prompt_log_dir: str = "logs/prompts"):
        self.providers: Dict[LLMProvider, LLMProvider_Interface] = {}
        self.default_config = LLMConfig()
        self.usage_stats = LLMUsageStats()
        self.config_path = config_path

        # Setup prompt logging directory and file
        self.prompt_log_dir = Path(prompt_log_dir)
        self.prompt_log_dir.mkdir(parents=True, exist_ok=True)
        self.prompt_log_file = self.prompt_log_dir / "llm_prompts.log"

        # Create log file if it doesn't exist
        if not self.prompt_log_file.exists():
            self.prompt_log_file.touch()

        print(f"[LLMService] Prompt logging enabled: {self.prompt_log_file.absolute()}")

        # Initialize providers
        self._initialize_providers()
        self._load_config()

    def _initialize_providers(self):
        """Initialize all available providers."""
        # OpenAI LangChain provider
        openai_provider = OpenAILangChainProvider()
        if openai_provider.is_available():
            self.providers[LLMProvider.OPENAI_LANGCHAIN] = openai_provider

        # Add local model providers
        ollama_provider = OllamaProvider()
        if ollama_provider.is_available():
            self.providers[LLMProvider.OLLAMA] = ollama_provider

        hf_provider = HuggingFaceProvider()
        if hf_provider.is_available():
            self.providers[LLMProvider.HUGGINGFACE] = hf_provider

        llamacpp_provider = LlamaCppProvider()
        if llamacpp_provider.is_available():
            self.providers[LLMProvider.LLAMACPP] = llamacpp_provider

        # Always add mock provider for testing
        self.providers[LLMProvider.MOCK] = MockLLMProvider()

        print(f"[LLMService] Initialized {len(self.providers)} providers: {list(self.providers.keys())}")

    def _load_config(self):
        """Load configuration from file if available."""
        if self.config_path and Path(self.config_path).exists():
            try:
                with open(self.config_path) as f:
                    config_data = json.load(f)
                    # Update default config with loaded values
                    for key, value in config_data.items():
                        if hasattr(self.default_config, key):
                            # Convert provider string to enum if needed
                            if key == "provider" and isinstance(value, str):
                                try:
                                    value = LLMProvider(value)
                                except ValueError:
                                    print(f"[LLMService] Unknown provider '{value}', using default")
                                    continue
                            setattr(self.default_config, key, value)
                print(f"[LLMService] Loaded config from {self.config_path}")

                # Print LLM configuration details for startup visibility
                provider_name = getattr(self.default_config.provider, 'value', str(self.default_config.provider))
                print(f"[LLMService] ══════════════════════════════════════════════")
                print(f"[LLMService] LLM Configuration:")
                print(f"[LLMService]   Provider: {provider_name}")
                print(f"[LLMService]   Model: {self.default_config.model}")
                if self.default_config.base_url:
                    print(f"[LLMService]   Base URL: {self.default_config.base_url}")
                print(f"[LLMService]   Temperature: {self.default_config.temperature}")
                print(f"[LLMService]   Max Tokens: {self.default_config.max_tokens}")
                print(f"[LLMService]   Streaming: {self.default_config.streaming}")
                print(f"[LLMService] ══════════════════════════════════════════════")
            except Exception as e:
                print(f"[LLMService] Failed to load config: {e}")

    def get_available_providers(self) -> List[str]:
        """Get list of available provider names."""
        return [provider.get_provider_name() for provider in self.providers.values()]

    def get_provider(self, provider_type: LLMProvider) -> Optional[LLMProvider_Interface]:
        """Get a specific provider."""
        return self.providers.get(provider_type)

    def _log_prompt_to_file(self, component_name: str, messages: List[LLMMessage], config: LLMConfig, provider_name: str):
        """Log the full prompt to a file for debugging and monitoring."""
        try:
            timestamp = datetime.now(timezone.utc).isoformat()

            # Build log entry with clear visual separation
            log_entry = []
            log_entry.append("\n" + "="*80)
            log_entry.append(f"TIMESTAMP: {timestamp}")
            log_entry.append(f"COMPONENT: {component_name.upper()}")
            log_entry.append("="*80)
            log_entry.append(f"Model: {config.model}")
            log_entry.append(f"Temperature: {config.temperature}")
            log_entry.append(f"Max Tokens: {config.max_tokens}")
            log_entry.append(f"Provider: {provider_name}")
            log_entry.append(f"Streaming: {config.streaming}")
            log_entry.append("-"*80)
            log_entry.append("SYSTEM PROMPTS & USER MESSAGES:")
            log_entry.append("-"*80)

            for i, msg in enumerate(messages, 1):
                role_label = msg.role.upper()
                log_entry.append(f"\n[{role_label} MESSAGE {i}]:")
                log_entry.append(msg.content)
                log_entry.append("-"*80)

            log_entry.append("="*80)

            # Write to file (append mode)
            with open(self.prompt_log_file, 'a', encoding='utf-8') as f:
                f.write('\n'.join(log_entry))

        except Exception as e:
            print(f"[LLMService] Warning: Failed to log prompt to file: {e}")

    def _log_response_to_file(self, component_name: str, response: LLMResponse):
        """Log the LLM response to a file for debugging and monitoring."""
        try:
            timestamp = datetime.now(timezone.utc).isoformat()

            # Build response log entry
            log_entry = []
            log_entry.append("\n" + "▼"*80)
            log_entry.append(f"LLM RESPONSE - {timestamp}")
            log_entry.append(f"COMPONENT: {component_name.upper()}")
            log_entry.append("▼"*80)
            log_entry.append(f"Response Time: {response.response_time:.2f}s")
            log_entry.append(f"Tokens Used: {response.usage_tokens}")
            log_entry.append(f"Cost: ${response.cost_usd:.6f}")
            log_entry.append("-"*80)
            log_entry.append("ASSISTANT RESPONSE:")
            log_entry.append("-"*80)
            log_entry.append(response.content)
            log_entry.append("-"*80)
            log_entry.append("▲"*80)
            log_entry.append("\n" + "#"*120)
            log_entry.append("#" + " CONVERSATIONAL TURN COMPLETE ".center(118, "#") + "#")
            log_entry.append("#"*120 + "\n")

            # Write to file (append mode)
            with open(self.prompt_log_file, 'a', encoding='utf-8') as f:
                f.write('\n'.join(log_entry))

        except Exception as e:
            print(f"[LLMService] Warning: Failed to log response to file: {e}")

    async def generate(
        self,
        messages: Union[List[LLMMessage], List[tuple], str],
        config: Optional[LLMConfig] = None,
        callback: Optional[LLMStreamingCallback] = None,
        component_name: str = "unknown"
    ) -> LLMResponse:
        """Generate a response using the configured provider."""

        # Use default config if none provided
        if config is None:
            config = self.default_config

        # Convert messages to standard format
        if isinstance(messages, str):
            messages = [LLMMessage(role="user", content=messages)]
        elif isinstance(messages, list) and messages and isinstance(messages[0], tuple):
            messages = [LLMMessage(role=role, content=content) for role, content in messages]

        # Get provider
        provider = self.providers.get(config.provider)
        if not provider:
            # Try fallback to first available provider
            if self.providers:
                provider = list(self.providers.values())[0]
                print(f"[LLMService] Provider {config.provider} not available, using {provider.get_provider_name()}")
            else:
                raise RuntimeError("No LLM providers available")

        # LOG FULL PROMPT TO FILE
        self._log_prompt_to_file(component_name, messages, config, provider.get_provider_name())

        # Track request
        self.usage_stats.total_requests += 1

        try:
            # Generate response
            if config.streaming and callback:
                response = await provider.generate_stream(messages, config, callback)
            else:
                response = await provider.generate(messages, config, callback)

            # Update stats
            self.usage_stats.successful_requests += 1
            self.usage_stats.total_tokens_used += response.usage_tokens
            self.usage_stats.total_cost_usd += response.cost_usd

            # Update average response time
            total_time = self.usage_stats.avg_response_time * (self.usage_stats.successful_requests - 1) + response.response_time
            self.usage_stats.avg_response_time = total_time / self.usage_stats.successful_requests

            # Update provider stats
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

            print(f"[LLMService] {component_name}: {provider_name} response in {response.response_time:.2f}s, {response.usage_tokens} tokens")

            # LOG RESPONSE TO FILE
            self._log_response_to_file(component_name, response)

            return response

        except Exception as e:
            self.usage_stats.failed_requests += 1
            print(f"[LLMService] {component_name}: Request failed with {provider.get_provider_name()}: {e}")
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


class OllamaProvider(LLMProvider_Interface):
    """Ollama provider for local LLMs."""

    def __init__(self):
        self.available = False
        self.client = None
        self._initialize()

    def _initialize(self):
        """Initialize the Ollama client."""
        try:
            import requests
            self.requests = requests
            # Mark as available if requests library is present
            # Server connectivity will be checked at runtime using base_url from config
            self.available = True
            print("[LLMService] Ollama provider initialized (server connection will be verified at runtime)")
        except ImportError:
            print("[LLMService] Ollama provider requires 'requests' package: pip install requests")
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

        # Convert messages to Ollama format
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
                usage_tokens=len(content.split()) * 1.3,
                cost_usd=0.0  # Local models are free
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

        # Convert messages to Ollama format
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

            import json
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
                usage_tokens=len(accumulated_content.split()) * 1.3,
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
        prompt_parts.append("Assistant:")  # Prompt for response
        return "\n\n".join(prompt_parts)


class HuggingFaceProvider(LLMProvider_Interface):
    """Hugging Face Transformers provider for local models."""

    def __init__(self):
        self.available = False
        self.pipeline = None
        self.tokenizer = None
        self._initialize()

    def _initialize(self):
        """Initialize Hugging Face transformers."""
        try:
            from transformers import pipeline, AutoTokenizer
            import torch
            self.pipeline_class = pipeline
            self.AutoTokenizer = AutoTokenizer
            self.torch = torch
            self.available = True
            print("[LLMService] Hugging Face provider initialized")
        except ImportError as e:
            print(f"[LLMService] Hugging Face provider requires transformers: pip install transformers torch")
            self.available = False

    def get_provider_name(self) -> str:
        return "huggingface"

    def is_available(self) -> bool:
        return self.available

    def _load_model(self, config: LLMConfig):
        """Load the model and tokenizer if not already loaded."""
        if not self.pipeline or getattr(self, 'current_model', None) != config.model:
            print(f"[HuggingFace] Loading model: {config.model}")

            # Determine device
            if config.device == "auto":
                if self.torch.cuda.is_available():
                    device = 0  # First GPU
                elif hasattr(self.torch.backends, 'mps') and self.torch.backends.mps.is_available():
                    device = "mps"
                else:
                    device = "cpu"
            else:
                device = config.device

            self.pipeline = self.pipeline_class(
                "text-generation",
                model=config.model,
                device=device,
                torch_dtype=self.torch.float16 if device != "cpu" else self.torch.float32,
                trust_remote_code=True
            )
            self.tokenizer = self.AutoTokenizer.from_pretrained(config.model)
            if self.tokenizer.pad_token is None:
                self.tokenizer.pad_token = self.tokenizer.eos_token

            self.current_model = config.model
            print(f"[HuggingFace] Model loaded on device: {device}")

    async def generate(
        self,
        messages: List[LLMMessage],
        config: LLMConfig,
        callback: Optional[LLMStreamingCallback] = None
    ) -> LLMResponse:
        """Generate response using Hugging Face model."""
        if not self.available:
            raise RuntimeError("Hugging Face provider not available")

        start_time = time.time()
        self._load_model(config)

        # Build prompt
        prompt = self._build_chat_prompt(messages)

        try:
            # Generate response
            outputs = self.pipeline(
                prompt,
                max_new_tokens=config.max_tokens,
                temperature=config.temperature,
                do_sample=True,
                pad_token_id=self.tokenizer.pad_token_id,
                eos_token_id=self.tokenizer.eos_token_id,
                return_full_text=False
            )

            content = outputs[0]['generated_text'].strip()
            response_time = time.time() - start_time

            llm_response = LLMResponse(
                content=content,
                model=config.model,
                provider=self.get_provider_name(),
                response_time=response_time,
                usage_tokens=len(content.split()) * 1.3,
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
        """Generate streaming response (simulated for HF models)."""
        # For now, simulate streaming by generating full response and sending word by word
        response = await self.generate(messages, config)

        # Simulate streaming by sending tokens
        accumulated = ""
        words = response.content.split()

        for word in words:
            accumulated += word + " "
            await callback.on_token(word + " ", accumulated)
            await asyncio.sleep(0.05)  # Small delay to simulate streaming

        await callback.on_complete(response)
        return response

    def _build_chat_prompt(self, messages: List[LLMMessage]) -> str:
        """Build a chat prompt for the model."""
        # Try to use the tokenizer's chat template if available
        if hasattr(self.tokenizer, 'apply_chat_template'):
            try:
                chat_messages = [
                    {"role": msg.role, "content": msg.content}
                    for msg in messages
                ]
                return self.tokenizer.apply_chat_template(
                    chat_messages,
                    tokenize=False,
                    add_generation_prompt=True
                )
            except Exception:
                # Fall back to manual formatting
                pass

        # Manual chat formatting
        prompt_parts = []
        for msg in messages:
            if msg.role == "system":
                prompt_parts.append(f"System: {msg.content}")
            elif msg.role == "user":
                prompt_parts.append(f"User: {msg.content}")
            elif msg.role == "assistant":
                prompt_parts.append(f"Assistant: {msg.content}")

        prompt_parts.append("Assistant:")  # Prompt for response
        return "\n\n".join(prompt_parts)


class LlamaCppProvider(LLMProvider_Interface):
    """llama.cpp provider for local models."""

    def __init__(self):
        self.available = False
        self.llama = None
        self._initialize()

    def _initialize(self):
        """Initialize llama-cpp-python."""
        try:
            from llama_cpp import Llama
            self.Llama = Llama
            self.available = True
            print("[LLMService] llama.cpp provider initialized")
        except ImportError:
            print("[LLMService] llama.cpp provider requires llama-cpp-python: pip install llama-cpp-python")
            self.available = False

    def get_provider_name(self) -> str:
        return "llamacpp"

    def is_available(self) -> bool:
        return self.available

    def _load_model(self, config: LLMConfig):
        """Load the llama.cpp model."""
        if not self.llama or getattr(self, 'current_model_path', None) != config.model_path:
            if not config.model_path:
                raise ValueError("model_path is required for llama.cpp provider")

            print(f"[LlamaCpp] Loading model: {config.model_path}")

            self.llama = self.Llama(
                model_path=config.model_path,
                n_ctx=config.context_length,
                n_gpu_layers=config.gpu_layers,
                verbose=False
            )
            self.current_model_path = config.model_path
            print("[LlamaCpp] Model loaded successfully")

    async def generate(
        self,
        messages: List[LLMMessage],
        config: LLMConfig,
        callback: Optional[LLMStreamingCallback] = None
    ) -> LLMResponse:
        """Generate response using llama.cpp."""
        if not self.available:
            raise RuntimeError("llama.cpp provider not available")

        start_time = time.time()
        self._load_model(config)

        # Build prompt
        prompt = self._build_prompt(messages)

        try:
            # Generate response
            output = self.llama(
                prompt,
                max_tokens=config.max_tokens,
                temperature=config.temperature,
                stream=False
            )

            content = output['choices'][0]['text'].strip()
            response_time = time.time() - start_time

            llm_response = LLMResponse(
                content=content,
                model=config.model_path or "llamacpp-model",
                provider=self.get_provider_name(),
                response_time=response_time,
                usage_tokens=output.get('usage', {}).get('total_tokens', len(content.split()) * 1.3),
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
        """Generate streaming response using llama.cpp."""
        if not self.available:
            raise RuntimeError("llama.cpp provider not available")

        start_time = time.time()
        self._load_model(config)
        accumulated_content = ""

        # Build prompt
        prompt = self._build_prompt(messages)

        try:
            # Generate streaming response
            stream = self.llama(
                prompt,
                max_tokens=config.max_tokens,
                temperature=config.temperature,
                stream=True
            )

            for output in stream:
                if 'choices' in output and output['choices']:
                    token = output['choices'][0].get('text', '')
                    if token:
                        accumulated_content += token
                        await callback.on_token(token, accumulated_content)

            response_time = time.time() - start_time

            llm_response = LLMResponse(
                content=accumulated_content,
                model=config.model_path or "llamacpp-model",
                provider=self.get_provider_name(),
                response_time=response_time,
                usage_tokens=len(accumulated_content.split()) * 1.3,
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
        prompt_parts.append("Assistant:")  # Prompt for response
        return "\n\n".join(prompt_parts)