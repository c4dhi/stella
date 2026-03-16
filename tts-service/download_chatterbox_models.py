#!/usr/bin/env python3
"""
Pre-download ChatterBox Multilingual TTS models.

Downloads the ChatterBox multilingual model files (~2GB total)
to a local cache directory so they don't need to be fetched at runtime.
Uses huggingface_hub snapshot_download, matching what from_pretrained() does.
"""

import os
import sys
import time


REPO_ID = "ResembleAI/chatterbox"
ALLOW_PATTERNS = [
    "ve.pt",
    "t3_mtl23ls_v2.safetensors",
    "s3gen.pt",
    "grapheme_mtl_merged_expanded_v1.json",
    "conds.pt",
    "Cangjie5_TC.json",
]


def download_chatterbox_models(max_retries: int = 5) -> bool:
    """Download ChatterBox multilingual TTS models."""
    try:
        from huggingface_hub import snapshot_download

        print("=" * 60)
        print("ChatterBox Multilingual TTS Model Downloader")
        print("=" * 60)

        cache_dir = os.getenv('CHATTERBOX_CACHE_DIR', '/root/.cache/chatterbox')
        os.makedirs(cache_dir, exist_ok=True)

        print(f"\nCache directory: {cache_dir}")
        print(f"Repository: {REPO_ID}")
        print(f"Files: {', '.join(ALLOW_PATTERNS)}")

        for attempt in range(1, max_retries + 1):
            try:
                if attempt > 1:
                    print(f"\nRetry attempt {attempt}/{max_retries}")

                print("\nDownloading ChatterBox multilingual model...")
                ckpt_dir = snapshot_download(
                    repo_id=REPO_ID,
                    repo_type="model",
                    revision="main",
                    allow_patterns=ALLOW_PATTERNS,
                    local_dir=cache_dir,
                    token=os.getenv("HF_TOKEN"),
                )

                # Verify all files exist
                missing = []
                total_size = 0
                for pattern in ALLOW_PATTERNS:
                    fpath = os.path.join(cache_dir, pattern)
                    if os.path.exists(fpath):
                        size = os.path.getsize(fpath)
                        total_size += size
                        print(f"  {pattern}: {size / (1024 * 1024):.1f} MB")
                    else:
                        missing.append(pattern)

                if missing:
                    print(f"\nMissing files: {missing}")
                    if attempt < max_retries:
                        wait_time = 10 * attempt
                        print(f"Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    return False

                print(f"\n{'=' * 60}")
                print(f"Total: {total_size / (1024 * 1024):.1f} MB")
                print(f"{'=' * 60}")
                print("SUCCESS: ChatterBox multilingual models ready!")
                return True

            except Exception as e:
                error_msg = str(e)
                print(f"\nDownload failed (attempt {attempt}/{max_retries}): {error_msg}")

                if attempt < max_retries:
                    is_retryable = any(x in error_msg.lower() for x in [
                        '503', 'timeout', 'connection', 'network', 'retry'
                    ])
                    if is_retryable:
                        wait_time = 10 * attempt
                        print(f"Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                    else:
                        return False

        return False

    except ImportError:
        print("ERROR: huggingface_hub not installed. Run: pip install huggingface_hub")
        return False
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    print("\nChatterBox Multilingual TTS Model Pre-Download Script\n")
    success = download_chatterbox_models()
    sys.exit(0 if success else 1)
