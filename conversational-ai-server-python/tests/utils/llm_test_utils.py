"""
LLM Testing Utilities
Provides utilities for managing LLM providers during testing, including automatic
switching to mock providers and restoration of original configuration.
"""

import json
import shutil
import os
from pathlib import Path
from typing import Dict, Any, List, Optional, Union
from contextlib import contextmanager
import tempfile

from message_processing.llm_service import (
    LLMService,
    LLMConfig,
    LLMProvider,
    MockLLMProvider
)


class LLMTestManager:
    """Manages LLM provider switching for testing."""

    def __init__(self, config_path: str = "llm_config.json"):
        self.config_path = Path(config_path)
        self.backup_path = None
        self.original_config = None
        self.test_config_path = None

    def backup_original_config(self) -> None:
        """Backup the original LLM configuration."""
        if self.config_path.exists():
            # Create backup in temp directory
            self.backup_path = Path(tempfile.gettempdir()) / f"llm_config_backup_{os.getpid()}.json"
            shutil.copy2(self.config_path, self.backup_path)

            # Load original config
            with open(self.config_path) as f:
                self.original_config = json.load(f)

            print(f"[LLMTestManager] Backed up config to: {self.backup_path}")
        else:
            print(f"[LLMTestManager] No config file found at {self.config_path}")

    def create_test_config(self, mock_responses: Optional[List[str]] = None) -> Dict[str, Any]:
        """Create a test configuration with mock provider."""
        test_config = {
            "model": "mock-model",
            "temperature": 0.7,
            "max_tokens": 800,
            "provider": "mock",
            "streaming": true,
            "timeout": 30.0,
            "retry_attempts": 1,  # Faster for tests
            "retry_delay": 0.1,   # Faster for tests
            "test_mode": true,
            "mock_responses": mock_responses or self.get_default_mock_responses()
        }
        return test_config

    def get_default_mock_responses(self) -> List[str]:
        """Get default mock responses for common testing scenarios."""
        return [
            # Deliverable detection responses
            "DELIVERABLE_DETECTED: user_name = 'TestUser'",
            "DELIVERABLE_DETECTED: user_age = 25",
            "DELIVERABLE_DETECTED: user_location = 'TestCity'",
            "DELIVERABLE_DETECTED: user_hobbies = 'reading, testing'",
            "DELIVERABLE_DETECTED: user_siblings = 'one brother'",
            "DELIVERABLE_DETECTED: shopping_list_1 = 'milk'",
            "DELIVERABLE_DETECTED: shopping_list_2 = 'milk, bread'",
            "DELIVERABLE_DETECTED: shopping_list_3 = 'milk, bread, eggs'",

            # Conversation responses
            "Hello! I'm GRACE, and I'm delighted to meet you.",
            "Great! I've noted your information.",
            "Perfect! Let's continue with the next task.",
            "Excellent work! You're doing great.",
            "Wonderful! Let's move on to the memory challenge.",
            "Outstanding memory! Let's try the next level.",
            "Fantastic! You've completed this level successfully.",
            "Amazing recall! Let's continue.",
            "Excellent! You've done a great job with this exercise.",
            "Thank you for participating! Here's a little joke to end: Why don't scientists trust atoms? Because they make up everything!"
        ]

    def apply_test_config(self, mock_responses: Optional[List[str]] = None) -> None:
        """Apply test configuration with mock provider."""
        test_config = self.create_test_config(mock_responses)

        # Write test config
        with open(self.config_path, 'w') as f:
            json.dump(test_config, f, indent=2)

        print(f"[LLMTestManager] Applied test config with mock provider")
        print(f"[LLMTestManager] Mock responses count: {len(test_config['mock_responses'])}")

    def restore_original_config(self) -> None:
        """Restore the original LLM configuration."""
        if self.backup_path and self.backup_path.exists():
            shutil.copy2(self.backup_path, self.config_path)
            # Clean up backup
            self.backup_path.unlink()
            print(f"[LLMTestManager] Restored original config")
        elif self.original_config:
            # Restore from memory
            with open(self.config_path, 'w') as f:
                json.dump(self.original_config, f, indent=2)
            print(f"[LLMTestManager] Restored config from memory")
        else:
            print(f"[LLMTestManager] No backup found, removing test config")
            if self.config_path.exists():
                self.config_path.unlink()

    def setup_mock_llm_service(self, mock_responses: Optional[List[str]] = None) -> LLMService:
        """Create a LLM service with mock provider for testing."""
        responses = mock_responses or self.get_default_mock_responses()

        # Create LLM service
        llm_service = LLMService(config_path=str(self.config_path))

        # Override with custom mock provider
        llm_service.providers[LLMProvider.MOCK] = MockLLMProvider(responses)
        llm_service.default_config.provider = LLMProvider.MOCK

        return llm_service


