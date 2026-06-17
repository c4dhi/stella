"""Bridge Generator — natural conversational bridge for early TTS synthesis.

Generates a brief, human-sounding acknowledgment (1-15 words, scaled to
the user's energy) that buys time while the main pipeline
(gate → experts → arbitration → response) completes. Runs in parallel with
the Input Gate via asyncio.gather().

On failure: returns a short fallback bridge. Every turn always gets a bridge.
"""

import asyncio
import os
import random
import time
from typing import Dict, Any, List, Optional

from stella_v2_agent.llm.service import LLMService, LLMConfig, LLMMessage, LLMProvider
from stella_v2_agent.pipeline.language_resolver import LANGUAGE_NAMES as _LANGUAGE_NAMES
from stella_v2_agent.prompts.template import render_prompt
import logging

logger = logging.getLogger(__name__)


def _env_float(name: str, default: float) -> float:
    """Read a float env var, tolerating empty/blank/invalid → default.

    An optional declared env var can reach the pod as an empty string, which
    ``os.getenv(name, default)`` returns instead of the default — so
    ``float("")`` would crash the agent at startup. Empty/whitespace/unparseable
    all fall back to the default.
    """
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Invalid %s=%r; using default %s", name, raw, default)
        return default


def _env_bool(name: str, default: bool) -> bool:
    """Read a bool env var ("true"/"1"/"yes" → True), tolerating empty → default."""
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in ("true", "1", "yes", "on")

BRIDGE_SYSTEM_PROMPT = """You are a person in a conversation. You just heard what the user said and you're about to give your full answer, but first you naturally acknowledge them — the way a real human would before continuing their thought. This will be spoken aloud by TTS.

Think of how people actually talk. When someone tells you something, you don't just launch into your answer — you react briefly first. The bridge is that brief, human moment.

LENGTH RULE — match the user's energy:
- One word from user ("yes", "no", "okay") → one-two words from you. "Sure." / "Yeah." / "Okay."
- A greeting ("hi", "hello") → greet back casually. "Hey." / "Hi there." / "Hello."
- A short sentence → a short acknowledgment, up to 5-6 words. "Yeah, I get that." / "Okay, gotcha."
- A longer thought or story → you can reflect back briefly, up to 12 words. "Right, yeah, that sounds like it's been on your mind." / "Okay, so you've been dealing with that for a while."
- Something emotional or vulnerable → warm but grounded. "Yeah, I hear you." / "Right, that makes total sense."

WHAT MAKES A GOOD BRIDGE:
- It sounds like something a real person would say mid-conversation
- It can reference what the user said WITHOUT answering, advising, or completing any task
- It feels like a natural lead-in to whatever comes next
- It uses casual spoken language (contractions, "yeah" instead of "yes", etc.)

WHAT TO AVOID:
- NEVER answer the user's question or give advice — you're just acknowledging before your real answer
- NEVER ask a question. No question marks.
- NEVER be a cheerleader — no "Oh that's wonderful!", "That's amazing!", "Great question!"
- NEVER evaluate what they said — no "That's interesting", "That's a good point"
- NEVER use filler sounds that render poorly in TTS: "mhm", "hmm", "uh-huh", "ah"
- NEVER use the same bridge twice in a conversation

EXAMPLES (user → bridge):
- "I've been running three times a week" → "Oh nice, okay."
- "Not really, I've been pretty lazy" → "Yeah, no worries."
- "I hurt my knee last month so I can't really exercise" → "Oh okay, yeah, that's tough."
- "hello" → "Hey."
- "yes" → "Okay."
- "I don't know, I guess I just haven't had the motivation lately and work has been really stressful" → "Yeah, okay, I get that, it's been a lot."
- "Ich laufe dreimal die Woche" → "Oh schön, okay."
- "Nee, ich war ziemlich faul" → "Ja, kein Ding."
- "Ich hab mir letzten Monat das Knie verletzt" → "Oh okay, ja, das ist echt blöd."
- "hallo" → "Hey."
- "ja" → "Okay."
- "Ich weiß nicht, ich hatte einfach keine Motivation und die Arbeit war echt stressig" → "Ja, okay, das kann ich verstehen."

LANGUAGE: Always match the user's language. If the user speaks German, your bridge MUST be in German. If the user speaks English, your bridge MUST be in English.
{{#if isBargeIn}}
BARGE-IN: The user just interrupted you mid-sentence. Acknowledge the interruption naturally and yield the floor — short and unflustered ("Oh, sorry — go ahead." / "Yeah?" / "Of course."). Do not resume your previous point.
{{/if}}
Output ONLY the bridge. No quotes, no labels, no explanation."""

