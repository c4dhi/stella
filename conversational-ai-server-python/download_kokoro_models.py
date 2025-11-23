#!/usr/bin/env python3
"""
Pre-download Kokoro TTS models during Docker build.

This script downloads the Kokoro ONNX model and voice files (~1GB total)
so they're baked into the Docker image and don't need to be downloaded
at runtime.
"""

import os
import sys


def download_kokoro_models():
    """Download Kokoro TTS models."""
    try:
        print("=" * 60)
        print("Downloading Kokoro TTS models...")
        print("=" * 60)

        # Import kokoro after ensuring it's installed
        try:
            from kokoro_onnx import Kokoro
        except ImportError:
            print("ERROR: kokoro-onnx not installed")
            print("Install with: pip install kokoro-onnx")
            return False

        # Set model paths
        cache_dir = os.getenv('KOKORO_CACHE_DIR', '/root/.cache/kokoro')
        os.makedirs(cache_dir, exist_ok=True)

        model_path = os.path.join(cache_dir, 'kokoro-v1.0.onnx')
        voices_path = os.path.join(cache_dir, 'voices-v1.0.bin')

        print(f"Model cache directory: {cache_dir}")
        print(f"Model path: {model_path}")
        print(f"Voices path: {voices_path}")

        # Initialize Kokoro (this will download models if they don't exist)
        print("\nInitializing Kokoro TTS engine...")
        print("This will download ~800MB model + ~200MB voices...")

        kokoro = Kokoro(model_path, voices_path)

        # Verify models were downloaded
        if os.path.exists(model_path) and os.path.exists(voices_path):
            model_size = os.path.getsize(model_path) / (1024 * 1024)  # MB
            voices_size = os.path.getsize(voices_path) / (1024 * 1024)  # MB

            print(f"\n✅ Kokoro models downloaded successfully!")
            print(f"   - Model: {model_size:.1f} MB")
            print(f"   - Voices: {voices_size:.1f} MB")
            print(f"   - Total: {model_size + voices_size:.1f} MB")

            # Test synthesis to ensure everything works
            print("\nTesting Kokoro TTS synthesis...")
            test_text = "Kokoro text to speech initialized successfully."
            audio, sample_rate = kokoro.create(test_text, voice="af_sky")

            if audio is not None and len(audio) > 0:
                print(f"✅ Synthesis test successful! Generated {len(audio)} audio samples at {sample_rate}Hz")
                return True
            else:
                print("❌ Synthesis test failed - no audio generated")
                return False
        else:
            print("❌ Model files not found after download")
            return False

    except Exception as e:
        print(f"❌ Error downloading Kokoro models: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("\n🎙️  Kokoro TTS Model Downloader")
    print("=" * 60)

    success = download_kokoro_models()

    print("=" * 60)
    if success:
        print("✅ Kokoro TTS models ready for use!")
        print("=" * 60)
        sys.exit(0)
    else:
        print("❌ Failed to download Kokoro models")
        print("TTS will fall back to Edge TTS if Kokoro is unavailable")
        print("=" * 60)
        # Don't fail the build - just warn
        # Kokoro is optional, Edge TTS can be used as fallback
        sys.exit(0)
