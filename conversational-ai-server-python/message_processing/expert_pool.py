"""
Dynamic expert pool that automatically discovers and loads agent configurations.
Uses LangChain for agent orchestration with zero-code extensibility.
"""
import json
import asyncio
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass

from .stream_service import StreamService
from .llm_service import LLMService, LLMConfig, LLMProvider, LLMStreamingCallback, LLMMessage, LLMResponse


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
    relevant_intents: List[str] = None
    tools: List[str] = None
    always_active: bool = False  # NEW: Agent runs on every expert pool execution

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
            always_active=data.get("always_active", False)  # NEW: Support always_active flag
        )


class StreamingExpertCallback(LLMStreamingCallback):
    """Callback to stream expert progress updates."""

    def __init__(self, expert_name: str, stream_service: StreamService):
        self.expert_name = expert_name
        self.stream_service = stream_service
        self.accumulated_text = ""

    async def on_token(self, token: str, accumulated_text: str) -> None:
        """Called when a new token arrives."""
        self.accumulated_text = accumulated_text
        # Could send progress updates here if needed

    async def on_complete(self, final_response: LLMResponse) -> None:
        """Called when streaming is complete."""
        # The response will be handled by the calling code
        pass

    async def on_error(self, error: Exception) -> None:
        """Called when an error occurs."""
        print(f"[ExpertPool] {self.expert_name} streaming error: {error}")
        await self.stream_service.send_expert_status(
            expert_name=self.expert_name,
            status="error",
            metadata={
                "error_message": str(error),
                "error_type": "streaming_error"
            }
        )

    async def send_completion_with_result(self, parsed_result: dict) -> None:
        """Send completion status with expert result as metadata."""
        await self.stream_service.send_expert_status(
            expert_name=self.expert_name,
            status="completed",
            metadata={
                "result": parsed_result,
                "success": parsed_result.get("success", True)
            }
        )


class LangChainAgent:
    """An LLM-powered expert agent."""

    def __init__(self, config: AgentConfig, stream_service: StreamService, llm_service: Optional[LLMService] = None):
        self.config = config
        self.stream_service = stream_service
        self.llm_service = llm_service or LLMService()
        self.llm_config = self._create_llm_config()

    def _create_llm_config(self) -> LLMConfig:
        """Create LLM configuration for this agent."""
        # Use model and provider from LLM service's default config (loaded from llm_config.json)
        # This allows experts to use the globally configured model (Ollama, OpenAI, etc.)
        # Expert configs still control temperature, max_tokens, prompts, and trigger keywords
        return LLMConfig(
            model=self.llm_service.default_config.model,  # Use global model from llm_config.json
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
            streaming=False,  # Most experts don't need streaming
            provider=self.llm_service.default_config.provider,
            base_url=self.llm_service.default_config.base_url  # Include base_url for Ollama/local models
        )

    def _build_prompt(self, user_input: str, context: str) -> str:
        """Build the complete prompt for this expert."""
        return f"""{self.config.system_prompt}

Conversation History: {context}

IMPORTANT GUIDELINES:
- Pay special attention to [MOST RECENT] and [RECENT] messages marked in the conversation history
- If you've already provided advice on similar topics recently, acknowledge this and build upon or refine your previous analysis rather than repeating it
- Reference recent context when relevant and maintain conversation continuity
- Avoid giving the same recommendations you've already provided in recent messages
- Focus on new insights or different perspectives if the topic has been discussed before

Current User Input: {user_input}

Provide concise, expert analysis that builds naturally on the recent conversation flow. Focus on key insights and actionable guidance that adds value to the ongoing discussion."""

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

    async def analyze(self, user_input: str, context: str = "") -> Dict[str, Any]:
        """Run this agent's analysis."""
        print(f"[LangChainAgent] {self.config.name} - Starting analysis")

        # Send start status
        await self.stream_service.send_expert_status(self.config.name, "started")

        try:
            # Build the prompt
            prompt_text = self._build_prompt(user_input, context)

            # Create messages for the LLM service
            messages = [LLMMessage(role="user", content=prompt_text)]

            # Use LLM service to generate response
            llm_response = await self.llm_service.generate(
                messages=messages,
                config=self.llm_config,
                component_name=f"expert_{self.config.name}"
            )

            # Parse response
            parsed = self._parse_response(llm_response.content)
            parsed.update({
                "agent_name": self.config.name,
                "success": True,
                "confidence": min(1.0, llm_response.usage_tokens / 100.0)  # Simple confidence based on response length
            })

            # Send completion status with results as metadata
            callback = StreamingExpertCallback(self.config.name, self.stream_service)
            await callback.send_completion_with_result(parsed)

            return parsed

        except Exception as e:
            print(f"[LangChainAgent] Analysis failed for {self.config.name}: {e}")

            error_result = {
                "agent_name": self.config.name,
                "findings": f"Analysis failed: {str(e)}",
                "risks": ["analysis_error"],
                "recommendation": "retry_or_fallback",
                "confidence": 0.0,
                "success": False
            }

            # Send error status with result metadata
            await self.stream_service.send_expert_status(
                expert_name=self.config.name,
                status="error",
                metadata={
                    "result": error_result,
                    "success": False,
                    "confidence": 0.0,
                    "error_message": str(e),
                    "error_type": "analysis_exception"
                }
            )

            # Comprehensive assessment for analysis failure during runtime
            asyncio.create_task(
                self.stream_service.send_system_assessment(
                    issue_type="expert_analysis_failed",
                    situation_assessment=f"The {self.config.name} expert encountered a runtime failure while processing the current query. This is a transient operational issue affecting this specific analysis request. The expert agent infrastructure is intact but this particular analysis could not be completed. The failure occurred during active processing, indicating the system reached the expert but encountered an execution error.",
                    severity="warning",
                    impact_analysis=f"The current query will lack {self.config.name} domain expertise, reducing analysis depth in {self.config.description.lower()}. This affects confidence in responses related to this expert's specialization. Other functional experts may partially compensate, but domain-specific insights for {self.config.name} are unavailable for this query.",
                    aggregator_recommendations={
                        "synthesis_strategy": "compensate_with_other_experts",
                        "confidence_adjustment": "moderate_reduction_for_domain_specific",
                        "user_disclosure": "acknowledge_partial_expert_analysis",
                        "fallback_behavior": "emphasize_available_expert_insights",
                        "response_tone": "confident_but_acknowledge_limitation"
                    },
                    user_communication_strategy=f"Acknowledge that while most expert analysis was completed successfully, the {self.config.name} specialist encountered an issue with this specific query. Emphasize insights from other experts while being transparent about the gap in {self.config.name} analysis.",
                    technical_details=f"Runtime exception during analysis: {str(e)}. Expert config intact: {self.config.model} at {self.config.temperature} temperature."
                )
            )

            return error_result

    def _parse_response(self, response: str) -> Dict[str, Any]:
        """Simple parsing - just use the expert's natural language response."""
        return {
            "findings": response.strip(),
            "raw_response": response
        }


