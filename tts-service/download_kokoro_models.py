#!/usr/bin/env python3
"""
Pre-download Kokoro TTS models during Docker build.

Downloads the Kokoro ONNX model and voice files (~500MB total)
so they're baked into the Docker image.
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


def download_kokoro_models() -> bool:
    """Download Kokoro TTS models."""
    try:
        print("=" * 60)
        print("Kokoro TTS Model Downloader")
        print("=" * 60)

        cache_dir = os.getenv('KOKORO_CACHE_DIR', '/root/.cache/kokoro')
        os.makedirs(cache_dir, exist_ok=True)

        model_path = os.path.join(cache_dir, 'kokoro-v1.0.onnx')
        voices_path = os.path.join(cache_dir, 'voices-v1.0.bin')

        print(f"\nCache directory: {cache_dir}")

        model_url = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
        voices_url = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

        # Download model (~300MB)
        if os.path.exists(model_path):
            print(f"\nModel already exists, skipping")
        else:
            if not download_with_progress(model_url, model_path, "Downloading Kokoro model (~300MB)..."):
                return False

        # Download voices (~200MB)
        if os.path.exists(voices_path):
            print(f"\nVoices already exist, skipping")
        else:
            if not download_with_progress(voices_url, voices_path, "Downloading Kokoro voices (~200MB)..."):
                return False

        # Verify
        if os.path.exists(model_path) and os.path.exists(voices_path):
            model_size = os.path.getsize(model_path) / (1024 * 1024)
            voices_size = os.path.getsize(voices_path) / (1024 * 1024)
            print(f"\n{'=' * 60}")
            print(f"Model:  {model_size:.1f} MB")
            print(f"Voices: {voices_size:.1f} MB")
            print(f"Total:  {model_size + voices_size:.1f} MB")
            print(f"{'=' * 60}")
            print("SUCCESS: Kokoro models ready!")
            return True

        return False

    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("\nKokoro TTS Model Pre-Download Script\n")
    success = download_kokoro_models()
    sys.exit(0 if success else 1)
