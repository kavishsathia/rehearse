from __future__ import annotations

import functools
import inspect
from typing import Any, Callable, TypeVar, cast

from .client import RehearsalClient
from .session import get_active_session, is_rehearsing

F = TypeVar("F", bound=Callable[..., Any])

_client: RehearsalClient | None = None


def _get_client() -> RehearsalClient:
    global _client
    if _client is None:
        _client = RehearsalClient()
    return _client


def _extract_metadata(
    func: Callable[..., Any], args: tuple[Any, ...], kwargs: dict[str, Any]
) -> tuple[str, dict[str, Any], str, str | None]:
    """Extract function metadata for the mocking server."""
    function_name = func.__qualname__

    # Build args dict from positional and keyword arguments
    sig = inspect.signature(func)
    bound = sig.bind(*args, **kwargs)
    bound.apply_defaults()
    args_dict: dict[str, Any] = {}
    for key, value in bound.arguments.items():
        try:
            # Attempt JSON serialization — fall back to str
            import json

            json.dumps(value)
            args_dict[key] = value
        except (TypeError, ValueError):
            args_dict[key] = str(value)

    source_code = inspect.getsource(func)
    docstring = func.__doc__

    return function_name, args_dict, source_code, docstring


def mutation(func: F) -> F:
    """Decorator for functions that perform irreversible side effects.

    In rehearsal mode: intercepts the call, records it, returns a mock result.
    Outside rehearsal mode: calls the function normally.

    Usage:
        @rehearse.mutation
        def send_email(to, subject, body):
            smtp.send(to, subject, body)
    """

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        if not is_rehearsing():
            return func(*args, **kwargs)

        session_id = get_active_session()
        assert session_id is not None

        function_name, args_dict, source_code, docstring = _extract_metadata(
            func, args, kwargs
        )

        client = _get_client()
        mock_result = client.record_mutation(
            session_id=session_id,
            function_name=function_name,
            args=args_dict,
            source_code=source_code,
            docstring=docstring,
        )

        return mock_result

    return cast(F, wrapper)


def query(func: F) -> F:
    """Decorator for functions that read state which may be affected by mutations.

    In rehearsal mode: executes the real function, then patches the result
    based on virtual mutations recorded in this session.
    Outside rehearsal mode: calls the function normally.

    Usage:
        @rehearse.query
        def get_emails():
            return db.fetch_emails()
    """

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        # Always execute the real function
        real_result = func(*args, **kwargs)

        if not is_rehearsing():
            return real_result

        session_id = get_active_session()
        assert session_id is not None

        function_name, args_dict, source_code, docstring = _extract_metadata(
            func, args, kwargs
        )

        client = _get_client()
        patched_result = client.patch_query(
            session_id=session_id,
            function_name=function_name,
            args=args_dict,
            source_code=source_code,
            docstring=docstring,
            real_result=real_result,
        )

        return patched_result

    return cast(F, wrapper)
