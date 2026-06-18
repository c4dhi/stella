"""Light agent must match the user's language (German support) — #304 follow-up.

stella-light previously had no language-matching rule and an English-only style
block (English contractions/fillers/connectors), so German support was implicit
and the register guidance actively pushed English idioms. These tests pin the
language rule and the bilingual register in the DEFAULT prompt path.
"""

from stella_light_agent.prompts.light_prompt import LightPromptBuilder


def _default_prompt() -> str:
    b = LightPromptBuilder()
    ctx = {
        "processing_mode": "loose",
        "state": {"title": "X"},
        "deliverables": [],
        "progress": {},
        "available_tasks": [],
    }
    return b.build_system_prompt(ctx)


class TestLanguageRule:
    def test_identity_has_language_rule(self):
        p = _default_prompt()
        assert "ENTIRE reply must be in German" in p

    def test_style_applies_rules_in_any_language(self):
        p = _default_prompt()
        assert "WHATEVER language you are speaking" in p

    def test_bilingual_contractions(self):
        p = _default_prompt()
        assert "geht's" in p and "hab ich" in p   # DE
        assert "don't" in p and "it's" in p        # EN

    def test_bilingual_fillers_and_tts_sound_ban(self):
        p = _default_prompt()
        assert '"Ja,"' in p and '"Also,"' in p     # DE openers
        # TTS-poor filler sounds banned in both languages
        assert "ähm" in p and "Uh" in p

    def test_lexical_mirroring_is_language_aware(self):
        p = _default_prompt()
        assert "Bewegung" in p  # don't rename the user's "Sport"


class TestCustomGuidelinesStillOverride:
    def test_custom_guidelines_replace_default_style(self):
        # A configured style replaces the default style block AND suppresses the
        # default identity's language rule, so the operator's prompt fully owns
        # language (#304 review #10) — e.g. an English-only deployment configured
        # via guidelines. The language rule lives in the DEFAULT path only.
        b = LightPromptBuilder()
        ctx = {
            "processing_mode": "loose",
            "state": {"title": "X"},
            "deliverables": [],
            "progress": {},
            "available_tasks": [],
            "custom_guidelines": "MY CUSTOM STYLE BLOCK",
        }
        p = b.build_system_prompt(ctx)
        assert "MY CUSTOM STYLE BLOCK" in p
        assert "WHATEVER language you are speaking" not in p
        # The default identity language rule must NOT leak past the override.
        assert "ENTIRE reply must be in German" not in p
        assert "default to German" not in p
