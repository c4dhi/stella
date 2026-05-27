#!/bin/bash
# =============================================================================
# variables.sh - Variable definitions and metadata for configuration wizard
# =============================================================================
# Compatible with bash 3.2+ (macOS default)
# Uses functions instead of associative arrays for compatibility
# =============================================================================

# =============================================================================
# Variable Categories (in wizard display order)
# =============================================================================

VAR_CATEGORIES=(
    "database"
    "security"
    "livekit"
    "ai_apis"
    "stt"
    "tts"
    "gpu"
    "kubernetes"
    "production"
)

# Get category display name
get_category_name() {
    case "$1" in
        database)    echo "Database Configuration" ;;
        security)    echo "Security Settings" ;;
        livekit)     echo "LiveKit WebRTC" ;;
        ai_apis)     echo "AI API Keys" ;;
        stt)         echo "Speech-to-Text" ;;
        tts)         echo "Text-to-Speech" ;;
        gpu)         echo "GPU Acceleration" ;;
        kubernetes)  echo "Kubernetes Settings" ;;
        production)  echo "Production Settings" ;;
        credentials) echo "Essential Credentials" ;;
        *)           echo "$1" ;;
    esac
}

# Get category icon
get_category_icon() {
    case "$1" in
        database)    echo "🗄️" ;;
        security)    echo "🔐" ;;
        livekit)     echo "🌐" ;;
        ai_apis)     echo "🤖" ;;
        stt)         echo "🎤" ;;
        tts)         echo "🔊" ;;
        gpu)         echo "⚡" ;;
        kubernetes)  echo "☸️" ;;
        production)  echo "🚀" ;;
        credentials) echo "🔑" ;;
        *)           echo "⚙️" ;;
    esac
}

# Get category description
get_category_description() {
    case "$1" in
        database)    echo "Configure PostgreSQL database connection" ;;
        security)    echo "JWT tokens and encryption keys" ;;
        livekit)     echo "WebRTC server for real-time voice" ;;
        ai_apis)     echo "OpenAI and other API credentials" ;;
        stt)         echo "Speech recognition settings" ;;
        tts)         echo "Voice synthesis settings" ;;
        gpu)         echo "CUDA and GPU acceleration" ;;
        kubernetes)  echo "K8s namespace and DNS settings" ;;
        production)  echo "Production domain and TURN server" ;;
        credentials) echo "API keys and secrets required to run" ;;
        *)           echo "" ;;
    esac
}

# =============================================================================
# Variable Metadata
# Format: "category|type|required|default_local|default_prod|description|options|generator"
# =============================================================================

