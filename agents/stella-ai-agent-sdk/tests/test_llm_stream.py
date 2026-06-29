"""Tests for stream_completion — the single callback→async-iterator adapter that
pipeline stages share instead of each hand-rolling a queue+callback bridge."""

import asyncio

import pytest

from stella_agent_sdk.llm import (
    stream_completion, LLMConfig, LLMMessage, LLMResponse, LLMProvider,
)


class _FakeService:
    """Drives the streaming callback like a real provider would."""

    def __init__(self, tokens=None, raise_before_callback=False, error=None,
                 final_content=None):
        self.tokens = tokens or []
        self.raise_before_callback = raise_before_callback
        self.error = error
        self.final_content = final_content

    async def generate(self, messages, config, callback, component_name="unknown"):
        if self.raise_before_callback:
            raise RuntimeError("provider blew up before any callback")
        acc = ""
        for tok in self.tokens:
            acc += tok
            await callback.on_token(tok, acc)
        if self.error is not None:
            await callback.on_error(self.error)
            return None
        resp = LLMResponse(
            content=self.final_content if self.final_content is not None else acc,
            model="t", provider="t",
        )
        await callback.on_complete(resp)
        return resp


_CFG = LLMConfig(model="m", provider=LLMProvider.OPENAI_LANGCHAIN, streaming=True)
_MSGS = [LLMMessage(role="user", content="hi")]


async def _drain(agen):
    return [x async for x in agen]


@pytest.mark.asyncio
async def test_yields_accumulated_then_final():
    svc = _FakeService(tokens=["Hel", "lo", " there"])
    out = await _drain(stream_completion(svc, _MSGS, _CFG))
    assert out == [("Hel", False), ("Hello", False), ("Hello there", False), ("Hello there", True)]


@pytest.mark.asyncio
async def test_final_uses_response_content_when_present():
    # complete carries the authoritative final text even if it differs from tokens.
    svc = _FakeService(tokens=["par", "tial"], final_content="full final text")
    out = await _drain(stream_completion(svc, _MSGS, _CFG))
    assert out[-1] == ("full final text", True)


@pytest.mark.asyncio
async def test_error_event_propagates():
    svc = _FakeService(tokens=["x"], error=ValueError("boom"))
    with pytest.raises(ValueError, match="boom"):
        await _drain(stream_completion(svc, _MSGS, _CFG))


@pytest.mark.asyncio
async def test_provider_exception_before_callback_does_not_hang():
    # The done-callback must surface a raw generate() failure so the consumer
    # never blocks forever on an event that will never arrive.
    svc = _FakeService(raise_before_callback=True)
    with pytest.raises(RuntimeError, match="blew up"):
        await asyncio.wait_for(_drain(stream_completion(svc, _MSGS, _CFG)), timeout=2.0)
