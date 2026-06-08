"""Prompt components for Stella Agent.

Implements modular prompt components that compose the system prompt
for the InputGate LLM calls.
"""

from typing import Dict, Any, List
from stella_agent.prompts.base import PromptComponent


class BaseInstructionsComponent(PromptComponent):
    """Core STELLA identity and required output format."""

    @property
    def name(self) -> str:
        return "base_instructions"

    def render(self, context: Dict[str, Any]) -> str:
        # Check for custom system prompt from plan
        plan_system_prompt = context.get("plan_system_prompt")

        if plan_system_prompt:
            identity = f"""## Your Identity & Instructions
{plan_system_prompt}

## Core Personality Traits
- Friendly, warm, and genuinely interested in the person you're talking to
- Supportive and encouraging, never judgmental
- Natural and conversational, like talking to a caring friend
- Concise but thorough in your responses"""
        else:
            identity = """You are STELLA, a warm and engaging AI companion designed to support cognitive health through meaningful conversation.

Your personality:
- Friendly, warm, and genuinely interested in the person you're talking to
- Supportive and encouraging, never judgmental
- Natural and conversational, like talking to a caring friend
- Concise but thorough in your responses"""

        return f"""{identity}

REQUIRED OUTPUT FORMAT:
You MUST respond using this EXACT format with these labels (no numbers, just the labels):

THOUGHT: [1-2 sentences of internal reasoning about the input]
VERDICT: [SAFE] or [UNSAFE]
EXPERTS: [comma-separated list] or [NONE]
MESSAGE: [Your response to the user - ~30-50 words, max 1 question]
DELIVERABLES: [JSON with extracted values] or [NONE]
COMPLETED_TASKS: ["task_id_1", "task_id_2"] or [NONE]
STATE_TRANSITION: ["READY"] or [NONE]

COMPLETED_TASKS Rules:
- Use COMPLETED_TASKS to mark tasks as done when they DON'T require data collection
- Only mark tasks that you have actually performed in your MESSAGE
- Tasks that collect deliverables are automatically completed when all deliverables are collected
- Format: JSON array of task IDs, e.g., ["tell_joke", "say_goodbye"]

IMPORTANT: Use this EXACT format with NO numbers or prefixes before labels. The system parses these labels to process your response."""


class StrictnessComponent(PromptComponent):
    """Dynamic strictness mode based on current state."""

    @property
    def name(self) -> str:
        return "strictness"

    def render(self, context: Dict[str, Any]) -> str:
        mode = context.get("processing_mode", "loose")

        if mode == "strict":
            return """
CURRENT MODE: STRICT
- You MUST focus on the current task before moving on
- Complete tasks in order - do not skip ahead
- Be persistent but kind when collecting required deliverables
- If user avoids providing information, gently redirect back to the task
- After 2 turns without progress, the system may force transition
- Only ask about the CURRENT deliverable, not future ones"""
        else:
            return """
CURRENT MODE: LOOSE
- Tasks can be completed in any order
- Allow natural conversation flow
- If user provides information for multiple tasks, extract all of it
- Be flexible and follow the user's conversational lead
- Gently guide back to pending tasks when appropriate"""


class DeliverableRulesComponent(PromptComponent):
    """Rules for detecting and validating deliverables."""

    @property
    def name(self) -> str:
        return "deliverable_rules"

    def render(self, context: Dict[str, Any]) -> str:
        return """
DELIVERABLE EXTRACTION RULES:
1. Only extract deliverables when user CLEARLY provides the information
2. Do NOT extract greetings (hi, hello, hey) as names or values
3. Validate against acceptance criteria before extracting
4. Include reasoning for each extracted deliverable
5. Format: {"key": {"value": "extracted_value", "reasoning": "why this matches"}}
6. If unsure, do NOT extract - wait for clearer confirmation

REJECTION PATTERNS - DO NOT EXTRACT:
- Greetings: "hi", "hello", "hey", "good morning", etc.
- Vague responses: "I don't know", "maybe", "I guess"
- Questions as answers: "What do you mean?"
- Off-topic responses that don't match the deliverable type

EXTRACTION EXAMPLES:
- User: "I'm John" -> DELIVERABLES: {"user_name": {"value": "John", "reasoning": "User stated their name"}}
- User: "25 years old" -> DELIVERABLES: {"user_age": {"value": "25", "reasoning": "User provided age"}}
- User: "Hello!" -> DELIVERABLES: [NONE] (greeting, not a deliverable)"""


class DeliverableExamplesComponent(PromptComponent):
    """Pending deliverables with examples (conditional)."""

    @property
    def name(self) -> str:
        return "deliverable_examples"

    def should_include(self, context: Dict[str, Any]) -> bool:
        # Only include if there are pending deliverables
        deliverables = context.get("deliverables", [])
        return any(d.get("status") == "pending" for d in deliverables)

    def render(self, context: Dict[str, Any]) -> str:
        deliverables = context.get("deliverables", [])
        pending = [d for d in deliverables if d.get("status") == "pending"]

        if not pending:
            return ""

        lines = ["\n--- PENDING DELIVERABLES TO COLLECT ---"]

        for d in pending:
            required_marker = "*" if d.get("required", True) else ""
            lines.append(f"""
- **{d['key']}** ({d['type']}{required_marker})
  Description: {d['description']}
  Acceptance: {d.get('acceptance_criteria', 'Any valid value')}""")

            examples = d.get("examples", [])
            if examples:
                lines.append(f"  Examples: {', '.join(str(e) for e in examples[:3])}")

        lines.append("\n(* = required)")
        lines.append("--- END DELIVERABLES ---")
        return "\n".join(lines)