# Get metadata for a variable
# Returns pipe-separated: category|type|required|default_local|default_prod|description|options|generator
get_var_metadata() {
    case "$1" in
        # --- DATABASE ---
        POSTGRES_DB)           echo "database|text|both|session_management|session_management|PostgreSQL database name||" ;;
        POSTGRES_USER)         echo "database|text|both|postgres|postgres|PostgreSQL username||" ;;
        POSTGRES_PASSWORD)     echo "database|password|both|||Secure database password||" ;;

        # --- SECURITY ---
        JWT_SECRET)            echo "security|generated|both|||JWT signing secret (64+ chars)||openssl rand -base64 48" ;;
        ENV_VAR_ENCRYPTION_KEY) echo "security|generated|both|||Encryption key for stored env vars (64 hex chars)||openssl rand -hex 32" ;;

        # --- LIVEKIT ---
        LIVEKIT_API_KEY)       echo "livekit|text|both|devkey||LiveKit API key||" ;;
        LIVEKIT_API_SECRET)    echo "livekit|password|both|devsecret_devsecret_devsecret_32!!||LiveKit API secret||" ;;
        LIVEKIT_URL)           echo "livekit|text|both|ws://host.docker.internal:7880||Internal LiveKit URL (for K8s pods)||" ;;
        PUBLIC_LIVEKIT_URL)    echo "livekit|text|both|ws://localhost:7880||Public LiveKit URL (for browsers)||" ;;
        LIVEKIT_TURN_ENABLED)  echo "livekit|boolean|optional|false|true|Enable TURN server for NAT traversal||" ;;
        LIVEKIT_TURN_DOMAIN)   echo "livekit|text|optional|||TURN server domain (e.g. turn.example.com)||" ;;

        # --- AI APIs ---
        OPENAI_API_KEY)        echo "ai_apis|password|both|||OpenAI API key for agents||" ;;
        OPENAI_PLAN_GENERATOR_API_KEY) echo "ai_apis|password|optional|||Separate OpenAI key for plan generation||" ;;
        ELEVENLABS_API_KEY)    echo "ai_apis|password|optional|||ElevenLabs API key (for premium TTS)||" ;;

        # --- STT ---
        STT_PROVIDER)          echo "stt|select|optional|sherpa|whisper|Speech-to-text engine|sherpa,whisper|" ;;
        WHISPER_MODEL)         echo "stt|select|optional|base.en|large-v3|Whisper model size|tiny.en,base.en,small.en,medium.en,tiny,base,small,medium,large-v3|" ;;
        WHISPER_DEVICE)        echo "stt|select|optional|cpu|cuda|Whisper compute device|cpu,cuda|" ;;
        WHISPER_COMPUTE_TYPE)  echo "stt|select|optional|int8|float16|Whisper precision|int8,float16,float32|" ;;
        WHISPER_BEAM_SIZE)     echo "stt|text|optional|5|3|Whisper beam search size||" ;;
        WHISPER_LANGUAGE)      echo "stt|text|optional|||Language code (empty for auto-detect)||" ;;
        VAD_THRESHOLD)         echo "stt|text|optional|0.5|0.35|Voice activity detection threshold (0-1)||" ;;
        VAD_SILENCE_DURATION_MS) echo "stt|text|optional|800|500|Silence before MAYBE_ENDING state (ms)||" ;;
        VAD_CONTINUATION_WINDOW_MS) echo "stt|text|optional|1000|600|Time for speech to resume in MAYBE_ENDING (ms)||" ;;
        VAD_MAX_ENDPOINTING_DELAY_MS) echo "stt|text|optional|2000|2000|Hard cutoff for endpointing delay (ms)||" ;;
        VAD_MIN_SPEECH_MS)     echo "stt|text|optional|500|200|Min speech duration (ms)||" ;;
        VAD_MAX_SPEECH_DURATION_MS) echo "stt|text|optional|30000|30000|Force endpoint after this speech duration (ms)||" ;;
        VAD_AUDIO_INACTIVITY_TIMEOUT_MS) echo "stt|text|optional|1500|1500|Force endpoint on audio inactivity (ms)||" ;;
        VAD_RMS_THRESHOLD)     echo "stt|text|optional|0.008|0.01|Energy gate for background noise filtering||" ;;
        PARTIAL_INTERVAL_MS)   echo "stt|text|optional|1000|500|Partial transcript interval (ms)||" ;;

        # --- TTS ---
        TTS_PROVIDER)          echo "tts|select|optional|piper|kokoro|Text-to-speech engine|piper,kokoro,chatterbox,voxtral,elevenlabs,auto|" ;;
        ELEVENLABS_VOICE_ID)   echo "tts|text|optional|Xb7hH8MSUJpSbSDYk0k2|Xb7hH8MSUJpSbSDYk0k2|ElevenLabs voice ID||" ;;
        ELEVENLABS_MODEL_ID)   echo "tts|text|optional|eleven_turbo_v2_5|eleven_turbo_v2_5|ElevenLabs model||" ;;
        ELEVENLABS_STABILITY)  echo "tts|text|optional|0.5|0.5|Voice stability (0-1)||" ;;
        ELEVENLABS_SIMILARITY_BOOST) echo "tts|text|optional|0.8|0.8|Voice similarity boost (0-1)||" ;;
        ENABLE_VOXTRAL)        echo "tts|boolean|optional|false|false|Install Voxtral inference deps in tts-service image (Apache-2.0). Auto-enabled when TTS_PROVIDER=voxtral.||" ;;
        VOXTRAL_MODEL_ID)      echo "tts|text|optional|mistralai/Voxtral-4B-TTS-2603|mistralai/Voxtral-4B-TTS-2603|HuggingFace model ID for Voxtral weights||" ;;
        VOXTRAL_DTYPE)         echo "tts|select|optional||bfloat16|Voxtral inference dtype (blank = auto per device: bf16 on Ampere+ GPUs, fp16 on MPS/T4, fp32 on CPU)|,bfloat16,float16,float32|" ;;
        VOXTRAL_ACCEPT_NC_LICENSE) echo "tts|boolean|optional|false|false|I acknowledge the Voxtral weights are licensed CC-BY-NC-4.0 (NON-COMMERCIAL only). Setting this to true grants STELLA's init container permission to download them on my behalf.||" ;;

        # --- GPU ---
        ENABLE_GPU)            echo "gpu|boolean|optional|false|true|Enable CUDA GPU acceleration||" ;;
        ONNX_PROVIDER)         echo "gpu|select|optional|CPUExecutionProvider|CUDAExecutionProvider,CPUExecutionProvider|ONNX Runtime provider|CPUExecutionProvider,CUDAExecutionProvider+CPUExecutionProvider|" ;;

        # --- KUBERNETES ---
        KUBERNETES_NAMESPACE)  echo "kubernetes|text|optional|ai-agents|ai-agents|K8s namespace for deployment||" ;;
        CUSTOM_DNS_SERVERS)    echo "kubernetes|text|optional||8.8.8.8 8.8.4.4|Custom DNS servers to bypass SSL inspection||" ;;
        AUTO_DETECT_K8S_DNS)   echo "kubernetes|boolean|optional|false|false|Auto-detect CoreDNS IP||" ;;
        KUBERNETES_DNS_NAMESERVER) echo "kubernetes|text|optional|10.96.0.10|10.96.0.10|Fallback K8s DNS IP||" ;;

        # --- PRODUCTION ---
        PRODUCTION_DOMAIN)     echo "production|text|production|||Your production domain (e.g. example.com)||" ;;
        STELLA_AI_TEMP_DIR)    echo "production|text|optional||/mnt/stella-ai-temp|Temp directory for large builds/logs||" ;;

        *) echo "" ;;
    esac
}

