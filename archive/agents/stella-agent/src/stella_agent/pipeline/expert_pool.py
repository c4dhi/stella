"""
Dynamic expert pool that automatically discovers and loads agent configurations.
Uses LLM for expert analysis with parallel execution.

This version yields AgentOutput messages instead of using StreamService.
"""

import json
import asyncio
from pathlib import Path
from typing import AsyncIterator, Dict, List, Any, Optional
from dataclasses import dataclass, field

from stella_agent_sdk.messages.output import AgentOutput

from stella_agent.llm.service import (
    LLMService,
    LLMConfig,
    LLMMessage,
    LLMResponse,
)
from stella_agent.models.expert_result import ExpertResult


@dataclass
class AgentConfig:
    """Configuration for an expert agent."""
    name: str
    description: str
    trigger_keywords: List[str]
    system_prompt: str
    model: str = "gpt-4o-mini"
    temperature: float = 0.3
    max_tokens: int = 800
    risk_threshold: float = 0.3
    relevant_intents: List[str] = field(default_factory=list)
    tools: List[str] = field(default_factory=list)
    always_active: bool = False

    @classmethod
    def from_dict(cls, data: dict) -> 'AgentConfig':
        """Create AgentConfig from dictionary."""
        return cls(
            name=data["name"],
            description=data["description"],
            trigger_keywords=data.get("trigger_keywords", []),
            system_prompt=data["system_prompt"],
            model=data.get("model", "gpt-4o-mini"),
            temperature=data.get("temperature", 0.3),
            max_tokens=data.get("max_tokens", 800),
            risk_threshold=data.get("risk_threshold", 0.3),
            relevant_intents=data.get("relevant_intents", []),
            tools=data.get("tools", []),
            always_active=data.get("always_active", False)
        )


class LangChainAgent:
    """An LLM-powered expert agent."""

    def __init__(self, config: AgentConfig, llm_service: LLMService):
        self.config = config
        self.llm_service = llm_service
        self.llm_config = self._create_llm_config()

    def _create_llm_config(self) -> LLMConfig:
        """Create LLM configuration for this agent."""
        return LLMConfig(
            model=self.llm_service.default_config.model,
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
            streaming=False,
            provider=self.llm_service.default_config.provider,
            base_url=self.llm_service.default_config.base_url
        )

    def _build_prompt(self, user_input: str, context: str) -> str:
        """Build the complete prompt for this expert."""
        return f"""{self.config.system_prompt}

Conversation History: {context}

IMPORTANT GUIDELINES:
- Pay special attention to recent messages in the conversation history
- If you've already provided advice on similar topics recently, acknowledge this and build upon your previous analysis
- Reference recent context when relevant and maintain conversation continuity
- Focus on new insights or different perspectives if the topic has been discussed before

Current User Input: {user_input}

Provide concise, expert analysis that builds naturally on the recent conversation flow. Focus on key insights and actionable guidance."""

    def should_analyze(self, user_input: str, intent: str, risk_score: float) -> bool:
        """Determine if this agent should analyze the input."""
        user_lower = user_input.lower()

        # Check keywords
        if any(keyword in user_lower for keyword in self.config.trigger_keywords):
            return True

        # Check risk threshold
        if risk_score > self.config.risk_threshold:
            return True

        # Check intent matching
        if self.config.relevant_intents and intent in self.config.relevant_intents:
            return True

        return False

    async def analyze(self, user_input: str, context: str = "") -> ExpertResult:
        """Run this agent's analysis."""
        print(f"[LangChainAgent] {self.config.name} - Starting analysis")

        try:
            prompt_text = self._build_prompt(user_input, context)
            messages = [LLMMessage(role="user", content=prompt_text)]

            llm_response = await self.llm_service.generate(
                messages=messages,
                config=self.llm_config,
                component_name=f"expert_{self.config.name}"
            )

            # Parse response
            findings = llm_response.content.strip()
            confidence = min(1.0, llm_response.usage_tokens / 100.0)

            return ExpertResult.from_success(
                agent_name=self.config.name,
                findings=findings,
                confidence=confidence,
                raw_response=llm_response.content
            )

        except Exception as e:
            print(f"[LangChainAgent] Analysis failed for {self.config.name}: {e}")
            return ExpertResult.from_failure(
                agent_name=self.config.name,
                error_message=str(e)
            )


