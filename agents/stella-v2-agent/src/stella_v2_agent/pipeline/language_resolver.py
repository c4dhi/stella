"""Language resolver — single source of truth for the conversation language.

RFC: docs/rfcs/2026-06-01_language-handling.md

Today language is decided three times independently (bridge heuristic, response
prompt inference, static TTS env var) and they can drift apart within one turn.
This module collapses that into ONE resolved language per turn that the bridge,
the response prompt, the {{language}} template variable, and TTS all read.

Design (see RFC §8):
- Detect a per-turn ``(language, confidence)`` signal from the transcript text.
  This is modality-agnostic — voice transcripts and typed text flow through the
  same path (§8.3), so a future STT acoustic-detection signal is a drop-in
  replacement for ``detect_language`` here.
- Hold a session lock; switch only on a sustained, high-confidence change
  (§8 confidence-gated switch). Short/ambiguous utterances never flip it.
- Clamp to the supported set — never resolve to a language we cannot speak (§7).
- Fallback chain: confident signal → session lock → plan seed → default.

Scope: the committed v1 supported set is ``en``/``de`` (RFC §7), so the bundled
detector is a focused, dependency-free en/de classifier that returns a usable
confidence. Swapping in a broader detector only changes ``detect_language``.
"""

import re
from typing import Optional, Tuple

# Human-readable names for prompt injection.
LANGUAGE_NAMES = {"en": "English", "de": "German"}

# German function words / strong indicators.
_GERMAN_WORDS = {
    "ich", "du", "er", "sie", "wir", "ihr", "mein", "dein", "sein",
    "ist", "bin", "bist", "sind", "hat", "habe", "hatte", "war", "wird",
    "und", "oder", "aber", "weil", "dass", "nicht", "kein", "keine",
    "nein", "nee", "doch", "schon", "noch", "auch", "sehr", "mal",
    "das", "die", "der", "den", "dem", "des", "ein", "eine", "einen", "einem",
    "mit", "für", "von", "auf", "aus", "bei", "nach", "über", "unter",
    "hallo", "danke", "bitte", "tschüss", "genau", "wie", "was", "wer",
    "warum", "wann", "wo", "hier", "heute", "morgen", "gestern", "gut",
}

# English function words / strong indicators.
_ENGLISH_WORDS = {
    "i", "you", "he", "she", "we", "they", "my", "your", "his", "her",
    "is", "am", "are", "was", "were", "have", "has", "had", "will", "would",
    "and", "or", "but", "because", "that", "not", "no", "yes",
    "the", "a", "an", "this", "these", "those", "of", "to", "for", "from",
    "with", "on", "at", "in", "out", "about", "over", "under",
    "hello", "thanks", "please", "what", "who", "why", "when", "where",
    "here", "today", "tomorrow", "yesterday", "good", "how",
}

_WORD_RE = re.compile(r"[a-zà-ÿäöüß]+", re.IGNORECASE)
_UMLAUT_RE = re.compile(r"[äöüß]", re.IGNORECASE)


def detect_language(text: str) -> Tuple[Optional[str], float]:
    """Classify ``text`` as ``en`` or ``de`` with a confidence in ``[0, 1]``.

    Returns ``(None, 0.0)`` when there is no usable signal (empty, numeric, or
    no indicator words) so the caller can fall back. Confidence scales with the
    amount of evidence, so short/ambiguous input yields LOW confidence — that is
    what keeps a stray word from flipping the locked language.
    """
    if not text:
        return None, 0.0

    lowered = text.lower()
    words = _WORD_RE.findall(lowered)
    if not words:
        return None, 0.0

    de_hits = sum(1 for w in words if w in _GERMAN_WORDS)
    en_hits = sum(1 for w in words if w in _ENGLISH_WORDS)
    # Umlauts/ß are a strong, almost-exclusive German signal.
    umlauts = len(_UMLAUT_RE.findall(lowered))

    de_score = de_hits + 2 * umlauts
    en_score = en_hits
    total = de_score + en_score
    if total == 0:
        return None, 0.0

    if de_score >= en_score:
        lang, dominant = "de", de_score
    else:
        lang, dominant = "en", en_score

    # margin: how lopsided the evidence is (1.0 == fully one-sided).
    margin = (dominant - (total - dominant)) / total
    # evidence: more indicator hits → more trustworthy. Caps at 3 hits.
    evidence = min(1.0, total / 3.0)
    confidence = round(margin * evidence, 3)
    return lang, confidence