# List of all known variables
ALL_VARIABLES=(
    "POSTGRES_DB"
    "POSTGRES_USER"
    "POSTGRES_PASSWORD"
    "JWT_SECRET"
    "ENV_VAR_ENCRYPTION_KEY"
    "LIVEKIT_API_KEY"
    "LIVEKIT_API_SECRET"
    "LIVEKIT_URL"
    "PUBLIC_LIVEKIT_URL"
    "LIVEKIT_TURN_ENABLED"
    "LIVEKIT_TURN_DOMAIN"
    "OPENAI_API_KEY"
    "OPENAI_PLAN_GENERATOR_API_KEY"
    "ELEVENLABS_API_KEY"
    "STT_PROVIDER"
    "WHISPER_MODEL"
    "WHISPER_DEVICE"
    "WHISPER_COMPUTE_TYPE"
    "WHISPER_BEAM_SIZE"
    "WHISPER_LANGUAGE"
    "VAD_THRESHOLD"
    "VAD_SILENCE_DURATION_MS"
    "VAD_CONTINUATION_WINDOW_MS"
    "VAD_MAX_ENDPOINTING_DELAY_MS"
    "VAD_MIN_SPEECH_MS"
    "VAD_MAX_SPEECH_DURATION_MS"
    "VAD_AUDIO_INACTIVITY_TIMEOUT_MS"
    "VAD_RMS_THRESHOLD"
    "PARTIAL_INTERVAL_MS"
    "TTS_PROVIDER"
    "ELEVENLABS_VOICE_ID"
    "ELEVENLABS_MODEL_ID"
    "ELEVENLABS_STABILITY"
    "ELEVENLABS_SIMILARITY_BOOST"
    "ENABLE_VOXTRAL"
    "VOXTRAL_MODEL_ID"
    "VOXTRAL_DTYPE"
    "VOXTRAL_ACCEPT_NC_LICENSE"
    "ENABLE_GPU"
    "ONNX_PROVIDER"
    "KUBERNETES_NAMESPACE"
    "CUSTOM_DNS_SERVERS"
    "AUTO_DETECT_K8S_DNS"
    "KUBERNETES_DNS_NAMESERVER"
    "PRODUCTION_DOMAIN"
    "STELLA_AI_TEMP_DIR"
)

