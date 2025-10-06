#!/usr/bin/env python3
"""
Simple test script for the LLM service.
Run this to test the unified LLM service functionality.
"""

import asyncio
import sys
import os

# Add parent directory to Python path to import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from message_processing.llm_service import (
    LLMService,
    LLMConfig,
    LLMProvider,
    LLMMessage,
    LLMStreamingCallback
)


class TestCallback(LLMStreamingCallback):
    """Test callback for streaming responses."""

    def __init__(self):
        self.tokens = []
        self.full_response = ""

    async def on_token(self, token: str, accumulated_text: str) -> None:
        self.tokens.append(token)
        print(token, end='', flush=True)

    async def on_complete(self, final_response) -> None:
        self.full_response = final_response.content
        print(f"\n\n[Complete] Model: {final_response.model}, Provider: {final_response.provider}")
        print(f"[Stats] Tokens: {final_response.usage_tokens}, Time: {final_response.response_time:.2f}s")

    async def on_error(self, error: Exception) -> None:
        print(f"\n[Error] {error}")


async def test_llm_service():
    """Test the LLM service functionality."""
    print("🧪 Testing LLM Service")
    print("=" * 50)

    # Initialize LLM service
    config_path = "llm_config.json"
    llm_service = LLMService(config_path=config_path)

    available_providers = llm_service.get_available_providers()
    print(f"Available providers: {available_providers}")

    if "ollama" in available_providers:
        print("✅ Ollama detected - you can use local models!")
    if "llamacpp" in available_providers:
        print("✅ llama.cpp detected - high performance local models available!")
    if "huggingface" in available_providers:
        print("✅ Hugging Face detected - access to thousands of models!")
    if "openai_langchain" in available_providers:
        print("✅ OpenAI detected - cloud models available!")

    print()

    # Test 1: Simple non-streaming request
    print("📝 Test 1: Non-streaming request")
    print("-" * 30)

    messages = [LLMMessage(role="user", content="What is 2+2? Give a very brief answer.")]
    config = LLMConfig(streaming=False)

    try:
        response = await llm_service.generate(
            messages=messages,
            config=config,
            component_name="test_simple"
        )
        print(f"Response: {response.content}")
        print(f"Provider: {response.provider}, Model: {response.model}")
        print()
    except Exception as e:
        print(f"Error: {e}")
        print()

    # Test 2: Streaming request
    print("🌊 Test 2: Streaming request")
    print("-" * 30)

    callback = TestCallback()
    messages = [LLMMessage(role="user", content="Explain what Python is in 2-3 sentences.")]
    config = LLMConfig(streaming=True, temperature=0.3)

    try:
        response = await llm_service.generate(
            messages=messages,
            config=config,
            callback=callback,
            component_name="test_streaming"
        )
    except Exception as e:
        print(f"Error: {e}")

    print()

    # Test 3: Usage statistics
    print("📊 Usage Statistics")
    print("-" * 30)
    stats = llm_service.get_usage_stats()
    print(f"Total requests: {stats['total_requests']}")
    print(f"Success rate: {stats['success_rate']:.1f}%")
    print(f"Total tokens: {stats['total_tokens']}")
    print(f"Avg response time: {stats['avg_response_time']:.2f}s")

    if stats['providers']:
        print("\nPer-provider stats:")
        for provider, pstats in stats['providers'].items():
            print(f"  {provider}: {pstats['requests']} requests, {pstats['tokens']} tokens")

    print("\n✅ LLM Service test completed!")


if __name__ == "__main__":
    asyncio.run(test_llm_service())