@dataclass
class ExpertPool:
    """Dynamic pool of expert agents that auto-discovers configurations."""

    llm_service: LLMService
    agents_dir: str = "experts"
    agents: Dict[str, LangChainAgent] = field(default_factory=dict)
    cancelled: bool = False

    # Store last results for external access
    last_results: List[ExpertResult] = field(default_factory=list)

    def __post_init__(self):
        self._discover_agents()

    def cancel(self):
        """Cancel ongoing processing."""
        self.cancelled = True

    def _discover_agents(self) -> None:
        """Automatically discover and load all agent configurations."""
        agents_path = Path(self.agents_dir)

        if not agents_path.exists():
            print(f"[ExpertPool] Agents directory {agents_path} not found")
            return

        config_files = list(agents_path.glob("*.json"))
        print(f"[ExpertPool] Found {len(config_files)} agent config files")

        for config_file in config_files:
            try:
                print(f"[ExpertPool] Loading config from {config_file}")
                config_data = json.loads(config_file.read_text())
                config = AgentConfig.from_dict(config_data)
                agent = LangChainAgent(config, self.llm_service)
                self.agents[config.name] = agent
                print(f"[ExpertPool] Loaded agent: {config.name}")
            except Exception as e:
                print(f"[ExpertPool] Failed to load {config_file}: {e}")

        print(f"[ExpertPool] Initialized {len(self.agents)} agents")

    def select_relevant_agents(self, user_input: str, intent: str, risk_score: float) -> List[str]:
        """Dynamically select which agents should analyze the input."""
        relevant = []

        for name, agent in self.agents.items():
            # Always include agents marked as always_active
            if agent.config.always_active:
                relevant.append(name)
                print(f"[ExpertPool] Including always_active agent: {name}")
            # Check if agent should analyze based on triggers
            elif agent.should_analyze(user_input, intent, risk_score):
                relevant.append(name)

        return relevant

    async def run(
        self,
        session_id: str,
        user_input: str,
        context: str = "",
        expert_names: Optional[List[str]] = None
    ) -> AsyncIterator[AgentOutput]:
        """
        Run selected agents in parallel.

        Yields AgentOutput debug messages and stores results in self.last_results.
        Expert processing is internal - no user-facing STATUS messages.
        """
        self.cancelled = False
        self.last_results = []

        # If no specific experts provided, select based on input
        if expert_names is None:
            intent, risk_score = self._quick_analysis(user_input)
            expert_names = self.select_relevant_agents(user_input, intent, risk_score)

        if not expert_names:
            yield AgentOutput.debug(
                session_id,
                "No experts selected for this query",
                component="expert_pool",
                expert_count=0
            )
            return

        print(f"[ExpertPool] Running {len(expert_names)} experts: {expert_names}")

        # Debug: Starting expert analysis
        yield AgentOutput.debug(
            session_id,
            f"Starting parallel analysis with {len(expert_names)} experts",
            component="expert_pool",
            experts=expert_names
        )

        # Run experts in parallel
        tasks = []
        valid_expert_names = []

        for expert_name in expert_names:
            if self.cancelled:
                return

            if expert_name in self.agents:
                # Debug: Expert started
                yield AgentOutput.debug(
                    session_id,
                    f"Expert '{expert_name}' started",
                    component="expert_pool",
                    expert=expert_name
                )
                task = self.agents[expert_name].analyze(user_input, context)
                tasks.append(task)
                valid_expert_names.append(expert_name)

        if not tasks:
            yield AgentOutput.debug(
                session_id,
                "No valid experts found",
                component="expert_pool",
                level="warn"
            )
            return

        # Wait for all experts to complete
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Process results
        successful_results = []
        failed_results = []

        for i, result in enumerate(results):
            if self.cancelled:
                return

            expert_name = valid_expert_names[i]

            if isinstance(result, Exception):
                # Handle exception
                expert_result = ExpertResult.from_failure(
                    agent_name=expert_name,
                    error_message=str(result),
                    error_type="exception"
                )
                failed_results.append(expert_result)

                yield AgentOutput.debug(
                    session_id,
                    f"Expert '{expert_name}' failed: {str(result)}",
                    component="expert_pool",
                    level="error",
                    expert=expert_name,
                    success=False
                )
            else:
                # Normal result
                if result.success:
                    successful_results.append(result)
                    yield AgentOutput.debug(
                        session_id,
                        f"Expert '{expert_name}' completed (confidence: {result.confidence:.2f})",
                        component="expert_pool",
                        expert=expert_name,
                        success=True,
                        confidence=result.confidence
                    )
                else:
                    failed_results.append(result)
                    yield AgentOutput.debug(
                        session_id,
                        f"Expert '{expert_name}' failed: {result.error_message}",
                        component="expert_pool",
                        level="error",
                        expert=expert_name,
                        success=False
                    )

        # Store all results
        self.last_results = successful_results + failed_results

        # Debug: Summary
        yield AgentOutput.debug(
            session_id,
            f"Expert pool completed: {len(successful_results)} succeeded, {len(failed_results)} failed",
            component="expert_pool",
            successful_count=len(successful_results),
            failed_count=len(failed_results)
        )

    def _quick_analysis(self, user_input: str) -> tuple:
        """Quick heuristic analysis for intent and risk scoring."""
        user_lower = user_input.lower()

        # Intent classification
        if any(word in user_lower for word in ["hello", "hi", "hey"]):
            intent = "chitchat"
        elif "?" in user_lower:
            intent = "question"
        else:
            intent = "statement"

        # Risk scoring
        risk_score = 0.0

        if any(word in user_lower for word in ["medical", "health", "doctor"]):
            risk_score += 0.4
        if any(word in user_lower for word in ["legal", "law", "lawyer"]):
            risk_score += 0.3
        if any(word in user_lower for word in ["invest", "money", "financial"]):
            risk_score += 0.2

        return intent, min(risk_score, 1.0)

    def get_agent_info(self) -> Dict[str, Dict[str, Any]]:
        """Get information about all loaded agents."""
        return {
            name: {
                "description": agent.config.description,
                "trigger_keywords": agent.config.trigger_keywords,
                "risk_threshold": agent.config.risk_threshold,
                "model": agent.config.model,
                "always_active": agent.config.always_active
            }
            for name, agent in self.agents.items()
        }
