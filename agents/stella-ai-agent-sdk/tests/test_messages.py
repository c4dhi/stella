"""Tests for message types."""

import json
import pytest
from datetime import datetime

from stella_agent_sdk.messages.types import (
    InputType,
    OutputType,
    StatusSubtype,
    MetadataSubtype,
)
from stella_agent_sdk.messages.input import AgentInput
from stella_agent_sdk.messages.output import AgentOutput


class TestInputType:
    """Tests for InputType enum."""

    def test_input_types_exist(self):
        """All expected input types exist."""
        assert InputType.TEXT == "text"
        assert InputType.INTERRUPT == "interrupt"
        assert InputType.SESSION_START == "session_start"
        assert InputType.SESSION_END == "session_end"
        assert InputType.CONFIG == "config"


class TestOutputType:
    """Tests for OutputType enum."""

    def test_output_types_exist(self):
        """All expected output types exist."""
        assert OutputType.TEXT_CHUNK == "text_chunk"
        assert OutputType.TEXT_FINAL == "text_final"
        assert OutputType.STATUS == "status"
        assert OutputType.METADATA == "metadata"
        assert OutputType.ERROR == "error"


class TestAgentInput:
    """Tests for AgentInput dataclass."""

    def test_create_text_input(self):
        """Create a text input message."""
        input_msg = AgentInput.text_input(
            session_id="test-session",
            text="Hello, world!",
            user_name="Test User",
        )
        assert input_msg.session_id == "test-session"
        assert input_msg.type == InputType.TEXT
        assert input_msg.text == "Hello, world!"
        assert input_msg.metadata.get("user_name") == "Test User"

    def test_create_interrupt(self):
        """Create an interrupt message."""
        input_msg = AgentInput.interrupt("test-session", reason="user_barge_in")
        assert input_msg.session_id == "test-session"
        assert input_msg.type == InputType.INTERRUPT
        assert input_msg.metadata.get("reason") == "user_barge_in"

    def test_create_session_start(self):
        """Create a session start message."""
        config = {"model": "gpt-4", "temperature": 0.7}
        input_msg = AgentInput.session_start("test-session", config)
        assert input_msg.session_id == "test-session"
        assert input_msg.type == InputType.SESSION_START
        assert input_msg.metadata == config

    def test_create_session_end(self):
        """Create a session end message."""
        input_msg = AgentInput.session_end("test-session")
        assert input_msg.session_id == "test-session"
        assert input_msg.type == InputType.SESSION_END


class TestAgentOutput:
    """Tests for AgentOutput dataclass."""

    def test_create_text_chunk(self):
        """Create a streaming text chunk."""
        output = AgentOutput.text_chunk(
            session_id="test-session",
            text="Hello",
            transcript_id="tx-123",
        )
        assert output.session_id == "test-session"
        assert output.type == OutputType.TEXT_CHUNK
        assert output.content == "Hello"
        assert output.transcript_id == "tx-123"
        assert output.is_final is False

    def test_create_text_chunk_final(self):
        """Create a final text chunk."""
        output = AgentOutput.text_chunk(
            session_id="test-session",
            text="!",
            transcript_id="tx-123",
            is_final=True,
        )
        assert output.is_final is True

    def test_create_text_final(self):
        """Create a complete text message."""
        output = AgentOutput.text_final(
            session_id="test-session",
            text="Hello, world!",
        )
        assert output.session_id == "test-session"
        assert output.type == OutputType.TEXT_FINAL
        assert output.content == "Hello, world!"
        assert output.is_final is True
        assert output.transcript_id is not None  # Auto-generated

    def test_create_status(self):
        """Create a status message."""
        output = AgentOutput.status(
            session_id="test-session",
            message="Processing...",
            subtype=StatusSubtype.PROCESSING,
            progress=0.5,
        )
        assert output.session_id == "test-session"
        assert output.type == OutputType.STATUS
        assert output.content == "Processing..."
        assert output.status_subtype == StatusSubtype.PROCESSING
        assert output.metadata.get("progress") == 0.5

    def test_create_thinking(self):
        """Create a thinking status message."""
        output = AgentOutput.thinking("test-session")
        assert output.type == OutputType.STATUS
        assert output.status_subtype == StatusSubtype.THINKING

    def test_create_error(self):
        """Create an error message."""
        output = AgentOutput.error(
            session_id="test-session",
            message="Something went wrong",
            error_type="processing_error",
            recoverable=True,
        )
        assert output.session_id == "test-session"
        assert output.type == OutputType.ERROR
        assert output.content == "Something went wrong"
        assert output.metadata.get("error_type") == "processing_error"
        assert output.metadata.get("recoverable") is True

    def test_create_deliverable(self):
        """Create a deliverable update."""
        output = AgentOutput.deliverable(
            session_id="test-session",
            key="user_name",
            value="John Doe",
        )
        assert output.type == OutputType.METADATA
        assert output.metadata_subtype == MetadataSubtype.DELIVERABLE
        assert output.metadata.get("key") == "user_name"
        assert output.metadata.get("value") == "John Doe"

    def test_create_progress(self):
        """Create a progress update."""
        output = AgentOutput.progress(
            session_id="test-session",
            percentage=75,
            message="Almost done",
        )
        assert output.type == OutputType.METADATA
        assert output.metadata_subtype == MetadataSubtype.PROGRESS
        assert output.metadata.get("percentage") == 0.75  # Normalized to 0-1