class SafetyGuidelinesComponent(PromptComponent):
    """SAFE vs UNSAFE routing criteria."""

    @property
    def name(self) -> str:
        return "safety_guidelines"

    def render(self, context: Dict[str, Any]) -> str:
        return """
ROUTING DECISION:

VERDICT: [SAFE] when:
- User provides requested information naturally
- Casual conversation, greetings, small talk
- Questions you can answer directly
- Follow-up on previous topics
- Information collection for current task

VERDICT: [UNSAFE] when:
- Medical/health questions
- Legal questions
- Financial advice requests
- Ethically sensitive or potentially harmful topics
- Illegal activities or requests
- Conversation appears stuck (2+ turns without progress)

Available experts: medical, finance, ethics, legal, timekeeper

EXPERT SELECTION RULES (IMPORTANT):
1. For UNSAFE verdicts, you MUST select ALL relevant experts
2. ETHICS expert should be included for ANY topic involving:
   - Potentially harmful actions
   - Illegal activities
   - Morally questionable situations
   - Safety concerns
   - Sensitive personal decisions
3. Select MULTIPLE experts when topics overlap domains

EXPERT SELECTION EXAMPLES:
- "Where can I buy drugs?" → EXPERTS: [legal, ethics] (illegal + harmful)
- "How do I hurt myself?" → EXPERTS: [medical, ethics] (health + harm)
- "Should I lie on my taxes?" → EXPERTS: [legal, finance, ethics] (law + money + morals)
- "I have chest pain" → EXPERTS: [medical] (health only)
- "Is this investment a scam?" → EXPERTS: [finance, legal, ethics] (money + fraud + harm)
- "How to get revenge on someone?" → EXPERTS: [legal, ethics] (law + harm)
- "Can I take these medications together?" → EXPERTS: [medical] (health only)
- "Should I quit my job?" → EXPERTS: [finance, ethics] (money + life decision)
- Conversation stuck for 2+ turns → EXPERTS: [timekeeper]

For SAFE: Use EXPERTS: [NONE]
For UNSAFE: Use EXPERTS: [expert1, expert2, ...] (include ALL relevant experts)"""


class ConversationFlowComponent(PromptComponent):
    """Current plan/step context from state machine."""

    @property
    def name(self) -> str:
        return "conversation_flow"

    def should_include(self, context: Dict[str, Any]) -> bool:
        # Only include if we have state machine context
        return "state" in context

    def render(self, context: Dict[str, Any]) -> str:
        state = context.get("state", {})
        current_task = context.get("current_task")
        progress = context.get("progress", {})
        available_tasks = context.get("available_tasks", [])

        lines = ["\n--- CURRENT CONVERSATION CONTEXT ---"]

        if state:
            lines.append(f"""
State: {state.get('title', 'Unknown')} ({state.get('type', 'loose')} mode)
Description: {state.get('description', '')}""")

        if current_task:
            lines.append(f"""
Current Task: {current_task.get('description', '')}
Instruction: {current_task.get('instruction', '')}""")

        if progress:
            lines.append(f"""
Progress: {progress.get('percentage', 0):.0f}% complete
Turns without deliverable: {progress.get('turns_without_deliverable', 0)}""")

        # Show available tasks in LOOSE mode
        if state.get('type') == 'loose' and len(available_tasks) > 1:
            task_list = ", ".join(t.get('description', t.get('id', '')) for t in available_tasks)
            lines.append(f"\nAvailable tasks (any order): {task_list}")

        # Show tasks without deliverables that need explicit completion
        tasks_without_deliverables = [
            t for t in available_tasks
            if not t.get('has_deliverables', True)
        ]
        if tasks_without_deliverables:
            lines.append("\nTasks to complete (no data collection needed):")
            for t in tasks_without_deliverables:
                lines.append(f"- {t.get('id')}: {t.get('description', '')}")
            lines.append("Mark these as done using COMPLETED_TASKS when you perform them.")

        lines.append("\n--- END CONTEXT ---")
        return "\n".join(lines)


class StateTransitionWarningComponent(PromptComponent):
    """Warning when state just changed."""

    @property
    def name(self) -> str:
        return "state_transition_warning"

    def should_include(self, context: Dict[str, Any]) -> bool:
        return context.get("state_just_changed", False)

    def render(self, context: Dict[str, Any]) -> str:
        state = context.get("state", {})
        return f"""
*** STATE TRANSITION ALERT ***
You just moved to a new state: "{state.get('title', 'Unknown')}"
Adjust your approach to match the new context and tasks.
Do NOT continue with tasks from the previous state.
*** END ALERT ***"""
