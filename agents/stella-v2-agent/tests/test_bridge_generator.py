"""Tests for typed bridge selection and the fast-path (#304 A2/A3)."""

import pytest

from stella_v2_agent.pipeline.bridge_generator import (
    BridgeGenerator,
    select_bridge_type,
    pick_bridge_from_inventory,
    BRIDGE_TYPE_GREETING,
    BRIDGE_TYPE_ACKNOWLEDGEMENT,
    BRIDGE_TYPE_PENSIVE,
    BRIDGE_TYPE_CONTINUER,
    GREETING_BRIDGES_EN,
    GREETING_BRIDGES_DE,
    PENSIVE_BRIDGES_EN,
    PENSIVE_BRIDGES_DE,
    ACKNOWLEDGEMENT_BRIDGES_EN,
    ACKNOWLEDGEMENT_BRIDGES_DE,
    _BRIDGE_INVENTORY,
)


class TestSelectBridgeType:
    def test_greeting_picks_greeting(self):
        assert select_bridge_type("hi") == BRIDGE_TYPE_GREETING
        assert select_bridge_type("Hello!") == BRIDGE_TYPE_GREETING
        assert select_bridge_type("hallo") == BRIDGE_TYPE_GREETING

    def test_question_picks_pensive(self):
        assert select_bridge_type("What should I eat to lose weight?") == BRIDGE_TYPE_PENSIVE

    def test_long_input_picks_pensive(self):
        long_input = " ".join(["word"] * 30)
        assert select_bridge_type(long_input) == BRIDGE_TYPE_PENSIVE

    def test_ordinary_short_answer_picks_acknowledgement(self):
        assert select_bridge_type("I run three times a week") == BRIDGE_TYPE_ACKNOWLEDGEMENT

    def test_predicted_cost_drives_pensive(self):
        # A heavy turn (>=2 experts) is effortful → pensive, even if short.
        assert select_bridge_type("yes", predicted_cost=3) == BRIDGE_TYPE_PENSIVE
        assert select_bridge_type("yes", predicted_cost=1) == BRIDGE_TYPE_ACKNOWLEDGEMENT

    def test_greeting_beats_cost(self):
        assert select_bridge_type("hi", predicted_cost=5) == BRIDGE_TYPE_GREETING


class TestNoAssessmentBeforeDispreferred:
    """A2 acceptance: no evaluative/assessment token can ever be chosen.

    The structural guarantee is that no assessment sub-type or inventory exists,
    and the selectable inventories contain no evaluative openers.
    """

    _ASSESSMENT_OPENERS = (
        "that's", "thats", "what a", "wow", "oh wow", "amazing", "great",
        "wonderful", "fantastic", "perfect", "interesting", "toll", "super",
        "wunderbar", "fantastisch", "das ist",
    )

    def test_select_never_returns_assessment(self):
        # Whatever the input, the type is one of the four declared, never an
        # assessment (there is no assessment type at all).
        for inp in ["hi", "I feel terrible", "no", "What now?", "x " * 40]:
            assert select_bridge_type(inp) in {
                BRIDGE_TYPE_GREETING,
                BRIDGE_TYPE_ACKNOWLEDGEMENT,
                BRIDGE_TYPE_PENSIVE,
                BRIDGE_TYPE_CONTINUER,
            }

    def test_inventories_contain_no_assessment_openers(self):
        every_phrase = (
            ACKNOWLEDGEMENT_BRIDGES_EN + ACKNOWLEDGEMENT_BRIDGES_DE
            + PENSIVE_BRIDGES_EN + PENSIVE_BRIDGES_DE
            + GREETING_BRIDGES_EN + GREETING_BRIDGES_DE
        )
        for phrase in every_phrase:
            low = phrase.lower()
            for opener in self._ASSESSMENT_OPENERS:
                assert not low.startswith(opener), f"{phrase!r} is an assessment"

    def test_no_assessment_inventory_registered(self):
        types = {t for (t, _lang) in _BRIDGE_INVENTORY}
        assert "assessment" not in types


class TestPickFromInventory:
    def test_greeting_language(self):
        assert pick_bridge_from_inventory(BRIDGE_TYPE_GREETING, is_german=True) in GREETING_BRIDGES_DE
        assert pick_bridge_from_inventory(BRIDGE_TYPE_GREETING, is_german=False) in GREETING_BRIDGES_EN

    def test_pensive_language(self):
        assert pick_bridge_from_inventory(BRIDGE_TYPE_PENSIVE, is_german=True) in PENSIVE_BRIDGES_DE
        assert pick_bridge_from_inventory(BRIDGE_TYPE_PENSIVE, is_german=False) in PENSIVE_BRIDGES_EN

    def test_unknown_type_falls_back_to_acknowledgement(self):
        # continuer has no inventory → must not raise, falls back to ack.
        assert pick_bridge_from_inventory(BRIDGE_TYPE_CONTINUER, is_german=False) in ACKNOWLEDGEMENT_BRIDGES_EN


class TestFastBridge:
    def test_fast_bridge_greeting_de(self):
        gen = BridgeGenerator(llm_service=None)
        assert gen.fast_bridge("hallo", language="de") in GREETING_BRIDGES_DE

    def test_fast_bridge_question_en_is_pensive(self):
        gen = BridgeGenerator(llm_service=None)
        assert gen.fast_bridge("What do you think I should do?", language="en") in PENSIVE_BRIDGES_EN

    @pytest.mark.asyncio
    async def test_generate_uses_fast_path_without_llm(self):
        # With the fast-path on, generate() must not touch the LLM service.
        gen = BridgeGenerator(llm_service=None)
        gen.fast_path_enabled = True
        bridge = await gen.generate("I run three times a week", [], language="en")
        assert bridge in ACKNOWLEDGEMENT_BRIDGES_EN


class TestApplyConfig:
    """Bridge knobs are controlled via the Agent Configurator (apply_config)."""

    def test_fast_path_from_select_string(self):
        gen = BridgeGenerator(llm_service=None)
        # The configurator select sends "on"/"off" strings — bool("off") is True,
        # so this must be parsed, not cast.
        gen.apply_config({"fast_path": "on"})
        assert gen.fast_path_enabled is True
        gen.apply_config({"fast_path": "off"})
        assert gen.fast_path_enabled is False

    def test_fast_path_from_bool(self):
        gen = BridgeGenerator(llm_service=None)
        gen.apply_config({"fast_path": True})
        assert gen.fast_path_enabled is True

    def test_timeout_ms_overrides_env_default(self):
        gen = BridgeGenerator(llm_service=None)
        gen.apply_config({"timeout_ms": 1500})
        assert gen.bridge_timeout_s == 1.5

    def test_blank_timeout_is_ignored(self):
        gen = BridgeGenerator(llm_service=None)
        before = gen.bridge_timeout_s
        gen.apply_config({"timeout_ms": ""})
        assert gen.bridge_timeout_s == before

    def test_other_knobs_still_apply(self):
        gen = BridgeGenerator(llm_service=None)
        gen.apply_config({"model": "gpt-4o", "temperature": 0.2, "max_tokens": 40})
        assert gen.bridge_model == "gpt-4o"
        assert gen.bridge_temperature == 0.2
        assert gen.bridge_max_tokens == 40
