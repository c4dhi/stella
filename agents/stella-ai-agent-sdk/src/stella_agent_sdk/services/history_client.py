"""HTTP client for fetching chat history from session management server."""

import logging
from typing import List, Optional

import aiohttp

from stella_agent_sdk.messages.types import ChatMessage

logger = logging.getLogger(__name__)


class HistoryClient:
    """
    HTTP client for fetching chat history from the session management server.

    This client allows agents to retrieve their session's chat history on demand,
    which is useful for building context or resuming conversations.

    The client uses the agent's LiveKit JWT token for authentication via the
    Authorization header (Bearer token), ensuring agents can only access
    history for their assigned session.

    API: GET /internal/sessions/:sessionId/chat-history
    Headers: Authorization: Bearer <token>
    Query params: include_debug, limit, before

    Example:
        ```python
        client = HistoryClient(
            base_url="http://session-management-server:3000",
            token=livekit_jwt_token,
            session_id="session-uuid-123"
        )

        # Fetch recent messages (excluding debug)
        messages = await client.get_chat_history(limit=20)

        # Fetch with debug messages included
        messages = await client.get_chat_history(include_debug=True, limit=50)
        ```
    """

    def __init__(self, base_url: str, token: str, session_id: str):
        """
        Initialize the HistoryClient.

        Args:
            base_url: Base URL of the session management server
                     (e.g., "http://session-management-server:3000")
            token: Agent's LiveKit JWT token for authentication
            session_id: Session ID (LiveKit room name) to fetch history for
        """
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._session_id = session_id
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create the aiohttp session."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self) -> None:
        """Close the HTTP session."""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    async def get_chat_history(
        self,
        include_debug: bool = False,
        limit: int = 100,
        before: Optional[str] = None,
    ) -> List[ChatMessage]:
        """
        Fetch chat history for the current session.

        Args:
            include_debug: Whether to include debug/processing messages.
                          Default is False (only chat messages).
            limit: Maximum number of messages to return.
                   Default is 100, max is 500.
            before: Cursor for pagination - ISO timestamp to fetch messages before.
                   Used for fetching older messages.

        Returns:
            List of ChatMessage objects in chronological order (oldest first).

        Raises:
            HistoryClientError: If the request fails or authentication is rejected.

        Example:
            ```python
            # Get last 20 chat messages
            messages = await client.get_chat_history(limit=20)

            # Build conversation context
            for msg in messages:
                print(f"{msg.role}: {msg.content}")
            ```
        """
        session = await self._get_session()

        # Build URL with query parameters
        url = f"{self._base_url}/internal/sessions/{self._session_id}/chat-history"
        params = {
            "include_debug": str(include_debug).lower(),
            "limit": str(min(limit, 500)),  # Cap at 500
        }

        if before:
            params["before"] = before

        # Set Authorization header with Bearer token
        headers = {
            "Authorization": f"Bearer {self._token}"
        }

        try:
            logger.info(
                f"Fetching chat history for session {self._session_id}, "
                f"include_debug={include_debug}, limit={limit}"
            )

            async with session.get(
                url,
                params=params,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as response:
                if response.status == 401:
                    raise HistoryClientError(
                        "Authentication failed - invalid or expired token"
                    )
                elif response.status == 403:
                    raise HistoryClientError(
                        "Access denied - token does not have access to this session"
                    )
                elif response.status == 404:
                    raise HistoryClientError(
                        f"Session {self._session_id} not found"
                    )
                elif response.status != 200:
                    error_text = await response.text()
                    raise HistoryClientError(
                        f"Failed to fetch chat history: {response.status} - {error_text}"
                    )

                data = await response.json()

                # Parse messages from response
                messages = [
                    ChatMessage.from_api_response(msg)
                    for msg in data.get("messages", [])
                ]

                logger.info(
                    f"Retrieved {len(messages)} messages from chat history"
                )

                return messages

        except aiohttp.ClientError as e:
            raise HistoryClientError(f"Network error fetching chat history: {e}")

    async def get_chat_history_paginated(
        self,
        include_debug: bool = False,
        limit: int = 100,
    ) -> "ChatHistoryIterator":
        """
        Get an async iterator for paginated chat history.

        This is useful for fetching large amounts of history without
        loading everything into memory at once.

        Args:
            include_debug: Whether to include debug/processing messages.
            limit: Number of messages per page.

        Returns:
            AsyncIterator that yields ChatMessage objects.

        Example:
            ```python
            async for message in await client.get_chat_history_paginated():
                process_message(message)
            ```
        """
        return ChatHistoryIterator(self, include_debug, limit)


class ChatHistoryIterator:
    """Async iterator for paginated chat history."""

    def __init__(
        self,
        client: HistoryClient,
        include_debug: bool,
        limit: int,
    ):
        self._client = client
        self._include_debug = include_debug
        self._limit = limit
        self._cursor: Optional[str] = None
        self._buffer: List[ChatMessage] = []
        self._exhausted = False

    def __aiter__(self):
        return self

    async def __anext__(self) -> ChatMessage:
        # Return from buffer if available
        if self._buffer:
            return self._buffer.pop(0)

        # Check if we've exhausted all pages
        if self._exhausted:
            raise StopAsyncIteration

        # Fetch next page
        messages = await self._client.get_chat_history(
            include_debug=self._include_debug,
            limit=self._limit,
            before=self._cursor,
        )

        if not messages:
            self._exhausted = True
            raise StopAsyncIteration

        # Update cursor for next page (oldest message timestamp)
        self._cursor = messages[0].timestamp
        self._buffer = messages

        return self._buffer.pop(0)


class HistoryClientError(Exception):
    """Exception raised when chat history retrieval fails."""

    pass