# ── Typed bridge inventories (#304 A2) ───────────────────────────────────────
# Listener tokens are NOT interchangeable (Yngve 1970; Schegloff 1982). We pick
# a sub-type by context rather than emitting one generic "acknowledgement":
#   • GREETING       — greet back when the user greets.
#   • ACKNOWLEDGEMENT — "received, go on" for an ordinary completed turn.
#   • PENSIVE        — "let me think", signalling effortful/longer compute; used
#                      when the turn looks hard (a question, a long input).
#   • CONTINUER      — "mm-hm"-class. Reserved: continuers are mid-turn feedback
#                      while the OTHER party holds the floor, so they are usually
#                      wrong here (the user's turn is already complete). Kept for
#                      completeness; not selected by default.
# DELIBERATELY NO ASSESSMENT SUB-TYPE: evaluative tokens ("that's great", "wow")
# are jarring before dispreferred content (a "no"/correction the agent can't yet
# rule out at bridge time, since this runs before the experts). Omitting the
# class entirely is the structural guarantee the A2 acceptance criterion asks for.
BRIDGE_TYPE_GREETING = "greeting"
BRIDGE_TYPE_ACKNOWLEDGEMENT = "acknowledgement"
BRIDGE_TYPE_PENSIVE = "pensive"
BRIDGE_TYPE_CONTINUER = "continuer"

ACKNOWLEDGEMENT_BRIDGES_EN = [
    "Okay, yeah.",
    "Right, okay.",
    "Got it.",
    "Sure, okay.",
    "Yeah, I hear you.",
    "Alright.",
    "Yeah, gotcha.",
    "Okay, I follow.",
]

ACKNOWLEDGEMENT_BRIDGES_DE = [
    "Ja, okay.",
    "Okay, verstehe.",
    "Ja, alles klar.",
    "Ja, ich verstehe.",
    "Alles klar.",
    "Ja, genau.",
    "Okay, ich versteh.",
    "Ja, ich hör dich.",
]

# Pensive bridges signal "I'm working on something effortful" — they buy more
# floor for a harder turn and soften a longer wait. No TTS-poor sounds
# ("hmm"/"uh") — those render badly in our synth (see system prompt).
PENSIVE_BRIDGES_EN = [
    "Okay, let me think.",
    "Right, let me think for a sec.",
    "Okay, give me a moment.",
    "Let me think about that.",
]

PENSIVE_BRIDGES_DE = [
    "Okay, lass mich kurz überlegen.",
    "Moment, ich überlege kurz.",
    "Okay, einen Moment.",
    "Lass mich kurz nachdenken.",
]

GREETING_BRIDGES_EN = [
    "Hey.",
    "Hi there.",
    "Hello.",
    "Hey, hi.",
]

GREETING_BRIDGES_DE = [
    "Hey.",
    "Hallo.",
    "Hi.",
    "Hey, hallo.",
]

# Inventory lookup: (type, is_german) → list. Greeting/ack/pensive only;
# continuer intentionally has no inventory (not selected — see note above).
_BRIDGE_INVENTORY = {
    (BRIDGE_TYPE_GREETING, True): GREETING_BRIDGES_DE,
    (BRIDGE_TYPE_GREETING, False): GREETING_BRIDGES_EN,
    (BRIDGE_TYPE_PENSIVE, True): PENSIVE_BRIDGES_DE,
    (BRIDGE_TYPE_PENSIVE, False): PENSIVE_BRIDGES_EN,
    (BRIDGE_TYPE_ACKNOWLEDGEMENT, True): ACKNOWLEDGEMENT_BRIDGES_DE,
    (BRIDGE_TYPE_ACKNOWLEDGEMENT, False): ACKNOWLEDGEMENT_BRIDGES_EN,
}