@contextmanager
def mock_llm_context(config_path: str = "llm_config.json",
                    mock_responses: Optional[List[str]] = None):
    """Context manager for testing with mock LLM provider."""
    manager = LLMTestManager(config_path)

    try:
        # Setup
        manager.backup_original_config()
        manager.apply_test_config(mock_responses)

        # Create and yield mock LLM service
        llm_service = manager.setup_mock_llm_service(mock_responses)
        yield llm_service

    finally:
        # Teardown
        manager.restore_original_config()


class StateMachineMockResponses:
    """Predefined mock responses for state machine testing."""

    @staticmethod
    def get_cognitive_demo_responses() -> List[str]:
        """Mock responses for cognitive stimulation demo."""
        return [
            # Introduction state responses
            "DELIVERABLE_DETECTED: user_name = 'Alice'",
            "DELIVERABLE_DETECTED: user_age = 32",
            "DELIVERABLE_DETECTED: user_location = 'San Francisco'",
            "DELIVERABLE_DETECTED: user_hobbies = 'painting, yoga, cooking'",
            "DELIVERABLE_DETECTED: user_siblings = 'two sisters'",

            # Memory game responses
            "DELIVERABLE_DETECTED: shopping_list_1 = 'milk'",
            "DELIVERABLE_DETECTED: shopping_list_2 = 'milk, bread'",
            "DELIVERABLE_DETECTED: shopping_list_3 = 'milk, bread, eggs'",
            "DELIVERABLE_DETECTED: shopping_list_4 = 'milk, bread, eggs, apples'",
            "DELIVERABLE_DETECTED: shopping_list_5 = 'milk, bread, eggs, apples, cheese'",

            # Feedback state responses
            "DELIVERABLE_DETECTED: feedback_liked = 'The memory game was really fun and challenging'",
            "DELIVERABLE_DETECTED: feedback_improvement = 'Maybe add more difficulty levels'",

            # Conversation responses
            "Hello Alice! I'm GRACE, your cognitive exercise companion. It's wonderful to meet you!",
            "Fantastic! I love that you're from San Francisco - such a beautiful city. And painting, yoga, and cooking are wonderful hobbies!",
            "Great! Now let's begin our memory exercise. We'll start simple with just one item: milk. Can you repeat that back to me?",
            "Perfect! You got 'milk' exactly right. Now let's try two items: milk and bread.",
            "Excellent memory! You correctly remembered both items. Let's add a third: milk, bread, and eggs.",
            "Outstanding! Your memory is really sharp. Let's continue with four items now.",
            "Amazing work! You're doing incredibly well with this memory challenge.",
            "You've shown excellent cognitive abilities today! Thank you for participating in this exercise.",
            "I'd love to hear what you enjoyed most about our session today.",
            "Thank you for that feedback! Is there anything you think could be improved?",
            "Perfect! Here's a little joke to end our session: Why don't eggs tell jokes? Because they'd crack each other up! Thank you for spending this time with me, Alice!"
        ]

    @staticmethod
    def get_simple_test_responses() -> List[str]:
        """Simple mock responses for basic testing."""
        return [
            "DELIVERABLE_DETECTED: user_name = 'TestUser'",
            "Hello TestUser! Nice to meet you.",
            "Great! Let's continue.",
            "Perfect! Task completed."
        ]

    @staticmethod
    def get_deliverable_only_responses() -> List[str]:
        """Mock responses that only return deliverable detections."""
        return [
            "DELIVERABLE_DETECTED: user_name = 'John'",
            "DELIVERABLE_DETECTED: user_age = 28",
            "DELIVERABLE_DETECTED: user_location = 'New York'",
            "DELIVERABLE_DETECTED: user_hobbies = 'reading, gaming'",
            "DELIVERABLE_DETECTED: user_siblings = 'one sister'",
            "DELIVERABLE_DETECTED: shopping_list_1 = 'milk'",
            "DELIVERABLE_DETECTED: shopping_list_2 = 'milk, bread'",
            "DELIVERABLE_DETECTED: shopping_list_3 = 'milk, bread, eggs'",
            "DELIVERABLE_DETECTED: feedback_liked = 'Everything was great'",
            "DELIVERABLE_DETECTED: feedback_improvement = 'Nothing to improve'"
        ]


def create_test_llm_service(mock_responses: Optional[List[str]] = None) -> LLMService:
    """Quick utility to create a mock LLM service for testing."""
    responses = mock_responses or StateMachineMockResponses.get_simple_test_responses()

    llm_service = LLMService()
    llm_service.providers[LLMProvider.MOCK] = MockLLMProvider(responses)
    llm_service.default_config.provider = LLMProvider.MOCK

    return llm_service


def inject_mock_llm_into_state_machine(state_machine, mock_responses: Optional[List[str]] = None):
    """Inject mock LLM service into a state machine for testing."""
    mock_llm_service = create_test_llm_service(mock_responses)

    # Inject into deliverable detector if it exists
    if hasattr(state_machine, 'deliverable_detector'):
        state_machine.deliverable_detector.llm_service = mock_llm_service

    # Inject into any other components that might need LLM
    if hasattr(state_machine, 'llm_service'):
        state_machine.llm_service = mock_llm_service

    return mock_llm_service