import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import rehearse
from rehearse.decorators import _extract_metadata, _client
import rehearse.decorators as decorators_module


@rehearse.mutation
def send_email(to: str, subject: str, body: str) -> dict:
    """Send an email via SMTP."""
    raise RuntimeError("Should not be called in rehearsal mode")


@rehearse.query
def get_emails() -> list:
    """Fetch all emails."""
    return [{"id": 1, "from": "alice@example.com", "subject": "Hello"}]


@rehearse.mutation
def drop_table(table_name: str) -> None:
    """Drop a database table."""
    raise RuntimeError("Should not be called in rehearsal mode")


@rehearse.query
def get_tables() -> list:
    """List all database tables."""
    return ["users", "orders", "emails"]


class TestMutationDecorator:
    def test_passthrough_without_api_key(self):
        """Without REHEARSE_API_KEY, mutation should call the real function."""
        env = os.environ.copy()
        env.pop("REHEARSE_API_KEY", None)
        with patch.dict(os.environ, env, clear=True):

            @rehearse.mutation
            def real_func(x: int) -> int:
                return x * 2

            assert real_func(5) == 10

    def test_intercepts_in_rehearsal_mode(self):
        """In rehearsal mode, mutation should NOT call the real function."""
        mock_client = MagicMock()
        mock_client.create_session.return_value = "test-session-id"
        mock_client.record_mutation.return_value = {"status": "sent", "id": "mock-1"}
        mock_client.close_session.return_value = None

        with patch.dict(os.environ, {"REHEARSE_API_KEY": "test-key"}):
            with patch.object(decorators_module, "_client", mock_client):
                with patch("rehearse.session.RehearsalClient", return_value=mock_client):
                    with rehearse.Session() as session:
                        result = send_email("bob@example.com", "Hi", "Hello there")

        assert result == {"status": "sent", "id": "mock-1"}
        mock_client.record_mutation.assert_called_once()
        call_kwargs = mock_client.record_mutation.call_args
        assert call_kwargs.kwargs["function_name"] == "send_email"
        assert call_kwargs.kwargs["args"]["to"] == "bob@example.com"

    def test_extracts_source_code_and_docstring(self):
        """Should extract function source and docstring."""
        mock_client = MagicMock()
        mock_client.create_session.return_value = "test-session-id"
        mock_client.record_mutation.return_value = None
        mock_client.close_session.return_value = None

        with patch.dict(os.environ, {"REHEARSE_API_KEY": "test-key"}):
            with patch.object(decorators_module, "_client", mock_client):
                with patch("rehearse.session.RehearsalClient", return_value=mock_client):
                    with rehearse.Session():
                        drop_table("users")

        call_kwargs = mock_client.record_mutation.call_args.kwargs
        assert "def drop_table" in call_kwargs["source_code"]
        assert call_kwargs["docstring"] == "Drop a database table."


class TestQueryDecorator:
    def test_passthrough_without_api_key(self):
        """Without REHEARSE_API_KEY, query should return real result."""
        env = os.environ.copy()
        env.pop("REHEARSE_API_KEY", None)
        with patch.dict(os.environ, env, clear=True):
            result = get_emails()

        assert result == [{"id": 1, "from": "alice@example.com", "subject": "Hello"}]

    def test_patches_result_in_rehearsal_mode(self):
        """In rehearsal mode, query should call real function then patch."""
        mock_client = MagicMock()
        mock_client.create_session.return_value = "test-session-id"
        mock_client.patch_query.return_value = [
            {"id": 1, "from": "alice@example.com", "subject": "Hello"},
            {"id": 2, "from": "bob@example.com", "subject": "Re: Hello"},
        ]
        mock_client.close_session.return_value = None

        with patch.dict(os.environ, {"REHEARSE_API_KEY": "test-key"}):
            with patch.object(decorators_module, "_client", mock_client):
                with patch("rehearse.session.RehearsalClient", return_value=mock_client):
                    with rehearse.Session():
                        result = get_emails()

        # Should return the patched result, not the real one
        assert len(result) == 2
        assert result[1]["from"] == "bob@example.com"

        # Should have sent the real result to the server for patching
        call_kwargs = mock_client.patch_query.call_args.kwargs
        assert call_kwargs["real_result"] == [
            {"id": 1, "from": "alice@example.com", "subject": "Hello"}
        ]

    def test_always_executes_real_function(self):
        """Query decorator should always run the real function."""
        call_count = 0

        @rehearse.query
        def counting_query() -> int:
            nonlocal call_count
            call_count += 1
            return call_count

        mock_client = MagicMock()
        mock_client.create_session.return_value = "test-session-id"
        mock_client.patch_query.return_value = 999
        mock_client.close_session.return_value = None

        with patch.dict(os.environ, {"REHEARSE_API_KEY": "test-key"}):
            with patch.object(decorators_module, "_client", mock_client):
                with patch("rehearse.session.RehearsalClient", return_value=mock_client):
                    with rehearse.Session():
                        counting_query()

        assert call_count == 1


