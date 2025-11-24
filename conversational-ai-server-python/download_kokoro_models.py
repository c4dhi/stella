#!/usr/bin/env python3
"""
Pre-download Kokoro TTS models during Docker build.

This script manually downloads the Kokoro ONNX model and voice files (~1GB total)
so they're baked into the Docker image and don't need to be downloaded at runtime.

Uses manual urllib downloads (like download_sherpa_model.py) instead of relying
on kokoro-onnx auto-download (which doesn't exist).
"""

import os
import sys
import urllib.request


def download_with_progress(url, destination, description, max_retries=5):
    """Download a file with progress reporting and retry logic for transient failures."""
    import time

    def reporthook(block_num, block_size, total_size):
        """Report download progress."""
        downloaded = block_num * block_size
        if total_size > 0:
            percent = min(100, (downloaded * 100) // total_size)
            mb_downloaded = downloaded / (1024 * 1024)
            mb_total = total_size / (1024 * 1024)
            print(f"\r  Progress: {percent:3d}% ({mb_downloaded:6.1f}/{mb_total:.1f} MB)", end='', flush=True)

    for attempt in range(1, max_retries + 1):
        try:
            if attempt > 1:
                print(f"\n🔄 Retry attempt {attempt}/{max_retries}")

            print(f"\n{description}")
            print(f"  URL: {url}")
            print(f"  Destination: {destination}")

            # Set socket timeout to 10 minutes for large downloads
            import socket
            socket.setdefaulttimeout(600)

            urllib.request.urlretrieve(url, destination, reporthook)
            print()  # New line after progress

            # Verify download
            if os.path.exists(destination):
                file_size = os.path.getsize(destination) / (1024 * 1024)
                print(f"  ✅ Downloaded successfully: {file_size:.1f} MB")
                return True
            else:
                print(f"  ❌ File not found after download")
                if attempt < max_retries:
                    wait_time = 5 * attempt  # Exponential backoff: 5s, 10s, 15s...
                    print(f"  ⏳ Waiting {wait_time} seconds before retry...")
                    time.sleep(wait_time)
                continue

        except Exception as e:
            error_msg = str(e)
            print(f"\n  ❌ Download failed (attempt {attempt}/{max_retries}): {error_msg}")

            # Clean up partial download
            if os.path.exists(destination):
                try:
                    os.remove(destination)
                    print(f"  🗑️  Removed partial download")
                except Exception as cleanup_error:
                    print(f"  ⚠️  Could not remove partial file: {cleanup_error}")

            if attempt < max_retries:
                # Check if it's a transient error (503, timeout, connection issues)
                is_retryable = any(x in error_msg.lower() for x in [
                    '503', 'service unavailable', 'timeout', 'connection',
                    'temporarily', 'network', 'unreachable'
                ])

                if is_retryable:
                    wait_time = 10 * attempt  # Exponential backoff: 10s, 20s, 30s...
                    print(f"  🔄 Transient error detected - retrying in {wait_time} seconds...")
                    time.sleep(wait_time)
                else:
                    print(f"  ❌ Non-retryable error - failing immediately")
                    return False
            else:
                print(f"  ❌ All {max_retries} attempts failed")
                return False

    return False


def download_kokoro_models():
    """Download Kokoro TTS models manually (like Sherpa approach)."""
    try:
        print("=" * 70)
        print("Kokoro TTS Model Downloader")
        print("=" * 70)

        # Set model paths (matching runtime code)
        cache_dir = os.getenv('KOKORO_CACHE_DIR', '/root/.cache/kokoro')
        os.makedirs(cache_dir, exist_ok=True)

        model_path = os.path.join(cache_dir, 'kokoro-v1.0.onnx')
        voices_path = os.path.join(cache_dir, 'voices-v1.0.bin')

        print(f"\nCache directory: {cache_dir}")
        print(f"Model file: {os.path.basename(model_path)}")
        print(f"Voices file: {os.path.basename(voices_path)}")

        # Model URLs (matching runtime code in opensource_provider.py)
        model_url = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
        voices_url = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

        # Download model file (~300MB)
        if os.path.exists(model_path):
            model_size = os.path.getsize(model_path) / (1024 * 1024)
            print(f"\n📦 Model file already exists ({model_size:.1f} MB), skipping download")
        else:
            if not download_with_progress(
                model_url,
                model_path,
                "📥 Downloading Kokoro ONNX model (~300MB)..."
            ):
                return False

        # Download voices file (~200MB)
        if os.path.exists(voices_path):
            voices_size = os.path.getsize(voices_path) / (1024 * 1024)
            print(f"\n📦 Voices file already exists ({voices_size:.1f} MB), skipping download")
        else:
            if not download_with_progress(
                voices_url,
                voices_path,
                "📥 Downloading Kokoro voices (~200MB)..."
            ):
                return False

        # Verify both files exist and report sizes
        if os.path.exists(model_path) and os.path.exists(voices_path):
            model_size = os.path.getsize(model_path) / (1024 * 1024)
            voices_size = os.path.getsize(voices_path) / (1024 * 1024)
            total_size = model_size + voices_size

            print("\n" + "=" * 70)
            print("📊 Download Summary:")
            print(f"  • Model:  {model_size:6.1f} MB  ({model_path})")
            print(f"  • Voices: {voices_size:6.1f} MB  ({voices_path})")
            print(f"  • Total:  {total_size:6.1f} MB")
            print("=" * 70)

            # Verify by loading with Kokoro (optional but good validation)
            try:
                print("\n🧪 Verifying models by loading Kokoro TTS engine...")
                from kokoro_onnx import Kokoro

                kokoro = Kokoro(model_path, voices_path)
                print("  ✅ Kokoro TTS engine loaded successfully")

                # Quick synthesis test
                print("\n🎤 Testing speech synthesis...")
                test_text = "Kokoro models initialized successfully."
                audio, sample_rate = kokoro.create(test_text, voice="af_sky")

                if audio is not None and len(audio) > 0:
                    print(f"  ✅ Generated {len(audio)} audio samples at {sample_rate}Hz")
                    print("\n" + "=" * 70)
                    print("✅ SUCCESS: Kokoro TTS models ready for production use!")
                    print("=" * 70)
                    return True
                else:
                    print("  ⚠️  Synthesis test produced no audio")
                    print("\n" + "=" * 70)
                    print("⚠️  Models downloaded but synthesis test failed")
                    print("=" * 70)
                    return False

            except ImportError:
                print("  ⚠️  kokoro-onnx not installed, skipping verification")
                print("\n" + "=" * 70)
                print("✅ Models downloaded (verification skipped)")
                print("=" * 70)
                return True
            except Exception as e:
                print(f"  ❌ Verification failed: {e}")
                import traceback
                traceback.print_exc()
                print("\n" + "=" * 70)
                print("⚠️  Models downloaded but verification failed")
                print("=" * 70)
                return False
        else:
            print("\n" + "=" * 70)
            print("❌ Model files not found after download")
            print("=" * 70)
            return False

    except Exception as e:
        print(f"\n❌ Error downloading Kokoro models: {e}")
        import traceback
        traceback.print_exc()
        print("=" * 70)
        return False


if __name__ == "__main__":
    print("\n🎙️  Kokoro TTS Model Pre-Download Script")
    print("     (Docker Build Time)")

    success = download_kokoro_models()

    if success:
        print("\n✅ Docker build can continue - models are baked into image\n")
        sys.exit(0)
    else:
        print("\n❌ FATAL: Model download failed - failing Docker build")
        print("   This ensures models are always pre-loaded in production\n")
        # EXIT WITH ERROR CODE - fail the build if download fails
        # This is critical for production - we want models baked in, not downloaded at runtime
        sys.exit(1)
