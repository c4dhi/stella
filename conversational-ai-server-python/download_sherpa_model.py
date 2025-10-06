#!/usr/bin/env python3
"""
Script to pre-download the Sherpa-ONNX model to avoid downloading it on every container startup.
Run this script once to download the model to the local sherpa-models directory.
"""

import os
import urllib.request
import tarfile
import shutil

def download_sherpa_model():
    """Download and extract the Sherpa-ONNX model."""

    # Model configuration
    model_name = "sherpa-onnx-streaming-zipformer-en-2023-06-21"
    model_url = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{model_name}.tar.bz2"

    # Setup directories - use local directory instead of home cache
    cache_dir = "./sherpa-models"
    os.makedirs(cache_dir, exist_ok=True)
    model_dir = os.path.join(cache_dir, model_name)

    # Check if model already exists
    if os.path.exists(model_dir):
        required_files = ["encoder-epoch-99-avg-1.onnx",
                         "decoder-epoch-99-avg-1.onnx",
                         "joiner-epoch-99-avg-1.onnx",
                         "tokens.txt"]

        # Verify all required files exist
        files_exist = all(os.path.exists(os.path.join(model_dir, f)) for f in required_files)

        if files_exist:
            print(f"✅ Model already downloaded at: {model_dir}")
            print("No need to download again.")
            return model_dir
        else:
            print(f"⚠️  Model directory exists but incomplete, re-downloading...")
            shutil.rmtree(model_dir)

    print(f"📥 Downloading Sherpa-ONNX model: {model_name}")
    print(f"   From: {model_url}")
    print("   This may take a few minutes...")

    # Download model
    archive_path = os.path.join(cache_dir, f"{model_name}.tar.bz2")
    urllib.request.urlretrieve(model_url, archive_path)
    print("✅ Download completed!")

    print("📦 Extracting model...")
    # Extract model
    with tarfile.open(archive_path, 'r:bz2') as tar:
        tar.extractall(cache_dir)

    # Clean up archive
    os.remove(archive_path)
    print("✅ Extraction completed!")

    print(f"\n✨ Model successfully installed at: {model_dir}")
    print("\nThe model will now be persisted between Docker container restarts.")

    return model_dir

if __name__ == "__main__":
    print("=" * 60)
    print("Sherpa-ONNX Model Downloader")
    print("=" * 60)
    print()

    try:
        model_path = download_sherpa_model()
        print("\n" + "=" * 60)
        print("Setup complete! You can now run docker-compose up")
        print("The model will be mounted from the local directory.")
        print("=" * 60)
    except Exception as e:
        print(f"\n❌ Error downloading model: {e}")
        print("Please check your internet connection and try again.")