# Backwards-compatible aliases (other modules/tests may import these names).
FALLBACK_BRIDGES_EN = ACKNOWLEDGEMENT_BRIDGES_EN
FALLBACK_BRIDGES_DE = ACKNOWLEDGEMENT_BRIDGES_DE
GREETING_FALLBACKS_EN = GREETING_BRIDGES_EN
GREETING_FALLBACKS_DE = GREETING_BRIDGES_DE

_GREETING_WORDS = {"hello", "hi", "hey", "hallo", "hei", "greetings", "good morning", "good evening", "good afternoon",
                   "guten morgen", "guten tag", "guten abend", "moin", "servus", "grüß gott"}

# German words/patterns for quick language detection on user input
_GERMAN_INDICATORS = {
    "ich", "du", "er", "sie", "wir", "ihr", "mein", "dein", "sein",
    "ist", "bin", "bist", "sind", "hat", "habe", "hatte", "war",
    "und", "oder", "aber", "weil", "dass", "nicht", "kein", "keine",
    "ja", "nein", "nee", "doch", "schon", "noch", "auch", "sehr",
    "das", "die", "der", "den", "dem", "des", "ein", "eine", "einem",
    "mit", "für", "von", "auf", "aus", "bei", "nach", "über", "unter",
    "hallo", "danke", "bitte", "tschüss", "genau", "okay",
}


def _detect_german(text: str) -> bool:
    """Quick heuristic: is this text likely German?"""
    words = set(text.lower().split())
    german_count = len(words & _GERMAN_INDICATORS)
    # If at least 2 German indicator words, or the text is short and has 1
    return german_count >= 2 or (len(words) <= 3 and german_count >= 1)


def _is_greeting(user_input: str) -> bool:
    """Is the user's whole turn just a greeting (hi/hello/hallo)?"""
    return user_input.strip().lower().rstrip("!.,?") in _GREETING_WORDS


# A turn longer than this (in words) reads as effortful → favour a pensive bridge
# that buys more floor while the heavier turn computes.
_PENSIVE_WORD_THRESHOLD = 25


def select_bridge_type(
    user_input: str,
    predicted_cost: Optional[int] = None,
) -> str:
    """Pick the bridge sub-type for a turn from context + predicted compute cost.

    Inputs (per #304 A2):
      • turn type — a bare greeting picks ``greeting``.
      • predicted compute cost — when known (e.g. number of experts the gate
        triggered), a heavier turn picks ``pensive``. When unknown (the bridge
        runs in parallel with the gate, before that count exists), a cheap proxy
        stands in: the user asked a question, or gave a long/complex turn.

    Never returns an assessment sub-type — none exists (see inventory note): an
    evaluative token before a not-yet-known dispreferred answer is the failure
    mode A2 guards against. Continuers are also not selected (mid-turn only).
    """
    if _is_greeting(user_input):
        return BRIDGE_TYPE_GREETING

    if predicted_cost is not None:
        # ≥2 experts / explicitly hard turn → effortful → pensive.
        if predicted_cost >= 2:
            return BRIDGE_TYPE_PENSIVE
        return BRIDGE_TYPE_ACKNOWLEDGEMENT

    # No cost signal yet — proxy from the input itself.
    text = user_input.strip()
    if "?" in text or len(text.split()) >= _PENSIVE_WORD_THRESHOLD:
        return BRIDGE_TYPE_PENSIVE
    return BRIDGE_TYPE_ACKNOWLEDGEMENT


def pick_bridge_from_inventory(
    bridge_type: str,
    is_german: bool,
) -> str:
    """Return a random templated bridge of ``bridge_type`` in the right language.

    Falls back to the acknowledgement inventory for any type without its own
    list (e.g. continuer), so this never raises on an unexpected type.
    """
    inventory = _BRIDGE_INVENTORY.get(
        (bridge_type, is_german),
        ACKNOWLEDGEMENT_BRIDGES_DE if is_german else ACKNOWLEDGEMENT_BRIDGES_EN,
    )
    return random.choice(inventory)


