"""Tool registry for managing available tools.

The ToolRegistry is the central manager for all tools available to an agent.
It handles registration, lookup, and schema generation for LLM providers.
"""

from typing import Dict, List, Optional

from stella_agent_sdk.tools.base import BaseTool


class ToolRegistry:
    """Manages available tools for an agent session.

    Provides:
    - Tool registration and unregistration
    - Tool lookup by name
    - Schema generation for different LLM providers (OpenAI, Anthropic)

    Example:
        registry = ToolRegistry()
        registry.register(CompleteTaskTool(client))
        registry.register(SetDeliverableTool(client))

        # Get schemas for LLM call
        tools = registry.get_openai_schemas()

        # Look up tool by name
        tool = registry.get("complete_task")
    """

    def __init__(self):
        """Initialize an empty tool registry."""
        self._tools: Dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        """Register a tool.

        Args:
            tool: Tool instance to register

        Raises:
            ValueError: If a tool with the same name is already registered
        """
        if tool.name in self._tools:
            raise ValueError(f"Tool '{tool.name}' is already registered")
        self._tools[tool.name] = tool

    def register_all(self, tools: List[BaseTool]) -> None:
        """Register multiple tools at once.

        Args:
            tools: List of tool instances to register
        """
        for tool in tools:
            self.register(tool)

    def unregister(self, name: str) -> bool:
        """Unregister a tool by name.

        Args:
            name: Name of the tool to unregister

        Returns:
            True if tool was unregistered, False if not found
        """
        if name in self._tools:
            del self._tools[name]
            return True
        return False

    def get(self, name: str) -> Optional[BaseTool]:
        """Get a tool by name.

        Args:
            name: Name of the tool to retrieve

        Returns:
            Tool instance if found, None otherwise
        """
        return self._tools.get(name)

    def has(self, name: str) -> bool:
        """Check if a tool is registered.

        Args:
            name: Name of the tool to check

        Returns:
            True if tool is registered
        """
        return name in self._tools

    def list_tools(self) -> List[BaseTool]:
        """List all registered tools.

        Returns:
            List of all registered tool instances
        """
        return list(self._tools.values())

    def list_names(self) -> List[str]:
        """List all registered tool names.

        Returns:
            List of registered tool names
        """
        return list(self._tools.keys())

    def clear(self) -> None:
        """Remove all registered tools."""
        self._tools.clear()

    def get_openai_schemas(self) -> List[Dict]:
        """Get all tools in OpenAI function calling format.

        Returns:
            List of tool schemas compatible with OpenAI's tools parameter
        """
        return [tool.to_openai_schema() for tool in self._tools.values()]

    def get_anthropic_schemas(self) -> List[Dict]:
        """Get all tools in Anthropic tool format.

        Returns:
            List of tool schemas compatible with Anthropic's tools parameter
        """
        return [tool.to_anthropic_schema() for tool in self._tools.values()]

    def __len__(self) -> int:
        """Return number of registered tools."""
        return len(self._tools)

    def __contains__(self, name: str) -> bool:
        """Check if a tool is registered (supports 'in' operator)."""
        return name in self._tools

    def __iter__(self):
        """Iterate over registered tools."""
        return iter(self._tools.values())
