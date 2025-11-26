#!/usr/bin/env python3
"""
Pre-download faster-whisper model during Docker build.

This script is run during the Docker build process when ENABLE_GPU=true
to pre-download the Whisper model and avoid runtime download latency.

Environment variables:
- WHISPER_MODEL: Model size (default: large-v3)
- WHISPER_CACHE_DIR: Cache directory (default: /root/.cache/whisper)
"""
import os
import sys


def download_whisper_model():
    """Download faster-whisper model to cache."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("[Whisper Download] faster-whisper not installed, skipping")
        return False

    model_size = os.getenv("WHISPER_MODEL", "large-v3")
    cache_dir = os.getenv("WHISPER_CACHE_DIR", "/root/.cache/whisper")

    # Ensure cache directory exists
    os.makedirs(cache_dir, exist_ok=True)

    print(f"[Whisper Download] Pre-downloading faster-whisper model: {model_size}")
    print(f"[Whisper Download] Cache directory: {cache_dir}")

    try:
        # This triggers download and caching
        # Use CPU for download (no GPU needed)
        model = WhisperModel(
            model_size,
            device="cpu",
            compute_type="int8",  # Lightweight for download
            download_root=cache_dir,
        )

        print(f"[Whisper Download] Model '{model_size}' cached successfully!")
        print(f"[Whisper Download] Cache location: {cache_dir}")

        # Verify model files exist
        model_dir = os.path.join(cache_dir, f"models--Systran--faster-whisper-{model_size}")
        if os.path.exists(model_dir):
            size_mb = sum(
                os.path.getsize(os.path.join(dirpath, filename))
                for dirpath, dirnames, filenames in os.walk(model_dir)
                for filename in filenames
            ) / (1024 * 1024)
            print(f"[Whisper Download] Model size: {size_mb:.1f} MB")

        return True

    except Exception as e:
        print(f"[Whisper Download] Failed to download model: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = download_whisper_model()
    sys.exit(0 if success else 1)
