"""
Unified prompt builder for stella-light-agent.

Combines all prompt components into a single system prompt with:
- STELLA identity and personality
- Embedded safety/ethics guardrails (replaces expert system)
- State machine context
- Deliverable extraction rules
"""

from typing import Dict, List, Any, Optional


class LightPromptBuilder:
    """Builds a unified prompt with embedded guardrails for the light agent."""

    def build_system_prompt(self, context: Dict[str, Any]) -> str:
        """
        Build complete system prompt with embedded guardrails.

        Args:
            context: State machine context from get_context_for_prompt()
                     May include 'plan_system_prompt' for custom identity/instructions

        Returns:
            Complete system prompt string
        """
        mode = context.get("processing_mode", "loose")
        state = context.get("state", {})
        deliverables = context.get("deliverables", [])
        progress = context.get("progress", {})
        state_just_changed = context.get("state_just_changed", False)
        current_task = context.get("current_task")
        plan_system_prompt = context.get("plan_system_prompt")

        parts = [
            self._build_identity(plan_system_prompt),
            self._build_guardrails(),
            self._build_response_format(),
            self._build_deliverable_rules(deliverables),
        ]

        # Add context if state machine is initialized
        if state:
            parts.append(self._build_context(state, mode, progress, current_task))

        # Add state transition warning if applicable
        if state_just_changed:
            parts.append(self._build_state_transition_warning(state))

        return "\n\n".join(parts)

    def _build_identity(self, plan_system_prompt: Optional[str] = None) -> str:
        """
        Build STELLA identity section.

        Args:
            plan_system_prompt: Optional custom system prompt from the plan.
                               If provided, uses this instead of the default identity.
        """
        # If a custom system prompt is provided in the plan, use it
        if plan_system_prompt:
            return f"""## Your Identity & Instructions
{plan_system_prompt}

## Core Personality Traits
- Friendly, warm, and genuinely interested in the person you're speaking with
- Supportive and encouraging, never judgmental
- Natural and conversational - avoid sounding robotic or scripted
- Concise but thorough - aim for 30-50 words per response
- Ask only ONE question at a time to keep the conversation flowing naturally"""

        # Default STELLA identity
        return """## Your Identity
You are STELLA, a warm and engaging AI companion supporting cognitive health and wellbeing.

## Your Personality
- Friendly, warm, and genuinely interested in the person you're speaking with
- Supportive and encouraging, never judgmental
- Natural and conversational - avoid sounding robotic or scripted
- Concise but thorough - aim for 30-50 words per response
- Ask only ONE question at a time to keep the conversation flowing naturally"""

    def _build_guardrails(self) -> str:
        """Build embedded safety guardrails (replaces expert system)."""
        return """## Safety Guidelines (IMPORTANT)
When users ask about sensitive topics, provide helpful general information while maintaining appropriate boundaries:

**Medical Questions:**
- Provide general health information and encourage healthy habits
- Always recommend consulting healthcare professionals for specific medical advice
- Never provide diagnoses or specific treatment recommendations

**Financial Questions:**
- Share general financial literacy information
- Suggest consulting financial advisors for specific investment or financial decisions
- Never give specific financial advice

**Legal Questions:**
- Provide general information about legal concepts when helpful
- Always recommend consulting legal professionals for specific legal matters
- Never give specific legal advice

**Harmful or Dangerous Requests:**
- Politely decline requests that could cause harm
- Redirect to appropriate resources or topics
- Maintain a caring, non-judgmental tone

**Ethical Dilemmas:**
- Provide balanced perspectives without imposing judgment
- Help users think through considerations
- Respect user autonomy in decision-making

Remember: You are a supportive companion, not a replacement for professional advice."""

    def _build_response_format(self) -> str:
        """Build response format instructions."""
        return """## Response Format
You MUST respond using this EXACT format:

MESSAGE: [Your conversational response here - 30-50 words, max 1 question]
DELIVERABLES: [JSON object with extracted values] or [NONE]

Example responses:

MESSAGE: That's wonderful to hear, Sarah! I love how passionate you are about gardening. It sounds like such a peaceful hobby. What kinds of plants do you enjoy growing the most?
DELIVERABLES: {"user_name": {"value": "Sarah", "reasoning": "User introduced herself as Sarah"}}

MESSAGE: Thanks for sharing that with me! I'd love to learn more about you. What do you enjoy doing in your free time?
DELIVERABLES: [NONE]"""

    def _build_deliverable_rules(self, deliverables: List[Dict]) -> str:
        """Build deliverable extraction rules."""
        pending = [d for d in deliverables if d.get("status") == "pending"]

        if not pending:
            return """## Deliverable Collection
No deliverables to collect currently. Focus on natural conversation."""

        rules = ["## Deliverable Collection", "Collect these pieces of information when the user provides them:"]

        for d in pending:
            required_marker = "*" if d.get("required", True) else "(optional)"
            rules.append(f"\n**{d['key']}** {required_marker}")
            rules.append(f"  Description: {d['description']}")
            if d.get("acceptance_criteria"):
                rules.append(f"  Criteria: {d['acceptance_criteria']}")
            if d.get("examples"):
                examples = ", ".join(str(e) for e in d['examples'][:3])
                rules.append(f"  Examples: {examples}")

        rules.append("""
### Extraction Rules
- Format: {"key": {"value": "extracted_value", "reasoning": "brief explanation"}}
- Only extract when user CLEARLY and EXPLICITLY provides the information
- NEVER extract from greetings (hi, hello, hey, good morning, etc.)
- NEVER guess or infer values - only extract what is directly stated
- If unsure, use [NONE] and ask a clarifying question instead""")

        return "\n".join(rules)

    def _build_context(
        self,
        state: Dict,
        mode: str,
        progress: Dict,
        current_task: Optional[Dict]
    ) -> str:
        """Build current conversation context."""
        parts = ["## Current Context"]
        parts.append(f"**State:** {state.get('title', 'Unknown')} ({mode} mode)")

        if state.get('description'):
            parts.append(f"**Goal:** {state.get('description')}")

        parts.append(f"**Progress:** {progress.get('percentage', 0):.0f}% complete")

        if current_task:
            parts.append(f"\n**Current Focus:** {current_task.get('description', '')}")
            if current_task.get('instruction'):
                parts.append(f"**Instruction:** {current_task.get('instruction')}")

        return "\n".join(parts)

    def _build_state_transition_warning(self, state: Dict) -> str:
        """Build warning when state just changed."""
        return f"""## State Transition Notice
You just transitioned to a new state: **{state.get('title', 'Unknown')}**
Take a moment to acknowledge this transition naturally and introduce the new topic/focus area.
Do NOT continue collecting information from the previous state."""

    def build_user_message(
        self,
        user_input: str,
        conversation_history: List[Dict[str, str]],
        context: Dict[str, Any]
    ) -> str:
        """
        Build user message with conversation context.

        Args:
            user_input: Current user message
            conversation_history: Previous conversation turns
            context: State machine context

        Returns:
            Formatted user message
        """
        parts = []

        # Add recent conversation for context
        if conversation_history:
            parts.append("Recent conversation:")
            # Only include last 6 messages for context
            for msg in conversation_history[-6:]:
                role = msg.get("role", "user").upper()
                content = msg.get("content", "")
                # Truncate long messages
                if len(content) > 200:
                    content = content[:200] + "..."
                parts.append(f"{role}: {content}")
            parts.append("")

        parts.append(f"Current message: {user_input}")

        return "\n".join(parts)
