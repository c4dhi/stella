# Sherpa-ONNX Model Setup

## Problem
By default, the Sherpa-ONNX model is downloaded every time the Docker container starts, which:
- Takes several minutes on each startup
- Uses unnecessary bandwidth
- Slows down development iteration

## Solution
The model is now persisted locally and mounted as a Docker volume.

## Initial Setup (One-time)

### Option 1: Automatic Download (Recommended)
Run the provided script to download the model:

```bash
python3 download_sherpa_model.py
```

This will:
1. Download the model (~180MB)
2. Extract it to `./sherpa-models/`
3. Verify all required files are present

### Option 2: Manual Download
If you prefer to download manually:

```bash
# Create the models directory
mkdir -p sherpa-models

# Download the model
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-21.tar.bz2

# Extract to the sherpa-models directory
tar -xjf sherpa-onnx-streaming-zipformer-en-2023-06-21.tar.bz2 -C sherpa-models/

# Clean up the archive
rm sherpa-onnx-streaming-zipformer-en-2023-06-21.tar.bz2
```

## How It Works

1. **Docker Volume Mount**: The `docker-compose.yml` now includes:
   ```yaml
   volumes:
     - ./sherpa-models:/root/.cache/sherpa-onnx
   ```
   This mounts the local `sherpa-models` directory to the container's cache directory.

2. **Model Check**: The application checks if the model exists at startup:
   - If present: Uses the existing model immediately
   - If missing: Downloads it (this should only happen if you haven't run the setup)

3. **Persistence**: The model persists between container restarts, rebuilds, and even complete removals.

## Benefits
- ✅ No repeated downloads
- ✅ Instant container startup
- ✅ Works offline after initial setup
- ✅ Survives container rebuilds
- ✅ Model shared across multiple container instances

## Troubleshooting

If the model is still being downloaded on startup:

1. Check if the model directory exists:
   ```bash
   ls -la sherpa-models/sherpa-onnx-streaming-zipformer-en-2023-06-21/
   ```

2. Verify all required files are present:
   - encoder-epoch-99-avg-1.onnx
   - decoder-epoch-99-avg-1.onnx
   - joiner-epoch-99-avg-1.onnx
   - tokens.txt

3. Ensure Docker has permission to read the files:
   ```bash
   chmod -R 755 sherpa-models/
   ```

4. Rebuild the container:
   ```bash
   docker-compose down
   docker-compose up --build
   ```

## Notes
- The `sherpa-models/` directory is in `.gitignore` to avoid committing large binary files
- The model is about 180MB when extracted
- The model supports English speech recognition with reasonable accuracy