"""Tests for abbreviation-aware sentence chunking (#304 B7).

The TTS dispatcher splits the streamed response into sentences on `.!?` +
whitespace. A naive split clips abbreviations ("Dr.", "z. B.", "etc.") and
single-letter initials into their own tiny TTS utterances, which the
synthesizer renders with an unnatural standalone falling pitch. These tests
pin the guard that keeps such fragments attached to their sentence.
"""

from typing import AsyncIterator, Dict, Any, List

from stella_agent_sdk.agent.base import BaseAgent
from stella_agent_sdk.messages.input import AgentInput
from stella_agent_sdk.messages.output import AgentOutput


class _Agent(BaseAgent):
    async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        yield AgentOutput.text_final(input.session_id, "")

    async def on_interrupt(self, session_id: str) -> None:
        pass


def _chunk(text: str, step: int = 0) -> List[str]:
    """Feed ``text`` through _dispatch_sentences and capture dispatched sentences.

    With step=0 the whole text is fed at once; with step>0 it is fed in
    ``step``-char increments to mimic token streaming.
    """
    agent = _Agent()
    captured: List[str] = []
    agent._enqueue_sentence = lambda s, source="response": captured.append(s)  # type: ignore

    if step <= 0:
        agent._dispatch_sentences(text)
    else:
        for i in range(0, len(text), step):
            agent._dispatch_sentences(text[i:i + step])
    return captured


class TestFalseBoundary:
    def test_english_abbreviations(self):
        assert BaseAgent._is_false_boundary("Talk to Dr.")
        assert BaseAgent._is_false_boundary("things like apples, etc.")
        assert BaseAgent._is_false_boundary("e.g.")

    def test_german_abbreviations(self):
        assert BaseAgent._is_false_boundary("zum Beispiel z.B.")  # no-space form
        assert BaseAgent._is_false_boundary("das heißt d.h.")
        assert BaseAgent._is_false_boundary("und so weiter usw.")

    def test_single_letter_is_a_real_boundary(self):
        # A trailing single letter is NOT treated as an initial: merging real
        # sentences ending in a letter is worse than clipping a rare initial.
        assert not BaseAgent._is_false_boundary("You got an A.")
        assert not BaseAgent._is_false_boundary("Take vitamin D.")
        assert not BaseAgent._is_false_boundary("Go with plan B.")

    def test_ambiguous_common_words_are_real_boundaries(self):
        # Words/units/names that can legitimately end a sentence must NOT merge.
        for s in ("The answer is no.", "You have 5 min.", "Pick the max.",
                  "I talked to Al.", "I ate a fig.", "I live in CA."):
            assert not BaseAgent._is_false_boundary(s), s

    def test_real_sentence_end_is_not_false(self):
        assert not BaseAgent._is_false_boundary("That works for me.")
        assert not BaseAgent._is_false_boundary("Are you sure?")
        assert not BaseAgent._is_false_boundary("Let me think...")
        assert not BaseAgent._is_false_boundary("")


class TestDispatch:
    def test_simple_two_sentences(self):
        assert _chunk("That works. What's next? ") == ["That works.", "What's next?"]

    def test_abbreviation_not_clipped(self):
        # "Dr." must stay attached to its sentence, not dispatched alone.
        assert _chunk("You should see Dr. Smith soon. Okay? ") == [
            "You should see Dr. Smith soon.",
            "Okay?",
        ]

    def test_german_abbreviation_not_clipped(self):
        # No-space form is protected (the spaced "z. B." is intentionally not).
        assert _chunk("Mach etwas Sport, z.B. Laufen. Klingt gut. ") == [
            "Mach etwas Sport, z.B. Laufen.",
            "Klingt gut.",
        ]

    def test_sentence_ending_in_common_word_is_not_merged(self):
        # Regression: "no"/"min"/single-letter must not glue two sentences.
        assert _chunk("The answer is no. Let me explain. ") == [
            "The answer is no.",
            "Let me explain.",
        ]
        assert _chunk("You got an A. Well done. ") == [
            "You got an A.",
            "Well done.",
        ]

    def test_ellipsis_is_a_boundary(self):
        assert _chunk("Yeah... that makes sense. ") == [
            "Yeah...",
            "that makes sense.",
        ]

    def test_streamed_token_by_token(self):
        # Same result whether fed whole or in small increments.
        text = "See Dr. Lee about it. Does that work? "
        assert _chunk(text, step=3) == [
            "See Dr. Lee about it.",
            "Does that work?",
        ]

    def test_incomplete_sentence_stays_buffered(self):
        assert _chunk("This is not done yet") == []
