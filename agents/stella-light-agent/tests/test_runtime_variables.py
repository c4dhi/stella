"""Drift guards (#251): the manifest's declared runtime-variable palette must match
what the SDK prompt compiler can actually resolve, and the declared compiler
version must match the version the agent pins in code.
"""

import os
import re

import yaml

from stella_agent_sdk.prompts import KNOWN_PLACEHOLDERS

AGENT_DIR = os.path.dirname(os.path.dirname(__file__))
MANIFEST_PATH = os.path.join(AGENT_DIR, "agent.yaml")
AGENT_PY = os.path.join(AGENT_DIR, "src", "stella_light_agent", "agent.py")


def _manifest():
    with open(MANIFEST_PATH) as f:
        return yaml.safe_load(f)


def test_declared_runtime_variables_are_resolvable_by_the_compiler():
    runtime_vars = _manifest().get("runtimeVariables") or []
    assert runtime_vars, "stella-light must declare runtimeVariables"
    for v in runtime_vars:
        # Parametric vars (e.g. history) resolve as {{name_N}} → sentinel "name_N".
        token = f"{v['name']}_N" if v.get("parametric") else v["name"]
        assert token in KNOWN_PLACEHOLDERS, (
            f"runtimeVariable '{v['name']}' is declared but not resolvable by the "
            f"SDK prompt compiler (known: {sorted(KNOWN_PLACEHOLDERS)})"
        )


def test_manifest_compiler_version_matches_pinned_constant():
    declared = (_manifest().get("promptCompiler") or {}).get("version")
    assert declared, "stella-light must declare promptCompiler.version"
    with open(AGENT_PY) as f:
        source = f.read()
    m = re.search(r'PROMPT_COMPILER_VERSION\s*=\s*"([^"]+)"', source)
    assert m, "PROMPT_COMPILER_VERSION not found in agent.py"
    assert declared == m.group(1), (
        f"manifest promptCompiler.version ({declared}) must match the agent's "
        f"pinned PROMPT_COMPILER_VERSION ({m.group(1)})"
    )
