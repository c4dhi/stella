#!/usr/bin/env python3
"""
Test Runner with Automatic LLM Provider Management
Automatically switches to mock LLM for testing and restores original configuration.
"""

import sys
import subprocess
import argparse
import json
from pathlib import Path
from typing import List, Optional
import tempfile
import shutil

from tests.utils.llm_test_utils import LLMTestManager, StateMachineMockResponses


def run_command(command: List[str], cwd: Optional[str] = None) -> tuple[int, str, str]:
    """Run a command and return exit code, stdout, stderr."""
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False
        )
        return result.returncode, result.stdout, result.stderr
    except Exception as e:
        return 1, "", str(e)


def run_pytest_with_options(test_files: List[str], pytest_args: List[str]) -> int:
    """Run pytest with specified options."""
    cmd = ["python", "-m", "pytest"] + pytest_args + test_files

    print("🧪 Running tests with command:")
    print(f"   {' '.join(cmd)}")
    print()

    exit_code, stdout, stderr = run_command(cmd)

    if stdout:
        print(stdout)
    if stderr:
        print("STDERR:", stderr)

    return exit_code


def main():
    parser = argparse.ArgumentParser(
        description="Run tests with automatic LLM provider management",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_tests.py                                    # Run all tests
  python run_tests.py --state-machine                   # Run state machine tests only
  python run_tests.py --mock-llm                        # Run mock LLM tests only
  python run_tests.py -v --tb=short                     # Verbose with short traceback
  python run_tests.py --file tests/test_specific.py     # Run specific test file
  python run_tests.py --keep-mock-config                # Don't restore config after tests
        """
    )

    # Test selection arguments
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run all tests (default)"
    )
    parser.add_argument(
        "--state-machine",
        action="store_true",
        help="Run state machine tests only"
    )
    parser.add_argument(
        "--mock-llm",
        action="store_true",
        help="Run mock LLM integration tests only"
    )
    parser.add_argument(
        "--file",
        type=str,
        help="Run specific test file"
    )

    # Mock configuration arguments
    parser.add_argument(
        "--use-mock-llm",
        action="store_true",
        default=True,
        help="Use mock LLM provider for testing (default: True)"
    )
    parser.add_argument(
        "--use-real-llm",
        action="store_true",
        help="Use real LLM provider for testing (overrides --use-mock-llm)"
    )
    parser.add_argument(
        "--keep-mock-config",
        action="store_true",
        help="Don't restore original LLM config after tests"
    )
    parser.add_argument(
        "--mock-responses-preset",
        choices=["default", "cognitive_demo", "simple", "deliverable_only"],
        default="default",
        help="Preset mock responses to use"
    )

    # Pytest arguments
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Verbose output"
    )
    parser.add_argument(
        "--tb",
        choices=["short", "long", "line", "native", "no"],
        default="short",
        help="Traceback style"
    )
    parser.add_argument(
        "-s",
        action="store_true",
        help="Don't capture output"
    )
    parser.add_argument(
        "--maxfail",
        type=int,
        help="Stop after N failures"
    )
    parser.add_argument(
        "-k",
        type=str,
        help="Run tests matching expression"
    )

    args = parser.parse_args()

    # Determine which tests to run
    test_files = []

    if args.file:
        test_files = [args.file]
    elif args.state_machine:
        test_files = [
            "tests/test_state_machine_flow.py",
            "tests/test_state_machine_with_mock_llm.py"
        ]
    elif args.mock_llm:
        test_files = [
            "tests/test_state_machine_with_mock_llm.py"
        ]
    else:
        # Run all tests by default
        test_files = ["tests/"]

    # Build pytest arguments
    pytest_args = []

    if args.verbose:
        pytest_args.append("-v")

    pytest_args.extend(["--tb", args.tb])

    if args.s:
        pytest_args.append("-s")

    if args.maxfail:
        pytest_args.extend(["--maxfail", str(args.maxfail)])

    if args.k:
        pytest_args.extend(["-k", args.k])

    # Setup mock responses
    mock_responses = None
    if args.use_mock_llm and not args.use_real_llm:
        if args.mock_responses_preset == "cognitive_demo":
            mock_responses = StateMachineMockResponses.get_cognitive_demo_responses()
        elif args.mock_responses_preset == "simple":
            mock_responses = StateMachineMockResponses.get_simple_test_responses()
        elif args.mock_responses_preset == "deliverable_only":
            mock_responses = StateMachineMockResponses.get_deliverable_only_responses()
        # else: use default responses

    # Setup LLM test manager
    test_manager = LLMTestManager()
    use_mock = args.use_mock_llm and not args.use_real_llm

    print("🚀 Test Runner with LLM Provider Management")
    print("=" * 50)
    print(f"Test files: {test_files}")
    print(f"Use mock LLM: {use_mock}")
    print(f"Mock responses preset: {args.mock_responses_preset if use_mock else 'N/A'}")
    print(f"Keep mock config: {args.keep_mock_config}")
    print()

    exit_code = 0

    try:
        if use_mock:
            print("🔧 Setting up mock LLM configuration...")
            test_manager.backup_original_config()
            test_manager.apply_test_config(mock_responses)
            print("✅ Mock LLM configuration applied")
            print()

        # Run the tests
        print("🧪 Running tests...")
        exit_code = run_pytest_with_options(test_files, pytest_args)

        if exit_code == 0:
            print("\n✅ All tests passed!")
        else:
            print(f"\n❌ Tests failed with exit code: {exit_code}")

    except KeyboardInterrupt:
        print("\n⚠️ Tests interrupted by user")
        exit_code = 130

    except Exception as e:
        print(f"\n💥 Error running tests: {e}")
        exit_code = 1

    finally:
        if use_mock and not args.keep_mock_config:
            print("\n🔧 Restoring original LLM configuration...")
            try:
                test_manager.restore_original_config()
                print("✅ Original LLM configuration restored")
            except Exception as e:
                print(f"⚠️ Warning: Could not restore config: {e}")
        elif args.keep_mock_config:
            print("\n⚠️ Mock configuration kept (use --use-real-llm to restore)")

    print("\n" + "=" * 50)
    print("🏁 Test run complete")

    return exit_code


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)