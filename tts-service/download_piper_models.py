#!/usr/bin/env python3
"""
Pre-download Piper TTS models.

Downloads the Piper ONNX model and config JSON (~60MB total)
from the rhasspy/piper-voices repository on Hugging Face.
"""

import os
import sys
import urllib.request
import time


def download_with_progress(url: str, destination: str, description: str, max_retries: int = 5) -> bool:
    """Download a file with progress reporting and retry logic."""

    def reporthook(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            percent = min(100, (downloaded * 100) // total_size)
            mb_downloaded = downloaded / (1024 * 1024)
            mb_total = total_size / (1024 * 1024)
            print(f"\r  Progress: {percent:3d}% ({mb_downloaded:6.1f}/{mb_total:.1f} MB)", end='', flush=True)

    for attempt in range(1, max_retries + 1):
        try:
            if attempt > 1:
                print(f"\n  Retry attempt {attempt}/{max_retries}")

            print(f"\n{description}")
            print(f"  URL: {url}")
            print(f"  Destination: {destination}")

            # Set socket timeout
            import socket
            socket.setdefaulttimeout(600)

            urllib.request.urlretrieve(url, destination, reporthook)
            print()

            if os.path.exists(destination):
                file_size = os.path.getsize(destination) / (1024 * 1024)
                print(f"  Downloaded successfully: {file_size:.1f} MB")
                return True
            else:
                print("  File not found after download")
                if attempt < max_retries:
                    wait_time = 5 * attempt
                    print(f"  Waiting {wait_time}s before retry...")
                    time.sleep(wait_time)

        except Exception as e:
            error_msg = str(e)
            print(f"\n  Download failed (attempt {attempt}/{max_retries}): {error_msg}")

            if os.path.exists(destination):
                try:
                    os.remove(destination)
                except Exception:
                    pass

            if attempt < max_retries:
                is_retryable = any(x in error_msg.lower() for x in [
                    '503', 'timeout', 'connection', 'network'
                ])
                if is_retryable:
                    wait_time = 10 * attempt
                    print(f"  Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                else:
                    return False

    return False


def download_piper_models() -> bool:
    """Download Piper TTS models."""
    try:
        print("=" * 60)
        print("Piper TTS Model Downloader")
        print("=" * 60)

        cache_dir = os.getenv('PIPER_CACHE_DIR', '/root/.cache/piper')
        os.makedirs(cache_dir, exist_ok=True)

        voice = os.getenv('PIPER_VOICE', 'en_US-lessac-medium')

        # Parse voice name to build URL path
        # Voice format: lang_REGION-name-quality (e.g., en_US-lessac-medium)
        # URL path: en/en_US/lessac/medium/  (language code / lang_REGION / name / quality)
        parts = voice.split('-')
        if len(parts) < 3:
            print(f"Error: Invalid voice name format: {voice}")
            print("Expected format: lang_REGION-name-quality (e.g., en_US-lessac-medium)")
            return False

        lang_region = parts[0]          # e.g., en_US
        voice_name = parts[1]           # e.g., lessac
        quality = '-'.join(parts[2:])   # e.g., medium (or could be multi-part)

        # Extract language code (part before underscore: en_US -> en)
        lang_code = lang_region.split('_')[0]  # e.g., en

        # Build Hugging Face URL
        base_url = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"
        model_url = f"{base_url}/{lang_code}/{lang_region}/{voice_name}/{quality}/{voice}.onnx"
        config_url = f"{base_url}/{lang_code}/{lang_region}/{voice_name}/{quality}/{voice}.onnx.json"

        model_path = os.path.join(cache_dir, f'{voice}.onnx')
        config_path = os.path.join(cache_dir, f'{voice}.onnx.json')

        print(f"\nCache directory: {cache_dir}")
        print(f"Voice: {voice}")

        # Download model (~60MB)
        if os.path.exists(model_path):
            print(f"\nModel already exists, skipping")
        else:
            if not download_with_progress(model_url, model_path, f"Downloading Piper model ({voice})..."):
                return False

        # Download config (<1KB)
        if os.path.exists(config_path):
            print(f"\nConfig already exists, skipping")
        else:
            if not download_with_progress(config_url, config_path, "Downloading Piper config..."):
                return False

        # Verify
        if os.path.exists(model_path) and os.path.exists(config_path):
            model_size = os.path.getsize(model_path) / (1024 * 1024)
            config_size = os.path.getsize(config_path) / 1024
            print(f"\n{'=' * 60}")
            print(f"Model:  {model_size:.1f} MB")
            print(f"Config: {config_size:.1f} KB")
            print(f"{'=' * 60}")
            print("SUCCESS: Piper models ready!")
            return True

        return False

    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("\nPiper TTS Model Pre-Download Script\n")
    success = download_piper_models()
    sys.exit(0 if success else 1)