class BridgeGenerator:
    """Generates a short conversational bridge for early TTS synthesis.

    Uses a dedicated LLM call with higher temperature for natural variety.
    Runs in parallel with InputGate.classify() — whichever finishes first
    is used immediately.
    """

    def __init__(self, llm_service: LLMService):
        self._llm_service = llm_service

        # LLM config (overridable via apply_config)
        self.bridge_model = "gpt-4o-mini"
        self.bridge_max_tokens = 50
        self.bridge_temperature = 0.7
        self.custom_system_prompt: Optional[str] = None
        self.history_limit: int = 0  # 0 = default (2)
        # The bridge only buys ~1s while the main pipeline runs; it must never
        # stall the turn. If the LLM is slow (API latency spike), fall back to a
        # canned bridge instead of hanging. Tunable via BRIDGE_TIMEOUT_MS.
        self.bridge_timeout_s: float = _env_float("BRIDGE_TIMEOUT_MS", 2000.0) / 1000

        # Fast-path bridge (#304 A3). The LLM bridge can itself take up to
        # ``bridge_timeout_s`` to return — i.e. the latency-masking mechanism can
        # add latency and miss the gap window it exists to fill. When enabled,
        # the bridge is served INSTANTLY from the typed templated inventory (no
        # LLM call), guaranteeing first-byte inside the gap window. Trades the
        # LLM bridge's contextual richness for guaranteed timing, so it's opt-in
        # via BRIDGE_FAST_PATH and easy to A/B against the A1 baseline.
        self.fast_path_enabled: bool = _env_bool("BRIDGE_FAST_PATH", False)

    def apply_config(self, config: dict) -> None:
        """Apply configuration overrides from Agent Configurator."""
        if "model" in config:
            self.bridge_model = config["model"]
        if "max_tokens" in config:
            self.bridge_max_tokens = int(config["max_tokens"])
        if "temperature" in config:
            self.bridge_temperature = float(config["temperature"])
        if "system_prompt" in config:
            self.custom_system_prompt = config["system_prompt"]
        if "history_limit" in config:
            self.history_limit = int(config["history_limit"])
        if "fast_path" in config:
            self.fast_path_enabled = bool(config["fast_path"])

    def fast_bridge(
        self,
        user_input: str,
        language: Optional[str] = None,
        predicted_cost: Optional[int] = None,
    ) -> str:
        """Return a typed templated bridge INSTANTLY — no LLM call (#304 A3).

        Picks the sub-type with :func:`select_bridge_type` and a phrase from the
        matching inventory. Used for the fast-path and as the failure fallback,
        so both routes are guaranteed to land inside the gap window.
        """
        is_german = (language == "de") if language else _detect_german(user_input)
        bridge_type = select_bridge_type(user_input, predicted_cost=predicted_cost)
        return pick_bridge_from_inventory(bridge_type, is_german)

    async def generate(
        self,
        user_input: str,
        conversation_history: List[Dict[str, str]],
        language: Optional[str] = None,
        variables: Optional[Dict[str, Any]] = None,
        predicted_cost: Optional[int] = None,
    ) -> str:
        """Generate a bridge phrase for the given user input.

        Args:
            user_input: The current user message.
            conversation_history: Recent conversation messages.
            language: The resolved session language (e.g. "de"). When provided,
                it is the single source of truth — the bridge and its fallback
                are produced in this language, keeping the bridge coherent with
                the main response (RFC §8.2.1). When None, falls back to the
                legacy "match the user" heuristic.
            variables: Template variables for prompt rendering (e.g.
                ``isBargeIn``). Lets the configured bridge prompt react to
                context such as the turn being a barge-in.
            predicted_cost: Optional compute-cost signal (e.g. number of experts
                the gate triggered) used to pick a pensive vs. acknowledgement
                sub-type. Usually unknown at bridge time (the bridge runs in
                parallel with the gate); a heuristic proxy stands in then.

        Returns:
            A validated bridge phrase (1-15 words, scaled to user energy). Always returns a bridge (fallback on failure).
        """
        start_time = time.time()

        # Fast-path (#304 A3): skip the LLM entirely and serve an instant typed
        # template. Guarantees the bridge lands inside the gap window instead of
        # waiting up to ``bridge_timeout_s`` for the LLM that masks latency.
        if self.fast_path_enabled:
            bridge = self.fast_bridge(user_input, language, predicted_cost)
            logger.info(f"Fast-path bridge '{bridge}' in {(time.time() - start_time) * 1000:.0f}ms")
            return bridge

        try:
            user_message = self._build_user_message(user_input, conversation_history)

            raw_prompt = self.custom_system_prompt or BRIDGE_SYSTEM_PROMPT
            # Render template variables (isBargeIn, etc.) into the prompt so the
            # bridge can adapt — e.g. acknowledge that the user just interrupted.
            system_prompt = render_prompt(raw_prompt, variables or {})
            if language:
                system_prompt += (
                    f"\n\nRESOLVED LANGUAGE (overrides the rule above): "
                    f"Produce the bridge in {_LANGUAGE_NAMES.get(language, language)} only."
                )
            messages = [
                LLMMessage(role="system", content=system_prompt),
                LLMMessage(role="user", content=user_message),
            ]

            config = LLMConfig(
                model=self.bridge_model,
                temperature=self.bridge_temperature,
                max_tokens=self.bridge_max_tokens,
                provider=LLMProvider.OPENAI_LANGCHAIN,
                streaming=False,
                json_mode=False,
            )

            # Bound the bridge on wall-clock — a slow LLM must not stall the
            # whole turn (the user otherwise hears nothing and thinks the agent
            # is dead). On timeout, fall back to a canned bridge.
            response = await asyncio.wait_for(
                self._llm_service.generate(
                    messages=messages,
                    config=config,
                    component_name="bridge_generator",
                ),
                timeout=self.bridge_timeout_s,
            )

            latency_ms = (time.time() - start_time) * 1000
            bridge = self._validate_bridge(response.content)
            if bridge:
                logger.info(f"'{bridge}' in {latency_ms:.0f}ms")
                return bridge

            # Validation failed — use context-appropriate fallback
            fallback = self._pick_fallback(user_input, language)
            logger.info(f"Validation failed, fallback '{fallback}' in {latency_ms:.0f}ms")
            return fallback

        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            fallback = self._pick_fallback(user_input, language)
            logger.error(f"Failed in {latency_ms:.0f}ms: {e}, fallback '{fallback}'")
            return fallback

    @staticmethod
    def _pick_fallback(
        user_input: str,
        language: Optional[str] = None,
        predicted_cost: Optional[int] = None,
    ) -> str:
        """Pick a context-appropriate fallback bridge, in the resolved language.

        Now type-aware (#304 A2): selects greeting / acknowledgement / pensive
        from the matching inventory. Uses the resolved ``language`` when provided
        (single source of truth); otherwise the legacy German heuristic.
        """
        is_german = (language == "de") if language else _detect_german(user_input)
        bridge_type = select_bridge_type(user_input, predicted_cost=predicted_cost)
        return pick_bridge_from_inventory(bridge_type, is_german)

    @staticmethod
    def _validate_bridge(raw: str) -> str:
        """Validate the bridge phrase. Returns "" if invalid.

        The bridge must be a natural spoken acknowledgment ending with . or !
        Questions are always rejected — bridges must never ask the user anything.
        Evaluative commentary is rejected — bridges must not judge the user's input.
        """
        if not isinstance(raw, str) or not raw.strip():
            return ""

        bridge = raw.strip().strip('"').strip("'").strip()

        # Strip trailing ellipsis and re-check
        if bridge.endswith("..."):
            bridge = bridge[:-3].strip()

        if not bridge:
            return ""

        # Reject any bridge containing a question mark — bridges must never ask questions
        if "?" in bridge:
            return ""

        # Max 15 words — allows longer bridges that reference user input
        if len(bridge.split()) > 15:
            return ""

        # Reject evaluative commentary ("That's a great question!", "What a nice thought!")
        lower = bridge.lower()
        if lower.startswith(("that's a", "that's an", "what a", "what an")):
            return ""

        # Must end with sentence-ending punctuation (no questions)
        if bridge[-1] not in ".!":
            bridge += "."

        return bridge

    def _build_user_message(
        self,
        user_input: str,
        conversation_history: List[Dict[str, str]],
    ) -> str:
        """Build the user message with minimal context."""
        limit = self.history_limit or 2
        parts = []
        if conversation_history:
            recent = conversation_history[-limit:]
            lines = [f"[{msg['role'].upper()}]: {msg['content']}" for msg in recent]
            parts.append("CONTEXT:\n" + "\n".join(lines))

        parts.append(f"USER: {user_input}")
        return "\n\n".join(parts)
