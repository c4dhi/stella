"""Tests for the prompt template renderer."""

from stella_v2_agent.prompts.template import render_prompt


def test_plain_passthrough():
    assert render_prompt("no variables here", {"isBargeIn": True}) == "no variables here"
    assert render_prompt("", {}) == ""


def test_variable_substitution():
    assert render_prompt("Hi {{userInput}}", {"userInput": "there"}) == "Hi there"
    # Booleans render as yes/no.
    assert render_prompt("barge={{isBargeIn}}", {"isBargeIn": True}) == "barge=yes"
    assert render_prompt("barge={{isBargeIn}}", {"isBargeIn": False}) == "barge=no"
    # Missing variable → empty string, never raises.
    assert render_prompt("x={{missing}}y", {}) == "x=y"


def test_if_block():
    tpl = "Base.{{#if isBargeIn}} The user just interrupted you.{{/if}}"
    assert render_prompt(tpl, {"isBargeIn": True}) == "Base. The user just interrupted you."
    assert render_prompt(tpl, {"isBargeIn": False}) == "Base."
    assert render_prompt(tpl, {}) == "Base."  # missing == falsy


def test_if_else_block():
    tpl = "{{#if isBargeIn}}interrupted{{else}}normal{{/if}}"
    assert render_prompt(tpl, {"isBargeIn": True}) == "interrupted"
    assert render_prompt(tpl, {"isBargeIn": False}) == "normal"


def test_unless_block():
    tpl = "{{#unless isBargeIn}}fresh turn{{/unless}}"
    assert render_prompt(tpl, {"isBargeIn": False}) == "fresh turn"
    assert render_prompt(tpl, {"isBargeIn": True}) == ""


def test_string_truthiness():
    # String "false"/"no"/"0"/empty are falsy in conditionals.
    tpl = "{{#if flag}}on{{else}}off{{/if}}"
    assert render_prompt(tpl, {"flag": "false"}) == "off"
    assert render_prompt(tpl, {"flag": "no"}) == "off"
    assert render_prompt(tpl, {"flag": ""}) == "off"
    assert render_prompt(tpl, {"flag": "true"}) == "on"
    assert render_prompt(tpl, {"flag": "anything"}) == "on"


def test_nested_blocks():
    tpl = "{{#if isBargeIn}}interrupt:{{#if bargeInTranscript}} {{bargeInTranscript}}{{/if}}{{/if}}"
    assert (
        render_prompt(tpl, {"isBargeIn": True, "bargeInTranscript": "wait stop"})
        == "interrupt: wait stop"
    )
    assert render_prompt(tpl, {"isBargeIn": True}) == "interrupt:"
    assert render_prompt(tpl, {"isBargeIn": False, "bargeInTranscript": "x"}) == ""


def test_combined_with_substitution():
    tpl = "User said: {{userInput}}.{{#if isBargeIn}} (interruption){{/if}}"
    assert (
        render_prompt(tpl, {"userInput": "hello", "isBargeIn": True})
        == "User said: hello. (interruption)"
    )
