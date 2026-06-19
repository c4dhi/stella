"""Opt-in LLM precision/recall eval for per-expert engagement (#363).

The deterministic contract is locked in ``test_expert_engagement.py``. This file
measures the thing that contract can't: does each expert's *prompt* actually make
the model engage on relevant input and tap out on irrelevant input? That requires
real LLM calls, so it is SKIPPED by default and only runs when explicitly asked:

    STELLA_RUN_EXPERT_EVALS=1 OPENAI_API_KEY=... pytest tests/test_expert_engagement_eval.py -q -s

Now that there is no Input Gate backstop, a miscalibrated prompt has no safety
net — an over-engaging expert pollutes arbitration every turn, an under-engaging
one silently drops its job. This eval is the calibration guard: per expert it
asserts engagement RECALL on relevant inputs and tap-out rate (engagement
precision) on irrelevant inputs both clear a threshold. Labeled sets are small
and illustrative — grow them as real miscalibrations surface.
"""

import os

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("STELLA_RUN_EXPERT_EVALS") != "1" or not os.environ.get("OPENAI_API_KEY"),
    reason="LLM eval — set STELLA_RUN_EXPERT_EVALS=1 and OPENAI_API_KEY to run",
)


# (expert, abstain_verdict, [relevant inputs -> should ENGAGE], [irrelevant -> should TAP OUT])
EVAL_SETS = {
    "noise_detection": (
        "clear",
        ["asdkfj qwpoe zxcv", "uh gnnh mmf", "[inaudible] ... brr"],
        ["ok", "tell me a joke", "I went for a run yesterday", "no thanks", "ja genau"],
    ),
    "medical": (
        "none",
        ["I've had chest pain since this morning", "Is it okay to double my antidepressant dose?",
         "My ankle is swollen and I can't walk on it"],
        ["I slept really well and feel energized", "What's a good warm-up before lifting?",
         "I ran 5k this morning", "Let's set a goal for the week"],
    ),
    "legal": (
        "none",
        ["My employer is refusing to pay my overtime", "I want to dispute my lease termination",
         "Can I sue my contractor for this?"],
        ["I'm planning a weekend trip", "Did you catch the game last night?",
         "I want to get fitter this month"],
    ),
    "probing": (
        "no_probe",
        ["I guess I want to be healthier", "Something with exercise, not sure"],
        ["My goal is to run a 10k in under an hour by September", "Thanks, that's all clear"],
    ),
    "timekeeper": (
        "on_track",
        # Engagement here is history-dependent; provided via conversation history.
        [],
        ["My name is Sarah and I want to improve my stamina"],
    ),
}


def _runner():
    from stella_v2_agent.experts.registry import ExpertRegistry
    from stella_v2_agent.experts.runner import ExpertRunner
    from stella_v2_agent.llm.service import LLMService
    from pathlib import Path

    config_dir = Path(__file__).parent.parent / "config" / "experts"
    registry = ExpertRegistry(experts_dir=str(config_dir))
    llm = LLMService()
    runner = ExpertRunner(llm, compiler_version="1.0.0")
    return registry, runner


async def _verdict_for(runner, cfg, text, history=None):
    v = await runner.run(cfg, text, history or [], sm_context={})
    return v.verdict


@pytest.mark.asyncio
@pytest.mark.parametrize("name", [n for n, s in EVAL_SETS.items() if s[1]])
async def test_engagement_recall_on_relevant(name):
    registry, runner = _runner()
    cfg = registry.get(name)
    abstain, relevant, _ = EVAL_SETS[name]

    engaged = 0
    for text in relevant:
        verdict = await _verdict_for(runner, cfg, text)
        engaged += int(verdict != abstain)
        print(f"[{name}] relevant {text!r} -> {verdict}")

    recall = engaged / len(relevant)
    assert recall >= 0.8, f"{name} engagement recall {recall:.0%} below 80%"


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(EVAL_SETS))
async def test_tap_out_rate_on_irrelevant(name):
    registry, runner = _runner()
    cfg = registry.get(name)
    abstain, _, irrelevant = EVAL_SETS[name]

    tapped = 0
    for text in irrelevant:
        verdict = await _verdict_for(runner, cfg, text)
        tapped += int(verdict == abstain)
        print(f"[{name}] irrelevant {text!r} -> {verdict}")

    rate = tapped / len(irrelevant)
    assert rate >= 0.8, f"{name} tap-out rate {rate:.0%} below 80% (over-engaging)"
