"""
Unit tests for the modular prompt component system.

This test suite verifies that the new component-based prompt building
is robust, maintainable, and free from string formatting issues.
"""

import unittest
from message_processing.prompt_components import (
    PromptBuilder,
    BaseInstructionsComponent,
    StrictnessComponent,
    DeliverableExamplesComponent,
    SafetyGuidelinesComponent
)


class TestPromptComponents(unittest.TestCase):
    """Test suite for prompt components."""

    def setUp(self):
        """Set up test fixtures."""
        self.builder = PromptBuilder()

    def test_basic_prompt_building(self):
        """Test that basic prompt building works without errors."""
        context = {'strictness': 'moderate'}
        prompt = self.builder.build(context)

        self.assertIsInstance(prompt, str)
        self.assertGreater(len(prompt), 1000)  # Should be substantial
        self.assertIn("GRACE", prompt)

    def test_strictness_variations(self):
        """Test that different strictness levels produce different prompts."""
        strict_prompt = self.builder.build({'strictness': 'strict'})
        moderate_prompt = self.builder.build({'strictness': 'moderate'})
        loose_prompt = self.builder.build({'strictness': 'loose'})

        # Each should contain their specific guidance
        self.assertIn("STRICT TASK ADHERENCE", strict_prompt)
        self.assertIn("BALANCED GUIDANCE", moderate_prompt)
        self.assertIn("FLEXIBLE CONVERSATION", loose_prompt)

        # They should be different
        self.assertNotEqual(strict_prompt, moderate_prompt)
        self.assertNotEqual(moderate_prompt, loose_prompt)

    def test_json_examples_are_safe(self):
        """Test that JSON examples don't cause formatting conflicts."""
        component = DeliverableExamplesComponent()
        examples = component.render({})

        # Should contain proper JSON (not double-escaped template braces)
        self.assertIn('{"user_location"', examples)

        # Should not contain template double-brace escaping like {{"key"
        # Note: ""}}" at end of JSON is valid, we're looking for start patterns
        self.assertNotIn('{{"', examples)  # No template escaping at start
        self.assertNotIn('{{user_location', examples)  # No template escaping

        # Should be valid examples
        self.assertIn('DELIVERABLES:', examples)
        self.assertIn('[NONE]', examples)

    def test_component_isolation(self):
        """Test that components work independently."""
        base = BaseInstructionsComponent()
        strictness = StrictnessComponent()
        safety = SafetyGuidelinesComponent()

        # Each should render independently
        base_text = base.render({})
        strict_text = strictness.render({'strictness': 'strict'})
        safety_text = safety.render({})

        self.assertIn("GRACE", base_text)
        self.assertIn("STRICT", strict_text)
        self.assertIn("UNSAFE", safety_text)

        # They should be different
        self.assertNotEqual(base_text, strict_text)
        self.assertNotEqual(strict_text, safety_text)

    def test_error_handling(self):
        """Test that component errors don't crash the builder."""
        # Test with missing context keys
        prompt = self.builder.build({})  # Empty context
        self.assertIsInstance(prompt, str)
        self.assertGreater(len(prompt), 100)

        # Test with invalid context
        prompt = self.builder.build({'invalid_key': 'invalid_value'})
        self.assertIsInstance(prompt, str)

    def test_no_template_formatting_errors(self):
        """Test that the prompt never has unresolved template placeholders."""
        contexts = [
            {'strictness': 'strict'},
            {'strictness': 'moderate'},
            {'strictness': 'loose'},
            {},  # Empty context
        ]

        for context in contexts:
            prompt = self.builder.build(context)

            # Should not contain unresolved template placeholders like {variable}
            # Note: JSON examples like {"key": "value"} are valid and expected
            self.assertNotIn('{strictness_guidance}', prompt)
            self.assertNotIn('{variable}', prompt)

            # Should not contain Python format syntax
            self.assertNotIn('%s', prompt)
            self.assertNotIn('%(', prompt)

            # Should not contain template double-brace escaping
            self.assertNotIn('{{"key":', prompt)
            self.assertNotIn(':"value"}}', prompt)

    def test_content_consistency(self):
        """Test that essential content is always present."""
        prompt = self.builder.build({'strictness': 'moderate'})

        # Essential elements that should always be present
        required_elements = [
            "GRACE",
            "VERDICT:",
            "EXPERTS:",
            "DELIVERABLES:",
            "MESSAGE:",
            "[SAFE]",
            "[UNSAFE]",
            "greeting"
        ]

        for element in required_elements:
            self.assertIn(element, prompt, f"Missing required element: {element}")


if __name__ == '__main__':
    unittest.main()