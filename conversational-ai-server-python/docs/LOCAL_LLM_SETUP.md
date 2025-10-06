# Local LLM Setup Guide

This guide explains how to set up and use local Large Language Models with your voice AI system. You now have complete freedom from cloud providers and can run everything privately on your own hardware.

## 🎯 **Benefits of Local LLMs**

✅ **Complete Privacy**: All conversations stay on your device
✅ **No API Costs**: Free inference after initial setup
✅ **No Rate Limits**: Use your models as much as you want
✅ **Offline Operation**: Works without internet connection
✅ **Custom Models**: Use specialized or fine-tuned models
✅ **Full Control**: No dependency on third-party services

## 🚀 **Quick Start Options**

Choose the setup that works best for your hardware and needs:

| Option | Best For | Setup Difficulty | Performance |
|--------|----------|------------------|-------------|
| **Ollama** | Beginners, Mac/Linux users | ⭐ Easy | ⭐⭐⭐ Good |
| **llama.cpp** | Advanced users, custom setups | ⭐⭐ Medium | ⭐⭐⭐⭐ Excellent |
| **Hugging Face** | Python developers | ⭐⭐⭐ Advanced | ⭐⭐ Variable |

---

## Option 1: Ollama (Recommended for Beginners)

### **What is Ollama?**
Ollama is the easiest way to run local LLMs. It handles model downloading, quantization, and server management automatically.

### **Installation**

#### **macOS/Linux:**
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

