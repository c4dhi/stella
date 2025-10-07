#!/usr/bin/env python3
"""
Script to pre-download faster-whisper and Silero VAD models during Docker build.
This avoids downloading them on every container startup.
"""

import os
import sys

def download_whisper_model():
    """Download the faster-whisper model."""
    try:
        from faster_whisper import WhisperModel

        # Get model from environment or use default
        model_name = os.getenv("WHISPER_MODEL", "small.en")
        device = os.getenv("WHISPER_DEVICE", "cpu")
        compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

        print(f"📥 Downloading faster-whisper model: {model_name}")
        print(f"   Device: {device}, Compute type: {compute_type}")
        print("   This may take a few minutes...")

        # Download model by instantiating it
        model = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            download_root=None  # Use default cache directory
        )

        print(f"✅ faster-whisper model '{model_name}' downloaded successfully!")

        # Verify model cache directory
        cache_dir = os.path.expanduser("~/.cache/huggingface")
        if os.path.exists(cache_dir):
            print(f"   Cached at: {cache_dir}")

        return True

    except ImportError as e:
        print(f"⚠️  faster-whisper not installed: {e}")
        print("   Skipping faster-whisper model download")
        return False
    except Exception as e:
        print(f"❌ Error downloading faster-whisper model: {e}")
        return False

def download_silero_vad():
    """Download the Silero VAD model."""
    try:
        import torch

        print(f"📥 Downloading Silero VAD model (ONNX)...")
        print("   This may take a minute...")

        # Download Silero VAD model
        model, utils = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            force_reload=False,
            onnx=True  # Use ONNX version for better container compatibility
        )

        print(f"✅ Silero VAD model downloaded successfully!")

        # Verify model cache directory
        cache_dir = os.path.expanduser("~/.cache/torch/hub")
        if os.path.exists(cache_dir):
            print(f"   Cached at: {cache_dir}")

        return True

    except ImportError as e:
        print(f"⚠️  torch not installed: {e}")
        print("   Skipping Silero VAD model download")
        return False
    except Exception as e:
        print(f"❌ Error downloading Silero VAD model: {e}")
        return False

if __name__ == "__main__":
    print("=" * 70)
    print("faster-whisper & Silero VAD Model Downloader")
    print("=" * 70)
    print()

    success = True

    # Download faster-whisper model
    print("\n[1/2] Downloading faster-whisper model...")
    print("-" * 70)
    if not download_whisper_model():
        success = False

    # Download Silero VAD model
    print("\n[2/2] Downloading Silero VAD model...")
    print("-" * 70)
    if not download_silero_vad():
        success = False

    print("\n" + "=" * 70)
    if success:
        print("✨ All models downloaded successfully!")
        print("Models are cached and will be available at runtime.")
        print("=" * 70)
        sys.exit(0)
    else:
        print("⚠️  Some models failed to download")
        print("Container will attempt to download them at runtime.")
        print("=" * 70)
        sys.exit(1)
