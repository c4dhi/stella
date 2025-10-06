# Testing Suite with Mock LLM Integration

This testing suite provides comprehensive testing capabilities with automatic LLM provider management, allowing you to test the state machine system without using real LLM API calls.

## 🚀 Quick Start

1. **Setup test environment:**
   ```bash
   python setup_test_environment.py
   ```

2. **Run all tests with mock LLM:**
   ```bash
   python run_tests.py
   ```

3. **Your original LLM configuration is automatically restored after tests!**

## 📋 Features

### ✅ Automatic LLM Provider Switching
- **Before tests**: Backs up your current `llm_config.json`
- **During tests**: Uses mock LLM provider (no API calls, no costs)
- **After tests**: Restores your original configuration automatically

### ✅ Comprehensive Mock Responses
- Pre-configured responses for state machine testing
- Deliverable detection simulation
- Conversation flow responses
- Customizable response sets

### ✅ Multiple Test Suites
- **State Machine Flow Tests**: Core state machine functionality
- **Mock LLM Integration Tests**: Full system testing with mock responses
- **Processing Mode Tests**: STRICT vs LOOSE state behavior
- **Task Manager Integration Tests**: Complete workflow testing

## 🧪 Running Tests

### Basic Commands

```bash
# Run all tests (uses mock LLM automatically)
python run_tests.py

# Run specific test suites
python run_tests.py --state-machine    # State machine tests only
python run_tests.py --mock-llm         # Mock LLM integration tests only

# Run with verbose output
python run_tests.py -v

# Run specific test file
python run_tests.py --file tests/test_specific.py
```

### Advanced Options

```bash
# Use real LLM instead of mock (will use your configured provider)
python run_tests.py --use-real-llm

# Keep mock configuration after tests (don't restore)
python run_tests.py --keep-mock-config

# Use different mock response presets
python run_tests.py --mock-responses-preset cognitive_demo
python run_tests.py --mock-responses-preset simple
python run_tests.py --mock-responses-preset deliverable_only

# Standard pytest options
python run_tests.py -v --tb=short --maxfail=3 -k "test_state_machine"
```

## 🔧 Test Configuration

### Mock Response Presets

1. **`default`**: General-purpose responses for most testing scenarios
2. **`cognitive_demo`**: Specific responses for cognitive stimulation demo
3. **`simple`**: Minimal responses for basic functionality testing
4. **`deliverable_only`**: Only deliverable detection responses

### Custom Mock Responses

You can create custom mock responses in your tests:

```python
from tests.utils.llm_test_utils import mock_llm_context

custom_responses = [
    "DELIVERABLE_DETECTED: user_name = 'CustomUser'",
    "DELIVERABLE_DETECTED: user_age = 30",
    "Hello CustomUser! Nice to meet you.",
    "Great! Let's continue with the next task."
]

with mock_llm_context(mock_responses=custom_responses) as mock_llm:
    # Your test code here
    pass
```

## 📝 Writing Tests

### Using the Context Manager

```python
import pytest
from tests.utils.llm_test_utils import mock_llm_context, inject_mock_llm_into_state_machine

@pytest.mark.asyncio
async def test_my_feature():
    """Test with automatic LLM switching."""

    with mock_llm_context() as mock_llm:
        # Setup your state machine
        state_machine = create_state_machine()

        # Inject mock LLM
        inject_mock_llm_into_state_machine(state_machine)

        # Run your tests
        result = await state_machine.process_user_message("test input")

        # Assertions
        assert result.success == True

    # Original LLM config is automatically restored here
```

### Manual LLM Service Setup

```python
from tests.utils.llm_test_utils import create_test_llm_service

def test_manual_setup():
    """Test with manual mock LLM setup."""

    mock_responses = ["Response 1", "Response 2"]
    mock_llm = create_test_llm_service(mock_responses)

    # Use mock_llm in your components
    my_component.llm_service = mock_llm
```

## 🔍 Test Structure

### Test Files

- **`test_state_machine_flow.py`**: Original state machine tests (bypasses LLM)
- **`test_state_machine_with_mock_llm.py`**: New tests with mock LLM integration
- **`utils/llm_test_utils.py`**: Test utilities and mock management
- **`README_TESTING.md`**: This documentation

### Test Categories

1. **Core Functionality Tests**
   - State machine initialization
   - State transitions
   - Task completion logic

2. **LLM Integration Tests**
   - Deliverable detection with mock responses
   - Full conversation flow simulation
   - Error handling with mock LLM

3. **Processing Mode Tests**
   - STRICT vs LOOSE state behavior
   - Task availability in different modes
   - Context building for different modes

4. **Integration Tests**
   - TaskManager integration
   - Complete workflow testing
   - Message processing pipeline

## 🛠️ Mock LLM Provider Details

### Capabilities
- **Deterministic responses**: Cycles through predefined responses
- **Streaming simulation**: Mimics real streaming behavior
- **Token counting**: Provides mock usage statistics
- **Zero cost**: All API calls return $0.00
- **Realistic delays**: Simulates processing time

### Response Format
Mock responses can include special formats for deliverable detection:

```
"DELIVERABLE_DETECTED: user_name = 'John Doe'"
"DELIVERABLE_DETECTED: user_age = 25"
"No deliverable detected in this message."
```

Regular conversation responses:
```
"Hello! How can I help you today?"
"Great! I've noted that information."
"Let's continue with the next step."
```

## 🔄 Configuration Management

### Automatic Backup and Restore

The test system automatically:

1. **Backs up** your current `llm_config.json`
2. **Creates** a test configuration with mock provider
3. **Runs** tests with mock LLM
4. **Restores** your original configuration

### Configuration Files

- **`llm_config.json`**: Your main LLM configuration
- **Temporary backup**: Created during testing, cleaned up automatically

### Manual Configuration Control

```python
from tests.utils.llm_test_utils import LLMTestManager

# Manual control
manager = LLMTestManager()
manager.backup_original_config()
manager.apply_test_config(custom_responses)

# ... run tests ...

manager.restore_original_config()
```

## 🚨 Troubleshooting

### Common Issues

1. **Config not restored after interrupted tests**
   ```bash
   # Check if backup exists
   ls /tmp/llm_config_backup_*.json

   # Manually restore if needed
   cp /tmp/llm_config_backup_*.json llm_config.json
   ```

2. **Tests failing with real LLM calls**
   ```bash
   # Ensure mock LLM is being used
   python run_tests.py --use-mock-llm
   ```

3. **Mock responses not matching expectations**
   ```bash
   # Use specific preset
   python run_tests.py --mock-responses-preset cognitive_demo
   ```

### Debug Mode

```bash
# Run with verbose output and no capture
python run_tests.py -v -s

# Stop after first failure
python run_tests.py --maxfail=1

# Run specific test with debugging
python run_tests.py -v -s --file tests/test_specific.py -k "test_function_name"
```

## 📊 Test Results

### Expected Output

```
🚀 Test Runner with LLM Provider Management
==================================================
Test files: ['tests/']
Use mock LLM: True
Mock responses preset: default
Keep mock config: False

🔧 Setting up mock LLM configuration...
✅ Mock LLM configuration applied

🧪 Running tests...
tests/test_state_machine_with_mock_llm.py::TestStateMachineWithMockLLM::test_cognitive_demo_full_flow_with_mock_llm PASSED
tests/test_state_machine_with_mock_llm.py::TestStateMachineWithMockLLM::test_strict_vs_loose_processing_modes PASSED
tests/test_state_machine_with_mock_llm.py::TestStateMachineWithMockLLM::test_task_manager_integration_with_mock_llm PASSED

✅ All tests passed!

🔧 Restoring original LLM configuration...
✅ Original LLM configuration restored

==================================================
🏁 Test run complete
```

## 🎯 Best Practices

### 1. Always Use Context Manager
```python
# Good
with mock_llm_context() as mock_llm:
    # test code
    pass

# Avoid - manual management is error-prone
manager = LLMTestManager()
manager.setup()
# ... easy to forget cleanup
```

### 2. Use Appropriate Response Presets
```python
# For cognitive demo testing
python run_tests.py --mock-responses-preset cognitive_demo

# For basic functionality
python run_tests.py --mock-responses-preset simple
```

### 3. Test Both Mock and Real LLM When Needed
```python
# Most tests use mock
python run_tests.py

# Occasional integration test with real LLM
python run_tests.py --use-real-llm --file tests/test_integration.py
```

### 4. Clean Test Isolation
```python
@pytest.mark.asyncio
async def test_with_fresh_state():
    """Each test gets fresh mock LLM state."""
    with mock_llm_context() as mock_llm:
        # Fresh mock responses for this test
        pass
```

---

## 📚 Example Test Run

```bash
$ python setup_test_environment.py
🛠️  Setting up test environment
========================================
✅ Python version: 3.9.7 (default, ...)
✅ pytest available: 7.4.0
✅ LLM config found with provider: openai_langchain
✅ Test file found: tests/test_state_machine_flow.py
✅ Test file found: tests/test_state_machine_with_mock_llm.py
✅ Test file found: tests/utils/llm_test_utils.py
✅ Mock LLM service working correctly

✅ Test environment setup complete!

$ python run_tests.py --state-machine -v
🚀 Test Runner with LLM Provider Management
==================================================
Test files: ['tests/test_state_machine_flow.py', 'tests/test_state_machine_with_mock_llm.py']
Use mock LLM: True
Mock responses preset: default
Keep mock config: False

🔧 Setting up mock LLM configuration...
✅ Mock LLM configuration applied

🧪 Running tests...
========================== test session starts ==========================
tests/test_state_machine_flow.py::TestStateMachineFlow::test_load_state_machine_plan PASSED
tests/test_state_machine_with_mock_llm.py::TestStateMachineWithMockLLM::test_cognitive_demo_full_flow_with_mock_llm PASSED

✅ All tests passed!

🔧 Restoring original LLM configuration...
✅ Original LLM configuration restored

==================================================
🏁 Test run complete
```

Your original LLM configuration is now restored and ready for production use! 🎉