#### **Windows:**
Download from [ollama.ai](https://ollama.ai/download/windows)

### **Getting Models**

Download a model (this will take a few minutes):

```bash
# Small, fast model (4GB) - good for testing
ollama pull llama3.1:8b

# Larger, more capable model (14GB) - better quality
ollama pull llama3.1:70b

# Code-focused model (4GB) - great for programming
ollama pull codellama:7b

# Lightweight model (2GB) - fastest option
ollama pull phi3:mini
```

### **Starting Ollama Server**

```bash
ollama serve
```

The server runs on `http://localhost:11434`

### **Configuration**

Copy the Ollama config:
```bash
cp llm_configs/ollama_config.json llm_config.json
```

Edit `llm_config.json`:
```json
{
  "model": "llama3.1:8b",
  "temperature": 0.7,
  "provider": "ollama",
  "streaming": true,
  "base_url": "http://localhost:11434",
  "context_length": 4096
}
```

### **Verification**

Test that Ollama is working:
```bash
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.1:8b",
  "prompt": "Hello, how are you?",
  "stream": false
}'
```

---

## Option 2: llama.cpp (Best Performance)

### **What is llama.cpp?**
llama.cpp is a high-performance C++ implementation that offers the fastest inference and most control over your models.

### **Installation**

#### **Install Python Bindings:**
```bash
# For CPU only
pip install llama-cpp-python

# For NVIDIA GPU acceleration
CMAKE_ARGS="-DLLAMA_CUBLAS=on" pip install llama-cpp-python

# For Apple M1/M2 Metal acceleration
CMAKE_ARGS="-DLLAMA_METAL=on" pip install llama-cpp-python
```

### **Getting Models**

Download GGUF format models from Hugging Face:

```bash
# Create models directory
mkdir -p models

# Download Llama 3.1 8B (Q4_K_M quantization - good balance)
wget https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf -P models/

# Or use git-lfs for large files
git lfs install
git clone https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF
```

**Popular Models:**
- **Llama 3.1 8B**: Great general-purpose model
- **Mistral 7B**: Excellent performance/size ratio
- **CodeLlama 7B**: Best for code generation
- **Phi-3 Mini**: Lightweight but capable

### **Configuration**

Copy the llama.cpp config:
```bash
cp llm_configs/llamacpp_config.json llm_config.json
```

Edit `llm_config.json`:
```json
{
  "model": "local-llama-model",
  "provider": "llamacpp",
  "model_path": "/full/path/to/models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
  "device": "auto",
  "context_length": 4096,
  "gpu_layers": 35,
  "temperature": 0.7
}
```

**GPU Layers Optimization:**
- **CPU only**: `gpu_layers: 0`
- **Small GPU**: `gpu_layers: 10-20`
- **Large GPU**: `gpu_layers: 35+` (or -1 for all layers)

---

## Option 3: Hugging Face Transformers

### **What is Hugging Face?**
Direct access to thousands of models from the Hugging Face Hub. Great for experimentation but requires more setup.

### **Installation**

```bash
pip install transformers torch

# For NVIDIA GPU support
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# For Apple M1/M2 support
pip install torch torchvision torchaudio
```

### **Configuration**

Copy the Hugging Face config:
```bash
cp llm_configs/huggingface_config.json llm_config.json
```

Edit `llm_config.json`:
```json
{
  "model": "microsoft/DialoGPT-medium",
  "provider": "huggingface",
  "device": "auto",
  "temperature": 0.8,
  "streaming": false
}
```

**Popular Models:**
- `microsoft/DialoGPT-medium` - Conversational
- `facebook/blenderbot-400M-distill` - Chatbot
- `microsoft/DialoGPT-small` - Lightweight
- `facebook/opt-1.3b` - General purpose

---

## 🔧 **Advanced Configuration**

### **Multi-Provider Setup**

You can switch between providers by simply changing the config file:

```bash
# Use Ollama
cp llm_configs/ollama_config.json llm_config.json

# Switch to llama.cpp
cp llm_configs/llamacpp_config.json llm_config.json

# Switch back to OpenAI
cp llm_configs/openai_config.json llm_config.json
```

### **Performance Tuning**

#### **For Ollama:**
```json
{
  "model": "llama3.1:8b",
  "context_length": 8192,  // Increase for longer conversations
  "temperature": 0.1,      // Lower for more focused responses
  "base_url": "http://localhost:11434"
}
```

#### **For llama.cpp:**
```json
{
  "model_path": "/path/to/model.gguf",
  "gpu_layers": -1,        // Use all GPU layers
  "context_length": 8192,  // Larger context window
  "device": "cuda"         // Force GPU usage
}
```

### **Memory Management**

**System Requirements by Model Size:**

| Model Size | RAM Required | GPU VRAM | Best Quantization |
|------------|-------------|----------|-------------------|
| 3B params  | 4GB RAM     | 2GB      | Q4_K_M           |
| 7B params  | 8GB RAM     | 4GB      | Q4_K_M           |
| 13B params | 16GB RAM    | 8GB      | Q4_K_S           |
| 70B params | 64GB RAM    | 24GB     | Q2_K             |

---

## 🧪 **Testing Your Setup**

### **1. Test the LLM Service**

```bash
python test_llm_service.py
```

This will test both streaming and non-streaming responses.

### **2. Interactive Testing**

Create a simple test script:

```python
import asyncio
from message_processing.llm_service import LLMService, LLMMessage

async def test_local_llm():
    llm_service = LLMService(config_path="llm_config.json")

    print(f"Available providers: {llm_service.get_available_providers()}")

    messages = [
        LLMMessage(role="system", content="You are a helpful AI assistant."),
        LLMMessage(role="user", content="What is the capital of France?")
    ]

    response = await llm_service.generate(messages, component_name="test")
    print(f"Response: {response.content}")
    print(f"Provider: {response.provider}")
    print(f"Response time: {response.response_time:.2f}s")

if __name__ == "__main__":
    asyncio.run(test_local_llm())
```

### **3. Integration Testing**

Start your voice AI server and verify local models work:

```bash
python main.py
```

The system will automatically use your configured local model instead of OpenAI.

---

## 🛠️ **Troubleshooting**

### **Common Issues**

#### **"Ollama provider not available"**
- Check Ollama server: `ollama serve`
- Verify model exists: `ollama list`
- Test connection: `curl http://localhost:11434/api/tags`

#### **"model_path is required for llama.cpp"**
- Set full path in config: `"model_path": "/full/path/to/model.gguf"`
- Check file exists: `ls -la /path/to/model.gguf`

#### **"CUDA out of memory"**
- Reduce `gpu_layers` in config
- Use smaller quantized model (Q4_K_S or Q2_K)
- Close other GPU applications

#### **Slow responses**
- Check `gpu_layers` setting
- Use faster quantization (Q4_K_M vs Q8_0)
- Reduce `context_length`

### **Performance Optimization**

#### **CPU Optimization:**
```json
{
  "device": "cpu",
  "gpu_layers": 0,
  "context_length": 2048
}
```

#### **GPU Optimization:**
```json
{
  "device": "cuda",
  "gpu_layers": -1,
  "context_length": 4096
}
```

#### **Memory Constrained:**
```json
{
  "model": "phi3:mini",
  "context_length": 1024,
  "max_tokens": 200
}
```

---

## 📊 **Model Recommendations**

### **For Different Use Cases:**

#### **💬 General Chat (8GB+ RAM)**
- **Ollama**: `llama3.1:8b`
- **llama.cpp**: Llama-3.1-8B-Instruct-Q4_K_M.gguf
- **HuggingFace**: microsoft/DialoGPT-medium

#### **⚡ Fast Responses (4GB RAM)**
- **Ollama**: `phi3:mini` or `llama3.1:8b`
- **llama.cpp**: Phi-3-mini-Q4_K_M.gguf
- **HuggingFace**: microsoft/DialoGPT-small

#### **🔧 Code Generation**
- **Ollama**: `codellama:7b`
- **llama.cpp**: CodeLlama-7B-Instruct-Q4_K_M.gguf
- **HuggingFace**: microsoft/CodeGPT-small-py

#### **🖥️ Resource Constrained (2GB RAM)**
- **Ollama**: `phi3:mini`
- **llama.cpp**: TinyLlama-1.1B-Q4_K_M.gguf
- **HuggingFace**: microsoft/DialoGPT-small

---

## 🔐 **Security & Privacy**

### **Benefits of Local Models:**
- **No data leaves your device** - complete privacy
- **No logging** - conversations aren't stored remotely
- **No rate limiting** - use as much as you want
- **Offline capable** - works without internet

### **Best Practices:**
- Keep models updated for security patches
- Use strong local authentication
- Consider disk encryption for sensitive use cases
- Monitor system resource usage

---

## 🔄 **Switching Between Providers**

The beauty of the unified LLM service is you can switch providers instantly:

```bash
# Morning: Use fast local model for testing
cp llm_configs/ollama_config.json llm_config.json

# Afternoon: Switch to high-quality model for production
cp llm_configs/llamacpp_config.json llm_config.json

# Evening: Fall back to cloud model for complex tasks
cp llm_configs/openai_config.json llm_config.json
```

**No code changes required!** 🎉

---

## 📈 **Performance Benchmarks**

Typical performance on different hardware:

### **MacBook M2 Pro (16GB RAM)**
- **Llama 3.1 8B (Q4_K_M)**: ~25 tokens/sec
- **Phi-3 Mini**: ~45 tokens/sec
- **CodeLlama 7B**: ~22 tokens/sec

### **RTX 4090 (24GB VRAM)**
- **Llama 3.1 8B (Q4_K_M)**: ~80 tokens/sec
- **Llama 3.1 70B (Q4_K_M)**: ~15 tokens/sec
- **Mistral 7B (Q4_K_M)**: ~85 tokens/sec

### **Intel i7 + 32GB RAM (CPU only)**
- **Llama 3.1 8B (Q4_K_M)**: ~8 tokens/sec
- **Phi-3 Mini**: ~15 tokens/sec
- **TinyLlama 1.1B**: ~45 tokens/sec

---

## 🎉 **You're Ready!**

Congratulations! You now have a completely local AI system that:

✅ Runs entirely on your hardware
✅ Costs nothing per request
✅ Protects your privacy completely
✅ Works offline
✅ Can be customized to your needs

Start with Ollama for the easiest setup, then explore llama.cpp for maximum performance. You can always switch between providers as your needs change!

**Happy local AI chatting!** 🤖✨