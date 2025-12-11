"""Compiled gRPC protocol buffer files for STT, TTS, and Agent services."""

from stella_agent_sdk._grpc import stt_pb2, stt_pb2_grpc
from stella_agent_sdk._grpc import tts_pb2, tts_pb2_grpc
from stella_agent_sdk._grpc import agent_pb2, agent_pb2_grpc

__all__ = [
    "stt_pb2", "stt_pb2_grpc",
    "tts_pb2", "tts_pb2_grpc",
    "agent_pb2", "agent_pb2_grpc",
]
