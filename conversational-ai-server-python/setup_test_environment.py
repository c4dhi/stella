#!/usr/bin/env python3
"""
Setup script for test environment.
Helps configure the testing environment and verify all dependencies.
"""

import sys
import json
import subprocess
from pathlib import Path


def check_python_version():
    """Check if Python version is adequate."""
    if sys.version_info < (3, 8):
        print("❌ Python 3.8 or higher is required for testing")
        return False
    print(f"✅ Python version: {sys.version}")
    return True


def check_pytest_available():
    """Check if pytest is available."""
    try:
        import pytest
        print(f"✅ pytest available: {pytest.__version__}")
        return True
    except ImportError:
        print("❌ pytest not found. Install with: pip install pytest")
        return False


def check_llm_config():
    """Check if LLM config exists and is valid."""
    config_path = Path("llm_config.json")
    if not config_path.exists():
        print("⚠️  No llm_config.json found. Creating default config...")
        create_default_config()
        return True

    try:
        with open(config_path) as f:
            config = json.load(f)
        print(f"✅ LLM config found with provider: {config.get('provider', 'unknown')}")
        return True
    except Exception as e:
        print(f"❌ Invalid llm_config.json: {e}")
        return False


def create_default_config():
    """Create a default LLM configuration."""
    default_config = {
        "model": "gpt-4o-mini",
        "temperature": 0.7,
        "max_tokens": 800,
        "provider": "openai_langchain",
        "streaming": True,
        "timeout": 30.0,
        "retry_attempts": 3,
        "retry_delay": 1.0
    }

    with open("llm_config.json", "w") as f:
        json.dump(default_config, f, indent=2)

    print("✅ Created default llm_config.json")


def check_test_files():
    """Check if test files exist."""
    test_files = [
        "tests/test_state_machine_flow.py",
        "tests/test_state_machine_with_mock_llm.py",
        "tests/utils/llm_test_utils.py"
    ]

    all_found = True
    for test_file in test_files:
        if Path(test_file).exists():
            print(f"✅ Test file found: {test_file}")
        else:
            print(f"❌ Test file missing: {test_file}")
            all_found = False

    return all_found


def run_quick_test():
    """Run a quick test to verify everything works."""
    print("\n🧪 Running quick verification test...")
    try:
        from tests.utils.llm_test_utils import create_test_llm_service
        from message_processing.llm_service import LLMProvider

        # Create mock LLM service
        llm_service = create_test_llm_service()

        # Verify mock provider works
        assert LLMProvider.MOCK in llm_service.providers
        assert llm_service.providers[LLMProvider.MOCK].is_available()

        print("✅ Mock LLM service working correctly")
        return True

    except Exception as e:
        print(f"❌ Quick test failed: {e}")
        return False


def main():
    """Main setup function."""
    print("🛠️  Setting up test environment")
    print("=" * 40)

    checks = [
        check_python_version(),
        check_pytest_available(),
        check_llm_config(),
        check_test_files(),
        run_quick_test()
    ]

    if all(checks):
        print("\n✅ Test environment setup complete!")
        print("\nYou can now run tests using:")
        print("  python run_tests.py                    # Run all tests")
        print("  python run_tests.py --state-machine   # Run state machine tests")
        print("  python run_tests.py --mock-llm        # Run mock LLM tests")
        print("  python run_tests.py -v                # Verbose output")
        return 0
    else:
        print("\n❌ Test environment setup incomplete!")
        print("Please fix the issues above and run again.")
        return 1


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)