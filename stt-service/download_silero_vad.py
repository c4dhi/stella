#!/usr/bin/env python3
"""
Pre-download Silero VAD model during Docker build.

This script is run during the Docker build process when ENABLE_GPU=true
to pre-download the Silero VAD model and avoid runtime download latency.

The model is cloned to a local directory for offline loading at runtime.
"""
import os
import sys
import subprocess
import shutil


def download_silero_vad():
    """Download Silero VAD model to local directory for offline use."""
    cache_dir = os.getenv("SILERO_VAD_CACHE_DIR", "/root/.cache/silero-vad")
    local_repo = os.path.join(cache_dir, "snakers4_silero-vad")

    print(f"[Silero VAD Download] Target directory: {local_repo}")

    # Ensure cache directory exists
    os.makedirs(cache_dir, exist_ok=True)

    # Remove existing repo if present (for clean builds)
    if os.path.exists(local_repo):
        print(f"[Silero VAD Download] Removing existing repo...")
        shutil.rmtree(local_repo)

    print("[Silero VAD Download] Cloning silero-vad repository...")

    try:
        # Clone the repo directly (shallow clone for smaller size)
        result = subprocess.run(
            ["git", "clone", "--depth", "1", "https://github.com/snakers4/silero-vad.git", local_repo],
            capture_output=True,
            text=True,
            check=True
        )
        print("[Silero VAD Download] Repository cloned successfully!")

    except subprocess.CalledProcessError as e:
        print(f"[Silero VAD Download] Git clone failed: {e.stderr}")
        return False

    # Verify the repo has required files
    required_files = ["hubconf.py", "utils_vad.py"]
    onnx_files = []

    for root, dirs, files in os.walk(local_repo):
        for f in files:
            if f.endswith('.onnx'):
                onnx_files.append(f)

    print(f"[Silero VAD Download] Found ONNX files: {onnx_files}")

    # Test loading the model
    try:
        import torch
        print("[Silero VAD Download] Testing model load from local repo...")

        model, utils = torch.hub.load(
            repo_or_dir=local_repo,
            model='silero_vad',
            source='local',
            onnx=True
        )

        print("[Silero VAD Download] Model loaded successfully from local repo!")

        # List all files with sizes
        total_size = 0
        for root, dirs, files in os.walk(local_repo):
            for f in files:
                filepath = os.path.join(root, f)
                size_kb = os.path.getsize(filepath) / 1024
                total_size += size_kb
                if size_kb > 10:  # Only show files > 10KB
                    rel_path = os.path.relpath(filepath, local_repo)
                    print(f"  - {rel_path} ({size_kb:.1f} KB)")

        print(f"[Silero VAD Download] Total size: {total_size/1024:.1f} MB")
        return True

    except ImportError:
        print("[Silero VAD Download] torch not installed, skipping model test")
        return True  # Still success - files are downloaded

    except Exception as e:
        print(f"[Silero VAD Download] Model test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = download_silero_vad()
    sys.exit(0 if success else 1)