# =============================================================================
# Helper Functions
# =============================================================================

# Get metadata field for a variable
# Usage: get_var_meta "VAR_NAME" "field_name"
get_var_meta() {
    local var_name="$1"
    local field="$2"
    local meta
    meta=$(get_var_metadata "$var_name")

    if [[ -z "$meta" ]]; then
        echo ""
        return 1
    fi

    # Parse pipe-separated fields
    local IFS='|'
    set -- $meta

    case "$field" in
        category)      echo "${1:-}" ;;
        type)          echo "${2:-}" ;;
        required)      echo "${3:-}" ;;
        default_local) echo "${4:-}" ;;
        default_prod)  echo "${5:-}" ;;
        description)   echo "${6:-}" ;;
        options)       echo "${7:-}" ;;
        generator)     echo "${8:-}" ;;
        *)             echo "" ;;
    esac
}

# Get all variables in a category
# Usage: get_category_vars "database"
get_category_vars() {
    local category="$1"

    for var_name in "${ALL_VARIABLES[@]}"; do
        local var_cat
        var_cat=$(get_var_meta "$var_name" "category")
        if [[ "$var_cat" == "$category" ]]; then
            echo "$var_name"
        fi
    done
}

# Return 0 (true) when a variable should be skipped in the wizard given the
# currently-selected values. Provider-specific knobs are noise unless the
# user picked that provider — most importantly, the CC-BY-NC license
# acknowledgement should only appear when the user has actually chosen
# Voxtral. The caller passes the current TTS_PROVIDER value so this helper
# works for both wizard implementations.
# Usage: should_skip_wizard_var "VAR_NAME" "current_tts_provider"
should_skip_wizard_var() {
    local var_name="$1"
    local tts_provider="${2:-}"

    case "$var_name" in
        ENABLE_VOXTRAL|VOXTRAL_*)
            [[ "$tts_provider" != "voxtral" ]] && return 0
            ;;
    esac
    return 1
}

# Check if variable is required for given environment
# Usage: is_var_required "VAR_NAME" "local|production"
is_var_required() {
    local var_name="$1"
    local env="$2"
    local required
    required=$(get_var_meta "$var_name" "required")

    case "$required" in
        both)       return 0 ;;
        production) [[ "$env" == "production" ]] && return 0 ;;
        optional)   return 1 ;;
    esac
    return 1
}

# Get default value for variable based on environment
# Usage: get_var_default "VAR_NAME" "local|production"
get_var_default() {
    local var_name="$1"
    local env="$2"

    if [[ "$env" == "production" ]]; then
        local prod_default
        prod_default=$(get_var_meta "$var_name" "default_prod")
        if [[ -n "$prod_default" ]]; then
            echo "$prod_default"
            return
        fi
    fi

    # Fall back to local default
    get_var_meta "$var_name" "default_local"
}