class ExpertPool:
    """Dynamic pool of expert agents that auto-discovers configurations."""

    def __init__(self, stream_service: StreamService, agents_dir: str = "agents", llm_service: Optional[LLMService] = None):
        self.stream_service = stream_service
        self.agents_dir = Path(agents_dir)
        self.llm_service = llm_service or LLMService()
        self.agents: Dict[str, LangChainAgent] = {}
        self._discover_agents()

    def _discover_agents(self) -> None:
        """Automatically discover and load all agent configurations."""
        if not self.agents_dir.exists():
            print(f"[ExpertPool] Agents directory {self.agents_dir} not found. Creating it...")
            self.agents_dir.mkdir(parents=True, exist_ok=True)
            # Notify frontend about missing agents directory
            asyncio.create_task(
                self.stream_service.send_system_issue(
                    issue_type="missing_agents_directory",
                    issue_description="No expert agents directory found",
                    severity="warning",
                    suggested_action="Add expert agent configurations to enable advanced analysis",
                    technical_details=f"Directory {self.agents_dir} was created but contains no agent configurations"
                )
            )
            return

        agent_count = 0
        failed_agents = []
        config_files = list(self.agents_dir.glob("*.json"))


        for config_file in config_files:
            try:
                print(f"[ExpertPool] Loading config from {config_file}")
                config_data = json.loads(config_file.read_text())
                config = AgentConfig.from_dict(config_data)
                agent = LangChainAgent(config, self.stream_service, self.llm_service)

                # Check if LLM service is available
                if not self.llm_service.get_available_providers():
                    failed_agents.append(config.name)

                    # Comprehensive assessment for agent initialization failure
                    working_agents = [name for name, a in self.agents.items() if self.llm_service.get_available_providers()]
                    asyncio.create_task(
                        self.stream_service.send_system_assessment(
                            issue_type="agent_initialization_failed",
                            situation_assessment=f"The {config.name} expert agent failed to initialize properly despite having a valid configuration. This represents a partial degradation of expert analysis capabilities. The agent specializes in {config.description.lower()} and its absence will create knowledge gaps in this domain. Currently {len(working_agents)} other agents are operational.",
                            severity="warning",
                            impact_analysis=f"Queries requiring {config.name} expertise (keywords: {', '.join(config.trigger_keywords[:5])}) will have reduced analysis quality. Risk assessment threshold of {config.risk_threshold} for this domain will not be enforced. Users asking about {config.description.lower()} topics will receive less specialized guidance.",
                            aggregator_recommendations={
                                "synthesis_strategy": "acknowledge_missing_expertise",
                                "confidence_adjustment": f"reduce_by_15_percent_for_{config.name}_queries",
                                "user_disclosure": f"mention_{config.name}_expert_unavailable",
                                "fallback_behavior": "use_general_knowledge",
                                "response_tone": "apologetic_but_helpful"
                            },
                            user_communication_strategy=f"When queries relate to {config.description.lower()}, acknowledge that specialized {config.name} expertise is temporarily unavailable but provide what general guidance you can. Suggest consulting qualified professionals for critical {config.name} matters.",
                            technical_details=f"Agent config loaded successfully but LLM service initialization failed. Model: {config.model}, Temperature: {config.temperature}, Max tokens: {config.max_tokens}"
                        )
                    )
                else:
                    # Agent created successfully
                    pass

                self.agents[config.name] = agent
                agent_count += 1


            except Exception as e:
                failed_agents.append(config_file.stem)
                # Notify frontend about agent loading failure
                asyncio.create_task(
                    self.stream_service.send_system_issue(
                        issue_type="agent_config_error",
                        issue_description=f"Failed to load agent configuration from {config_file.name}",
                        severity="error",
                        suggested_action="Check agent configuration file format and syntax",
                        technical_details=str(e)
                    )
                )


        if failed_agents:
            # Send summary of failed agents to frontend
            asyncio.create_task(
                self.stream_service.send_system_issue(
                    issue_type="agent_loading_summary",
                    issue_description=f"Some expert agents failed to load: {', '.join(failed_agents)}",
                    severity="warning",
                    suggested_action="Check system configuration and dependencies",
                    technical_details=f"Successfully loaded: {agent_count - len(failed_agents)}/{agent_count}"
                )
            )

    def select_relevant_agents(self, user_input: str, intent: str, risk_score: float) -> List[str]:
        """Dynamically select which agents should analyze the input.

        NEW: Always includes agents with always_active=True (e.g., timekeeper).
        """
        relevant = []

        for name, agent in self.agents.items():
            # Always include agents marked as always_active (like timekeeper)
            if agent.config.always_active:
                relevant.append(name)
                print(f"[ExpertPool] Including always_active agent: {name}")
            # Otherwise check if agent should analyze based on triggers
            elif agent.should_analyze(user_input, intent, risk_score):
                relevant.append(name)

        return relevant

    async def run_parallel(self, agent_names: List[str], user_input: str, context: str = "") -> List[Dict[str, Any]]:
        """Run selected agents in parallel."""
        if not agent_names:
            await self.stream_service.send_system_issue(
                issue_type="no_experts_selected",
                issue_description="No expert agents were selected for this query",
                severity="info",
                suggested_action="Query will be processed without specialized expert analysis",
                technical_details="Input did not match any expert agent trigger criteria"
            )
            return []


        # Check for requested agents that don't exist
        missing_agents = [name for name in agent_names if name not in self.agents]
        if missing_agents:
            await self.stream_service.send_system_issue(
                issue_type="requested_agents_unavailable",
                issue_description=f"Requested expert agents not available: {', '.join(missing_agents)}",
                severity="warning",
                suggested_action="Analysis will proceed with available experts only",
                technical_details=f"Available agents: {list(self.agents.keys())}"
            )

        await self.stream_service.send_decision_stream(
            "expert_pool_start",
            f"Starting {len(agent_names)} experts in parallel",
            metadata={"experts": agent_names}
        )

        # Create tasks for parallel execution
        tasks = []
        for agent_name in agent_names:
            if agent_name in self.agents:
                task = self.agents[agent_name].analyze(user_input, context)
                tasks.append(task)
            else:
                # Agent not found - skip
                pass

        # Wait for all agents to complete
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Process results and handle exceptions
        successful_results = []
        failed_results = []
        exception_count = 0

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                exception_count += 1
                # Create a failed result entry for the exception
                failed_result = {
                    "agent_name": agent_names[i],
                    "findings": f"Agent failed with exception: {str(result)}",
                    "risks": ["system_error"],
                    "recommendation": "retry_or_fallback",
                    "confidence": 0.0,
                    "success": False,
                    "error_type": "exception"
                }
                failed_results.append(failed_result)
            else:
                # Check if the result indicates success or failure
                if result.get("success", False):
                    successful_results.append(result)
                else:
                    failed_results.append(result)

        failed_count = len(failed_results)

        await self.stream_service.send_decision_stream(
            "expert_pool_complete",
            f"Completed: {len(successful_results)} succeeded, {failed_count} failed",
            metadata={
                "successful_count": len(successful_results),
                "failed_count": failed_count,
                "exception_count": exception_count
            }
        )

        # Return ALL results (both successful and failed) for aggregator processing
        all_results = successful_results + failed_results
        return all_results

    def get_agent_info(self) -> Dict[str, Dict[str, Any]]:
        """Get information about all loaded agents."""
        return {
            name: {
                "description": agent.config.description,
                "trigger_keywords": agent.config.trigger_keywords,
                "risk_threshold": agent.config.risk_threshold,
                "model": agent.config.model,
                "always_active": agent.config.always_active  # NEW: Include always_active flag
            }
            for name, agent in self.agents.items()
        }