class TestExtractMetadata:
    def test_extracts_positional_args(self):
        def my_func(a: int, b: str, c: float = 3.14):
            pass

        name, args, source, doc = _extract_metadata(my_func, (1, "hello"), {})
        assert args == {"a": 1, "b": "hello", "c": 3.14}

    def test_extracts_keyword_args(self):
        def my_func(a: int, b: str):
            pass

        name, args, source, doc = _extract_metadata(my_func, (), {"a": 1, "b": "hi"})
        assert args == {"a": 1, "b": "hi"}

    def test_non_serializable_args_become_strings(self):
        def my_func(obj):
            pass

        class Custom:
            def __str__(self):
                return "custom-obj"

        name, args, source, doc = _extract_metadata(my_func, (Custom(),), {})
        assert args["obj"] == "custom-obj"

    def test_extracts_qualname(self):
        def my_func():
            pass

        name, _, _, _ = _extract_metadata(my_func, (), {})
        assert "my_func" in name


class TestSession:
    def test_no_op_without_api_key(self):
        """Session should be a no-op without REHEARSE_API_KEY."""
        env = os.environ.copy()
        env.pop("REHEARSE_API_KEY", None)
        with patch.dict(os.environ, env, clear=True):
            with rehearse.Session() as session:
                assert session.session_id is None
                trace = session.get_rehearsal()
                assert trace == {"trace": [], "note": "Not in rehearsal mode"}

    def test_creates_session_with_api_key(self):
        """Session should create a remote session when API key is set."""
        mock_client = MagicMock()
        mock_client.create_session.return_value = "session-abc"
        mock_client.close_session.return_value = None

        with patch.dict(os.environ, {"REHEARSE_API_KEY": "test-key"}):
            with patch("rehearse.session.RehearsalClient", return_value=mock_client):
                with rehearse.Session() as session:
                    assert session.session_id == "session-abc"

        mock_client.create_session.assert_called_once()
        mock_client.close_session.assert_called_once_with("session-abc")

    def test_closes_session_on_exit(self):
        """Session should close on context manager exit."""
        mock_client = MagicMock()
        mock_client.create_session.return_value = "session-xyz"
        mock_client.close_session.return_value = None

        with patch.dict(os.environ, {"REHEARSE_API_KEY": "test-key"}):
            with patch("rehearse.session.RehearsalClient", return_value=mock_client):
                with rehearse.Session():
                    pass

        mock_client.close_session.assert_called_once_with("session-xyz")

    def test_closes_session_on_exception(self):
        """Session should close even if an exception occurs."""
        mock_client = MagicMock()
        mock_client.create_session.return_value = "session-err"
        mock_client.close_session.return_value = None

        with patch.dict(os.environ, {"REHEARSE_API_KEY": "test-key"}):
            with patch("rehearse.session.RehearsalClient", return_value=mock_client):
                with pytest.raises(ValueError):
                    with rehearse.Session():
                        raise ValueError("test error")

        mock_client.close_session.assert_called_once_with("session-err")

    def test_get_rehearsal(self):
        """Should retrieve rehearsal trace from server."""
        mock_client = MagicMock()
        mock_client.create_session.return_value = "session-trace"
        mock_client.close_session.return_value = None
        mock_client.get_rehearsal.return_value = {
            "session_id": "session-trace",
            "trace": [{"type": "mutation", "function_name": "send_email"}],
        }

        with patch.dict(os.environ, {"REHEARSE_API_KEY": "test-key"}):
            with patch("rehearse.session.RehearsalClient", return_value=mock_client):
                with rehearse.Session() as session:
                    trace = session.get_rehearsal()

        assert trace["session_id"] == "session-trace"
        assert len(trace["trace"]) == 1