# Get all required variables for an environment
# Usage: get_required_vars "local|production"
get_required_vars() {
    local env="$1"

    for var_name in "${ALL_VARIABLES[@]}"; do
        if is_var_required "$var_name" "$env"; then
            echo "$var_name"
        fi
    done
}

# Get options as array for select type
# Usage: get_var_options "STT_PROVIDER"
get_var_options() {
    local var_name="$1"
    local options_str
    options_str=$(get_var_meta "$var_name" "options")

    if [[ -n "$options_str" ]]; then
        echo "$options_str" | tr ',' '\n'
    fi
}

# Generate value for generated type
# Usage: generate_var_value "JWT_SECRET"
generate_var_value() {
    local var_name="$1"
    local generator
    generator=$(get_var_meta "$var_name" "generator")

    if [[ -n "$generator" ]]; then
        eval "$generator" 2>/dev/null
    fi
}

# Get description for a select option
# Usage: get_option_description "STT_PROVIDER" "sherpa"
get_option_description() {
    local var_name="$1"
    local option="$2"

    case "${var_name}:${option}" in
        # STT Provider
        STT_PROVIDER:sherpa)  echo "Lightweight CPU model (~180MB, fast startup)" ;;
        STT_PROVIDER:whisper) echo "GPU-accelerated (large-v3 ~3GB, best accuracy)" ;;

        # TTS Provider
        TTS_PROVIDER:piper)      echo "Fast local TTS via Piper (CPU-friendly)" ;;
        TTS_PROVIDER:kokoro)     echo "Fast local TTS (50-100ms, GPU-accelerated)" ;;
        TTS_PROVIDER:chatterbox) echo "Local multilingual TTS (EN/DE, GPU recommended)" ;;
        TTS_PROVIDER:voxtral)    echo "Local Voxtral 4B TTS (GPU required; CC-BY-NC-4.0 weights, operator-supplied)" ;;
        TTS_PROVIDER:elevenlabs) echo "Premium cloud TTS (best quality, costs apply)" ;;
        TTS_PROVIDER:auto)       echo "Automatic fallback chain" ;;

        # Whisper models
        WHISPER_MODEL:tiny.en)   echo "Fastest, English only (~75MB)" ;;
        WHISPER_MODEL:base.en)   echo "Fast, English only (~150MB)" ;;
        WHISPER_MODEL:small.en)  echo "Balanced, English only (~500MB)" ;;
        WHISPER_MODEL:medium.en) echo "High quality, English only (~1.5GB)" ;;
        WHISPER_MODEL:tiny)      echo "Fastest, multilingual (~75MB)" ;;
        WHISPER_MODEL:base)      echo "Fast, multilingual (~150MB)" ;;
        WHISPER_MODEL:small)     echo "Balanced, multilingual (~500MB)" ;;
        WHISPER_MODEL:medium)    echo "High quality, multilingual (~1.5GB)" ;;
        WHISPER_MODEL:large-v3)  echo "Best accuracy, multilingual (~3GB)" ;;

        # Device
        WHISPER_DEVICE:cpu)  echo "CPU inference (slower but universal)" ;;
        WHISPER_DEVICE:cuda) echo "NVIDIA GPU inference (fast, requires GPU)" ;;

        # Compute type
        WHISPER_COMPUTE_TYPE:int8)    echo "8-bit quantized (fastest, lowest memory)" ;;
        WHISPER_COMPUTE_TYPE:float16) echo "16-bit float (balanced, GPU recommended)" ;;
        WHISPER_COMPUTE_TYPE:float32) echo "32-bit float (highest precision)" ;;

        # ONNX
        ONNX_PROVIDER:CPUExecutionProvider) echo "CPU only (universal)" ;;
        "ONNX_PROVIDER:CUDAExecutionProvider,CPUExecutionProvider") echo "GPU with CPU fallback" ;;

        *) echo "" ;;
    esac
}
