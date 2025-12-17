"""
Unified prompt builder for stella-light-agent.

Combines all prompt components into a single system prompt with:
- STELLA identity and personality
- Embedded safety/ethics guardrails (replaces expert system)
- State machine context
- Tool usage instructions
"""

from typing import Dict, List, Any, Optional


class LightPromptBuilder:
    """Builds a unified prompt with embedded guardrails for the light agent."""

    def __init__(self, use_tools: bool = False):
        """Initialize the prompt builder.

        Args:
            use_tools: If True, build prompts for tool-based state management.
                      If False, use legacy structured output format.
        """
        self._use_tools = use_tools

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
        next_task = context.get("next_task")  # Preview task for strict mode
        available_tasks = context.get("available_tasks", [])
        collected_deliverables = context.get("collected_deliverables", {})
        plan_system_prompt = context.get("plan_system_prompt")

        parts = [
            self._build_identity(plan_system_prompt),
            self._build_conversational_style(),
            self._build_guardrails(),
        ]

        # Add mode-specific instructions (flexible vs sequential)
        parts.append(self._build_mode_instructions(mode, current_task, next_task))

        # Use different format based on mode
        if self._use_tools:
            parts.append(self._build_tool_instructions(deliverables, available_tasks))
        else:
            parts.append(self._build_response_format())
            parts.append(self._build_deliverable_rules(deliverables))

        # Add collected deliverables section (for update capability)
        collected_section = self._build_collected_section(collected_deliverables)
        if collected_section:
            parts.append(collected_section)

        # Add context if state machine is initialized
        if state:
            parts.append(self._build_context(state, mode, progress, current_task, available_tasks))

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

    def _build_conversational_style(self) -> str:
        """Build conversational style rules for natural-sounding speech."""
        return """## Conversational Style (CRITICAL - Follow These Rules)
You are a calm, observant, and grounded conversationalist. Your goal is to sound like a thoughtful peer.

### Linguistic Rules
- **Mandatory Contractions**: Never use "do not," "it is," or "I am." Always use "don't," "it's," "I'm," etc.
- **Safe Fillers**: Occasionally start responses with "Yeah," "Well," "Right," or "I mean," followed by a comma. Do NOT use "Mhmm" or "Uh."
- **Natural Transitions**: Use "Actually," "Anyway," or "Plus" instead of formal linking words.

### TTS Optimization (for natural speech rhythm)
- **Breathing Pauses**: Use a comma every 7-10 words to create natural pauses.
- **Thinking Pauses**: Use an ellipsis (...) after an opening filler to simulate a thoughtful beat (e.g., "Yeah... that's a good point.").
- **Pitch Control**: End thoughts with a period (.) for a natural pitch drop. Use one question mark (?) at the very end for rising intonation.

### Response Structure
1. Start with a "Safe Filler" + comma or ellipsis
2. Provide a concise, neutral observation (max 2 sentences)
3. End with a simple, low-pressure follow-up question

**Keep responses under 4 sentences total.**"""

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

    def _build_tool_instructions(
        self, deliverables: List[Dict], available_tasks: Optional[List[Dict]] = None
    ) -> str:
        """Build tool usage instructions for tool-based state management."""
        pending = [d for d in deliverables if d.get("status") == "pending"]

        parts = ["""## Response Guidelines
- Respond naturally and conversationally (30-50 words)
- Ask only ONE question at a time
- Always include a complete, conversational response
- Your response will be spoken aloud - make it sound natural

## Tool Usage
You have tools to track conversation progress. Use them appropriately:

**set_deliverable** - Call when the user CLEARLY and EXPLICITLY provides information you need to collect
- Only call when you are certain the user provided the information
- NEVER call for greetings (hi, hello, hey, good morning, etc.)
- NEVER guess or infer values
- If unsure, ask a clarifying question instead

**complete_task** - Call when you complete a task that doesn't require collecting data
- Examples: telling a joke, saying goodbye, providing an explanation
- Only call after you have actually performed the task"""]

        if pending:
            parts.append("\n## Information to Collect")
            parts.append("Use set_deliverable when the user provides these:")
            for d in pending:
                required_marker = "*" if d.get("required", True) else "(optional)"
                parts.append(f"\n**{d['key']}** {required_marker}")
                parts.append(f"  Description: {d.get('description', '')}")

                # Show type information
                dtype = d.get("type", "string")
                if dtype == "enum" and d.get("enum_values"):
                    values = ", ".join(str(v) for v in d['enum_values'])
                    parts.append(f"  Type: enum - must be one of: {values}")
                elif dtype == "number":
                    parts.append(f"  Type: number (numeric value)")
                elif dtype != "string":
                    parts.append(f"  Type: {dtype}")

                if d.get("acceptance_criteria"):
                    parts.append(f"  Criteria: {d['acceptance_criteria']}")
                if d.get("examples"):
                    examples = ", ".join(str(e) for e in d['examples'][:5])
                    parts.append(f"  Examples: {examples}")

        if available_tasks:
            tasks_without_deliverables = [
                t for t in available_tasks
                if not t.get('has_deliverables', True)
            ]
            if tasks_without_deliverables:
                parts.append("\n## Tasks to Complete")
                parts.append("Use complete_task after performing these:")
                for t in tasks_without_deliverables:
                    parts.append(f"- **{t.get('id')}**: {t.get('description', '')}")

        return "\n".join(parts)

    def _build_response_format(self) -> str:
        """Build response format instructions."""
        return """## Response Format
You MUST respond using this EXACT format:

MESSAGE: [Your conversational response here - 30-50 words, max 1 question]
DELIVERABLES: [JSON object with extracted values] or [NONE]
COMPLETED_TASKS: ["task_id_1", "task_id_2"] or [NONE]

Example responses:

Example 1 - Collecting a deliverable (user provided their name):
MESSAGE: That's wonderful to hear, Sarah! I love how passionate you are about gardening. It sounds like such a peaceful hobby. What kinds of plants do you enjoy growing the most?
DELIVERABLES: {"user_name": {"value": "Sarah", "reasoning": "User introduced herself as Sarah"}}
COMPLETED_TASKS: [NONE]

Example 2 - No deliverables collected this turn:
MESSAGE: Thanks for sharing that with me! I'd love to learn more about you. What do you enjoy doing in your free time?
DELIVERABLES: [NONE]
COMPLETED_TASKS: [NONE]

Example 3 - Completing a task that has NO deliverables (like telling a joke):
MESSAGE: Here's one for you - Why don't scientists trust atoms? Because they make up everything! I hope that gave you a little chuckle. It was truly wonderful chatting with you today.
DELIVERABLES: [NONE]
COMPLETED_TASKS: ["tell_joke"]

### COMPLETED_TASKS Rules
- Use COMPLETED_TASKS to mark tasks as done when they DON'T require data collection
- Only mark tasks that you have actually performed in your MESSAGE
- Tasks that collect deliverables are automatically completed when all deliverables are collected
- Format: JSON array of task IDs, e.g., ["tell_joke", "say_goodbye"]"""

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
        current_task: Optional[Dict],
        available_tasks: Optional[List[Dict]] = None
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

        # Show tasks without deliverables that need explicit completion
        if available_tasks:
            tasks_without_deliverables = [
                t for t in available_tasks
                if not t.get('has_deliverables', True)
            ]
            if tasks_without_deliverables:
                parts.append("\n**Tasks to complete (no data collection needed):**")
                for t in tasks_without_deliverables:
                    parts.append(f"- {t.get('id')}: {t.get('description', '')}")
                parts.append("Mark these as done using COMPLETED_TASKS when you perform them.")

        return "\n".join(parts)

    def _build_state_transition_warning(self, state: Dict) -> str:
        """Build warning when state just changed."""
        return f"""## State Transition Notice
You just transitioned to a new state: **{state.get('title', 'Unknown')}**
Take a moment to acknowledge this transition naturally and introduce the new topic/focus area.
Do NOT continue collecting information from the previous state."""

    def _build_mode_instructions(
        self,
        mode: str,
        current_task: Optional[Dict] = None,
        next_task: Optional[Dict] = None
    ) -> str:
        """
        Build mode-specific instructions for flexible vs sequential conversation.

        Args:
            mode: 'strict' (sequential) or 'loose' (flexible)
            current_task: The current task to focus on
            next_task: Preview of next task (for strict mode smooth transitions)
        """
        if mode == "strict":
            parts = ["""## Sequential Mode
You must complete tasks in ORDER. Focus on the current task until it's complete."""]

            if current_task:
                parts.append(f"\n**Current Task:** {current_task.get('description', '')}")
                if current_task.get('instruction'):
                    parts.append(f"**Instruction:** {current_task['instruction']}")

            if next_task:
                parts.append(f"\n**Coming Next:** {next_task.get('description', '')} (don't start yet, but you can transition smoothly)")

            parts.append("""
**Rules:**
- Complete the current task before moving to the next
- If user mentions info for the next task, acknowledge but stay focused on current
- Transition naturally when the current task completes""")

            return "\n".join(parts)
        else:
            # LOOSE (flexible) mode
            return """## Flexible Mode
You can collect information in any natural order based on conversation flow.

**Rules:**
- Ask about ONE thing at a time, but choose based on natural conversation flow
- If user provides multiple pieces of info in one response, collect them all
- Prioritize REQUIRED items first, then optional ones if naturally offered
- You CAN update already-collected information if user provides corrections"""

    def _build_collected_section(self, collected: Dict[str, Any]) -> str:
        """
        Build section showing already-collected deliverables for update capability.

        Args:
            collected: Dict of key -> value for collected deliverables
        """
        if not collected:
            return ""

        parts = ["## Already Collected (can be updated if user corrects)"]
        for key, value in collected.items():
            # Format value nicely
            if isinstance(value, str):
                display_value = f'"{value}"'
            else:
                display_value = str(value)
            parts.append(f"- **{key}**: {display_value}")

        parts.append("\nIf the user provides updated or corrected information for any of these, use set_deliverable to update the value.")

        return "\n".join(parts)

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
