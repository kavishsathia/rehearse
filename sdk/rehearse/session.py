from __future__ import annotations

import contextvars
import os
from typing import Any

from .client import RehearsalClient

# ContextVar to hold the active session ID — accessible from decorators
_active_session: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "rehearse_session", default=None
)


def get_active_session() -> str | None:
    """Get the current session ID, if inside a rehearsal context."""
    return _active_session.get()


def is_rehearsing() -> bool:
    """Check if we're currently in rehearsal mode."""
    return (
        os.environ.get("REHEARSE_API_KEY") is not None
        and _active_session.get() is not None
    )


class Session:
    """Context manager for a rehearsal session.

    Usage:
        with rehearse.Session() as session:
            agent.run()
            trace = session.get_rehearsal()
    """

    def __init__(self) -> None:
        self._client = RehearsalClient()
        self._session_id: str | None = None
        self._token: contextvars.Token[str | None] | None = None

    def __enter__(self) -> Session:
        if not os.environ.get("REHEARSE_API_KEY"):
            # No API key — session is a no-op
            return self

        self._session_id = self._client.create_session()
        self._token = _active_session.set(self._session_id)
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self._session_id:
            self._client.close_session(self._session_id)
        if self._token is not None:
            _active_session.reset(self._token)

    @property
    def session_id(self) -> str | None:
        return self._session_id

    def get_rehearsal(self) -> dict[str, Any]:
        """Retrieve the full rehearsal trace for this session."""
        if not self._session_id:
            return {"trace": [], "note": "Not in rehearsal mode"}
        return self._client.get_rehearsal(self._session_id)