class LanguageResolver:
    """Holds the resolved session language and applies confidence-gated switching.

    One instance per agent. ``resolve(text)`` is called once per turn, before the
    bridge fires, and returns the language the whole turn (bridge, response, TTS)
    must use. The value is stable across turns unless a sustained, confident
    change is detected.
    """

    def __init__(
        self,
        supported: Tuple[str, ...] = ("de", "en"),
        default: str = "en",
        seed: Optional[str] = None,
        detect_threshold: float = 0.4,
        switch_threshold: float = 0.6,
        debounce: int = 1,
    ) -> None:
        self.supported = set(supported)
        self.default = default if default in self.supported else next(iter(self.supported))
        self.detect_threshold = detect_threshold
        self.switch_threshold = switch_threshold
        self.debounce = max(1, debounce)

        self.seed = seed if seed in self.supported else None
        self.locked: Optional[str] = None
        self._pending: Optional[str] = None
        self._pending_count = 0

    def apply_config(self, config: dict) -> None:
        """Apply resolver configuration overrides from the pipeline config.

        Recognized keys (all optional): ``supported`` (list of ISO codes),
        ``default`` (fallback language), ``detect_threshold``, ``switch_threshold``,
        ``debounce``. Unknown keys are ignored.
        """
        if "supported" in config and config["supported"]:
            self.supported = set(config["supported"])
        if "default" in config and config["default"] in self.supported:
            self.default = config["default"]
        elif self.default not in self.supported:
            self.default = next(iter(self.supported))
        if "detect_threshold" in config:
            self.detect_threshold = float(config["detect_threshold"])
        if "switch_threshold" in config:
            self.switch_threshold = float(config["switch_threshold"])
        if "debounce" in config:
            self.debounce = max(1, int(config["debounce"]))
        # Re-validate any seed against the (possibly new) supported set.
        self.seed = self.seed if self.seed in self.supported else None

    def set_seed(self, seed: Optional[str]) -> None:
        """Set the plan-declared language seed (``auto``/unsupported → no seed)."""
        self.seed = seed if seed in self.supported else None

    def _reset_pending(self) -> None:
        self._pending = None
        self._pending_count = 0

    def resolve(self, text: str) -> str:
        """Resolve the language for this turn (single source of truth).

        Fallback chain (RFC §8.3): confident supported signal → session lock →
        plan seed → default.
        """
        lang, confidence = detect_language(text)
        if lang not in self.supported:  # clamp; unsupported never wins (§7)
            lang, confidence = None, 0.0

        # First turn: establish the lock.
        if self.locked is None:
            if lang and confidence >= self.detect_threshold:
                self.locked = lang
            else:
                self.locked = self.seed or self.default
            self._reset_pending()
            return self.locked

        # Established lock: confidence-gated switch only.
        if lang and lang != self.locked and confidence >= self.switch_threshold:
            if self._pending == lang:
                self._pending_count += 1
            else:
                self._pending, self._pending_count = lang, 1
            if self._pending_count >= self.debounce:
                self.locked = lang
                self._reset_pending()
        elif not lang or lang == self.locked:
            # Same language or no signal → cancel any in-flight switch.
            self._reset_pending()

        return self.locked


def language_name(code: Optional[str]) -> str:
    """Human-readable language name for prompt injection.

    ``auto``/unknown → a generic phrase so prompts stay grammatical.
    """
    if not code or code == "auto":
        return "the user's language"
    return LANGUAGE_NAMES.get(code, code)
