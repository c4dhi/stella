"""Tests for mid-turn state re-anchoring of the response context (#304 state-sync).

When task_extraction completes a phase and advances the state machine during a
turn, the response must be authored against the state the turn LANDED in — not
the turn-start snapshot — otherwise the agent keeps talking about the phase it
just left while the progress panel shows the new one.
"""

import pytest

from stella_v2_agent.agent import StellaV2Agent


class FakeSMClient:
    def __init__(self, current_state_id):
        self._current_state_id = current_state_id
        self.get_current_state_calls = 0

    async def get_current_state(self):
        self.get_current_state_calls += 1
        if self._current_state_id is None:
            return None
        return {"state_id": self._current_state_id}


def _make_agent(*, sm_client, refreshed, plan_prompt=None):
    """Build a bare agent with just the attributes _resolve_response_context needs."""
    agent = StellaV2Agent.__new__(StellaV2Agent)
    agent.sm_client = sm_client
    agent._plan_system_prompt = plan_prompt

    async def _fake_fetch():
        return refreshed

    agent._fetch_sm_context = _fake_fetch  # type: ignore
    return agent


def _turn_start_ctx(state_id="state_A"):
    return {"state": {"id": state_id, "title": "Old Phase"}, "deliverables": []}


@pytest.mark.asyncio
async def test_no_transition_keeps_original_context():
    sm = _turn_start_ctx("state_A")
    agent = _make_agent(sm_client=FakeSMClient("state_A"), refreshed={"state": {"id": "X"}})
    out = await agent._resolve_response_context(sm, "en")
    assert out is sm  # unchanged — same object


@pytest.mark.asyncio
async def test_transition_reanchors_to_new_state():
    sm = _turn_start_ctx("state_A")
    refreshed = {"state": {"id": "state_B", "title": "New Phase"}, "deliverables": []}
    agent = _make_agent(sm_client=FakeSMClient("state_B"), refreshed=refreshed)
    out = await agent._resolve_response_context(sm, "de")
    assert out is refreshed
    assert out["state"]["id"] == "state_B"
    assert out["state_just_changed"] is True
    assert out["language"] == "de"


@pytest.mark.asyncio
async def test_transition_reinjects_plan_prompt():
    sm = _turn_start_ctx("state_A")
    refreshed = {"state": {"id": "state_B"}}
    agent = _make_agent(
        sm_client=FakeSMClient("state_B"), refreshed=refreshed, plan_prompt="PLAN PROMPT"
    )
    out = await agent._resolve_response_context(sm, "en")
    assert out["plan_system_prompt"] == "PLAN PROMPT"


@pytest.mark.asyncio
async def test_transition_to_end_falls_back_to_original():
    # __end__ → _fetch_sm_context returns {} (no usable state). Keep the original;
    # the closing farewell is emitted separately in Stage 5.
    sm = _turn_start_ctx("state_A")
    agent = _make_agent(sm_client=FakeSMClient("__end__"), refreshed={})
    out = await agent._resolve_response_context(sm, "en")
    assert out is sm


@pytest.mark.asyncio
async def test_grpc_returns_none_falls_back():
    sm = _turn_start_ctx("state_A")
    agent = _make_agent(sm_client=FakeSMClient(None), refreshed={"state": {"id": "B"}})
    out = await agent._resolve_response_context(sm, "en")
    assert out is sm


@pytest.mark.asyncio
async def test_no_sm_client_keeps_original():
    sm = _turn_start_ctx("state_A")
    agent = _make_agent(sm_client=None, refreshed={"state": {"id": "B"}})
    out = await agent._resolve_response_context(sm, "en")
    assert out is sm


@pytest.mark.asyncio
async def test_missing_state_id_keeps_original():
    sm = {"state": {}, "deliverables": []}  # no id
    agent = _make_agent(sm_client=FakeSMClient("state_B"), refreshed={"state": {"id": "B"}})
    out = await agent._resolve_response_context(sm, "en")
    assert out is sm
