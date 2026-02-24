"""Central expert registry with external config loading and env var overrides.

Loading priority:
1. STELLA_EXPERTS_DIR env var (first priority — external override, like plans)
2. /app/stella-v2-agent/config/experts/ (Docker default)
3. Relative to package source (development fallback)

Individual expert params are also overridable via env vars:
- EXPERT_{NAME}_ENABLED (bool)
- EXPERT_{NAME}_MODEL (string)
- EXPERT_{NAME}_MAX_TOKENS (int)
- EXPERT_{NAME}_TEMPERATURE (float)
- EXPERT_{NAME}_PRIORITY (int)
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Any

from stella_v2_agent.experts.base import ExpertConfig


class ExpertRegistry:
    """Central registry of all available experts.

    Discovers and loads expert configs from JSON files,
    applies environment variable overrides, and provides
    lookup for the pipeline stages.
    """

    def __init__(self, experts_dir: Optional[str] = None, overrides: Optional[Dict[str, Any]] = None):
        """Initialize the registry and load expert configs.

        Args:
            experts_dir: Explicit path to experts config directory.
            overrides: Per-expert runtime overrides from AGENT_CONFIG
                       (e.g. {"medical": {"enabled": false}}).
        """
        self._experts: Dict[str, ExpertConfig] = {}
        self._overrides = overrides or {}

        config_dir = self._resolve_experts_dir(experts_dir)
        if config_dir:
            self._load_from_directory(config_dir)

        self._apply_env_overrides()
        self._apply_runtime_overrides()

        enabled_count = sum(1 for e in self._experts.values() if e.enabled)
        print(f"[ExpertRegistry] Loaded {len(self._experts)} experts ({enabled_count} enabled)")

    def _resolve_experts_dir(self, explicit_dir: Optional[str]) -> Optional[Path]:
        """Resolve the experts config directory from multiple sources."""
        candidates: List[Path] = []

        # 1. Explicit argument
        if explicit_dir:
            candidates.append(Path(explicit_dir))

        # 2. Environment variable
        env_dir = os.environ.get("STELLA_EXPERTS_DIR")
        if env_dir:
            candidates.append(Path(env_dir))

        # 3. Docker default
        candidates.append(Path("/app/stella-v2-agent/config/experts"))

        # 4. Development fallback (relative to this file)
        package_dir = Path(__file__).parent
        candidates.append(package_dir.parent.parent.parent / "config" / "experts")

        for path in candidates:
            if path.exists() and path.is_dir():
                print(f"[ExpertRegistry] Loading experts from: {path}")
                return path

        print(f"[ExpertRegistry] No experts directory found. Searched: {candidates}")
        return None

    def _load_from_directory(self, config_dir: Path) -> None:
        """Load all expert JSON files from a directory."""
        for json_file in sorted(config_dir.glob("*.json")):
            try:
                with open(json_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                config = ExpertConfig.from_dict(data)
                self._experts[config.name] = config
                print(f"[ExpertRegistry] Loaded expert: {config.name} (priority={config.priority})")
            except (json.JSONDecodeError, KeyError) as e:
                print(f"[ExpertRegistry] Failed to load {json_file.name}: {e}")

    def _apply_env_overrides(self) -> None:
        """Apply per-expert environment variable overrides."""
        for name, config in self._experts.items():
            env_prefix = f"EXPERT_{name.upper()}_"

            enabled = os.environ.get(f"{env_prefix}ENABLED")
            if enabled is not None:
                config.enabled = enabled.lower() in ("true", "1", "yes")

            model = os.environ.get(f"{env_prefix}MODEL")
            if model is not None:
                config.model = model

            max_tokens = os.environ.get(f"{env_prefix}MAX_TOKENS")
            if max_tokens is not None:
                try:
                    config.max_tokens = int(max_tokens)
                except ValueError:
                    pass

            temperature = os.environ.get(f"{env_prefix}TEMPERATURE")
            if temperature is not None:
                try:
                    config.temperature = float(temperature)
                except ValueError:
                    pass

            priority = os.environ.get(f"{env_prefix}PRIORITY")
            if priority is not None:
                try:
                    config.priority = int(priority)
                except ValueError:
                    pass

    def _apply_runtime_overrides(self) -> None:
        """Apply per-expert runtime overrides from AGENT_CONFIG."""
        for name, overrides in self._overrides.items():
            if name not in self._experts:
                continue
            config = self._experts[name]
            if not isinstance(overrides, dict):
                continue
            for key, value in overrides.items():
                if hasattr(config, key):
                    setattr(config, key, value)

    def get(self, name: str) -> Optional[ExpertConfig]:
        """Get an expert config by name. Returns None if not found."""
        return self._experts.get(name)

    def get_enabled(self) -> List[ExpertConfig]:
        """Get all enabled expert configs, sorted by priority (descending)."""
        return sorted(
            [e for e in self._experts.values() if e.enabled],
            key=lambda e: e.priority,
            reverse=True,
        )

    def get_enabled_names(self) -> List[str]:
        """Get names of all enabled experts."""
        return [e.name for e in self.get_enabled()]

    def get_summaries(self) -> List[Dict[str, str]]:
        """Get name + description for all enabled experts (used in Input Gate prompt)."""
        return [
            {"name": e.name, "description": e.description}
            for e in self.get_enabled()
        ]

    def filter_valid_names(self, names: List[str]) -> List[str]:
        """Filter a list of expert names to only those that exist and are enabled."""
        enabled_names = set(self.get_enabled_names())
        return [n for n in names if n in enabled_names]

    @property
    def count(self) -> int:
        return len(self._experts)

    @property
    def enabled_count(self) -> int:
        return sum(1 for e in self._experts.values() if e.enabled)
