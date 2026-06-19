"""Bridge Generator — natural conversational bridge for early TTS synthesis.

Generates a brief, human-sounding acknowledgment (1-15 words, scaled to
the user's energy) that buys time while the main pipeline
(experts → arbitration → response) completes. Runs in parallel with the
Expert Pool via asyncio.gather() (#363: there is no Input Gate to run beside).

On failure: returns a short fallback bridge. Every turn always gets a bridge.
"""

import asyncio
import random
import re
import time
from typing import Dict, Any, List, Optional

from stella_agent_sdk.env import env_bool as _env_bool, env_float as _env_float
from stella_agent_sdk.llm import LLMService, LLMConfig, LLMMessage, LLMProvider
from stella_v2_agent.pipeline.language_resolver import LANGUAGE_NAMES as _LANGUAGE_NAMES
from stella_v2_agent.prompts.template import render_prompt
from stella_v2_agent.prompts.context import format_history
import logging

logger = logging.getLogger(__name__)


def _coerce_bool(value: Any) -> bool:
    """Coerce a config value to bool, accepting the select's "on"/"off" strings.

    The configurator has no boolean slot type, so a toggle arrives as the string
    "on"/"off" (or already a bool). ``bool("off")`` is True, so we must parse the
    string rather than cast it.
    """
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1", "yes", "on")
    return bool(value)

# Minimal fallback only. The full, editable bridge prompt lives in agent.yaml
# (bridge_generator → system_prompt) and is what runs in production; this default
# is used solely when no configured prompt is provided. It stays reflection-only
# and short so the fallback is always safe (no appraisal, no questions).
BRIDGE_SYSTEM_PROMPT = """You just heard the user and you're about to answer, but first you briefly acknowledge them the way a real person would — a short, natural beat, spoken aloud on its own.
{{#if conversationHistory}}

Recent context:
{{conversationHistory}}
{{/if}}

- End with . or ! — never ask a question.
- 1-2 words for a short answer or greeting; up to ~12 words to briefly reflect a longer turn in their own words.
- Never answer, advise, or evaluate what they said — just receive it and lead in.
- Mirror the specific thing they said, not a generic "okay". Match the user's language.
{{#if isBargeIn}}
The user just interrupted you — acknowledge it briefly and yield ("Oh, go ahead."). Don't continue your previous point.
{{/if}}
Output ONLY the bridge. No quotes, no labels."""

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


# ── Appraisal risk screen (bridge naturalness, #343 follow-up) ───────────────
# The bridge runs BEFORE the experts, so it cannot know whether the agent's real
# answer will be dispreferred (a "no", a caution, a correction). A light appraisal
# ("that's a solid routine") is jarring — or unsafe — ahead of such an answer.
# Before allowing any appraisal we run this cheap, deterministic, LLM-free screen
# on the user input; if it trips, the bridge clamps back to pure reflection.
#
# The screen is intentionally trigger-happy: suppressing appraisal is the SAFE
# direction (you just fall back to a reflective bridge), so over-triggering costs
# nothing, while a miss is the exact failure mode we're guarding against. It does
# NOT replace the experts — they still govern the real response — it only decides
# whether the pre-expert bridge may affirm.
_APPRAISAL_RISK_WORDS = {
    # health / medical (EN)
    "hurt", "injured", "injury", "pain", "painful", "sick", "ill", "illness",
    "disease", "diagnosis", "diagnosed", "symptom", "symptoms", "surgery",
    "hospital", "doctor", "medication", "meds", "chronic", "disabled", "disability",
    # health / medical (DE)
    "verletzt", "verletzung", "schmerz", "schmerzen", "krank", "krankheit",
    "diagnose", "operation", "krankenhaus", "arzt", "ärztin", "medikament",
    # mental health / distress (EN)
    "depressed", "depression", "anxious", "anxiety", "stressed", "overwhelmed",
    "burnout", "burnt", "exhausted", "suicidal", "hopeless", "lonely", "grief",
    "grieving", "died", "death", "struggling", "panic",
    # mental health / distress (DE)
    "depressiv", "angst", "gestresst", "überfordert", "erschöpft", "einsam",
    "trauer", "gestorben", "panik", "hoffnungslos",
    # legal (EN/DE)
    "lawyer", "lawsuit", "court", "sue", "sued", "legal", "anwalt", "gericht",
    "klage", "rechtlich",
    # dispreferred / negation markers (EN/DE) — a "no"/"didn't"/"never" turn
    "no", "not", "didn't", "haven't", "won't", "can't", "cannot", "never",
    "nothing", "lazy", "failed", "fail", "nein", "nicht", "nee", "nie",
    "nichts", "faul",
}

# Multi-word markers a single-token scan would miss.
_APPRAISAL_RISK_PHRASES = (
    "not really", "haven't been", "have not been", "gave up", "give up",
    "kann nicht", "keine lust", "keine motivation", "aufgegeben", "war faul",
)


def _screen_risk(user_input: str) -> bool:
    """Return True when the turn is too sensitive/dispreferred for an appraisal.

    Cheap and deterministic — no LLM, no dependency on the (being-removed) input
    gate. Biased toward suppression: a hit means "clamp the bridge to reflection".
    """
    text = user_input.lower()
    words = set(re.findall(r"[a-zäöüß']+", text))
    if words & _APPRAISAL_RISK_WORDS:
        return True
    return any(phrase in text for phrase in _APPRAISAL_RISK_PHRASES)


class BridgeGenerator:
    """Generates a short conversational bridge for early TTS synthesis.

    Uses a dedicated LLM call with higher temperature for natural variety.
    Emitted up front (before the experts run) so the user hears a natural beat
    while the rest of the pipeline computes.
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

        # Appraisal tier (#343 follow-up). When OFF (default), the bridge is
        # strictly reflective — it never evaluates what the user said (the #304 A2
        # guarantee). When ON, the LLM bridge MAY add a brief, understated
        # appraisal of the user's situation, but ONLY when the risk screen
        # (_screen_risk) clears — so it never affirms ahead of a sensitive or
        # dispreferred answer. The templated fast-path/fallback never appraises
        # regardless, so the deterministic route stays veto-proof. Opt-in and
        # A/B-able via BRIDGE_APPRAISAL, mirroring BRIDGE_FAST_PATH.
        self.appraisal_enabled: bool = _env_bool("BRIDGE_APPRAISAL", False)

    def apply_config(self, config: dict) -> None:
        """Apply configuration overrides from the Agent Configurator.

        The configurator is the primary control surface for the bridge: every
        knob below maps to a slot on the ``bridge_generator`` node in agent.yaml
        (prompt, model, temperature, max_tokens, fast_path, timeout_ms). The env
        vars (BRIDGE_FAST_PATH / BRIDGE_TIMEOUT_MS) are only deploy-time defaults
        — any value set here overrides them.
        """
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
            self.fast_path_enabled = _coerce_bool(config["fast_path"])
        if "appraisal" in config:
            self.appraisal_enabled = _coerce_bool(config["appraisal"])
        if config.get("timeout_ms") not in (None, ""):
            self.bridge_timeout_s = float(config["timeout_ms"]) / 1000

    def fast_bridge(self, user_input: str, language: Optional[str] = None) -> str:
        """Return a typed templated bridge INSTANTLY — no LLM call (#304 A3).

        Picks the sub-type with :func:`select_bridge_type` and a phrase from the
        matching inventory. Used for the fast-path and as the failure fallback,
        so both routes are guaranteed to land inside the gap window.

        (No ``predicted_cost`` here: at bridge time the expert count doesn't exist
        yet — the bridge runs in parallel with the gate — so selection uses the
        input-shape heuristic. ``select_bridge_type`` keeps a ``predicted_cost``
        hook for if/when a pre-gate cost estimate becomes available.)
        """
        is_german = (language == "de") if language else _detect_german(user_input)
        bridge_type = select_bridge_type(user_input)
        return pick_bridge_from_inventory(bridge_type, is_german)

    async def generate(
        self,
        user_input: str,
        conversation_history: List[Dict[str, str]],
        language: Optional[str] = None,
        variables: Optional[Dict[str, Any]] = None,
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

        Returns:
            A validated bridge phrase (1-15 words, scaled to user energy). Always returns a bridge (fallback on failure).
        """
        start_time = time.time()

        # Fast-path (#304 A3): skip the LLM entirely and serve an instant typed
        # template. Guarantees the bridge lands inside the gap window instead of
        # waiting up to ``bridge_timeout_s`` for the LLM that masks latency.
        if self.fast_path_enabled:
            bridge = self.fast_bridge(user_input, language)
            logger.info(f"Fast-path bridge '{bridge}' in {(time.time() - start_time) * 1000:.0f}ms")
            return bridge

        # Appraisal is allowed only when enabled AND the turn clears the risk
        # screen — so the bridge never affirms ahead of a sensitive/dispreferred
        # answer it can't yet see. Off → strictly reflective (the #304 A2 default).
        allow_appraisal = self.appraisal_enabled and not _screen_risk(user_input)

        try:
            # The interruption/answer being reacted to is the bare user message;
            # all context is placed by the prompt via template variables.
            user_message = user_input

            raw_prompt = self.custom_system_prompt or BRIDGE_SYSTEM_PROMPT
            # Render template variables into the prompt so the bridge can adapt:
            # the recent context ({{conversationHistory}}), whether the turn is a
            # barge-in ({{isBargeIn}}), and whether a brief appraisal is permitted
            # ({{allowAppraisal}}).
            ctx = {
                **(variables or {}),
                "userInput": user_input,
                "conversationHistory": format_history(conversation_history, self.history_limit or 2),
                "allowAppraisal": allow_appraisal,
            }
            system_prompt = render_prompt(raw_prompt, ctx)
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
            bridge = self._validate_bridge(response.content, allow_appraisal=allow_appraisal)
            if bridge:
                logger.info(f"'{bridge}' in {latency_ms:.0f}ms")
                return bridge

            # Validation failed — use context-appropriate fallback
            fallback = self.fast_bridge(user_input, language)
            logger.info(f"Validation failed, fallback '{fallback}' in {latency_ms:.0f}ms")
            return fallback

        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            fallback = self.fast_bridge(user_input, language)
            logger.error(f"Failed in {latency_ms:.0f}ms: {e}, fallback '{fallback}'")
            return fallback

    @staticmethod
    def _validate_bridge(raw: str, allow_appraisal: bool = False) -> str:
        """Validate the bridge phrase. Returns "" if invalid.

        The bridge must be a natural spoken acknowledgment ending with . or !
        Questions are always rejected — bridges must never ask the user anything.
        Evaluative commentary is rejected UNLESS ``allow_appraisal`` is set (the
        risk-screened appraisal tier) — by default bridges must not judge the
        user's input.
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

        # Max 25 words — the bridge now carries the full reflective opener (and a
        # brief appraisal when allowed), up to ~one or two short sentences.
        if len(bridge.split()) > 25:
            return ""

        # Reject evaluative commentary ("That's a great question!", "What a nice thought!")
        # unless the risk-screened appraisal tier is active for this turn.
        if not allow_appraisal:
            lower = bridge.lower()
            if lower.startswith(("that's a", "that's an", "what a", "what an")):
                return ""

        # Must end with sentence-ending punctuation (no questions)
        if bridge[-1] not in ".!":
            bridge += "."

        return bridge
