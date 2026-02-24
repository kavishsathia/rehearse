import os
from typing import Any

import requests


class RehearsalClient:
    """HTTP client for the Rehearse mocking server."""

    def __init__(self) -> None:
        self.base_url = os.environ.get("REHEARSE_URL", "http://localhost:3000")
        self.api_key = os.environ.get("REHEARSE_API_KEY", "")

    def _headers(self) -> dict[str, str]:
        return {"x-api-key": self.api_key, "Content-Type": "application/json"}

    def create_session(self) -> str:
        resp = requests.post(
            f"{self.base_url}/sessions", headers=self._headers()
        )
        resp.raise_for_status()
        return resp.json()["session_id"]

    def close_session(self, session_id: str) -> None:
        requests.delete(
            f"{self.base_url}/sessions/{session_id}", headers=self._headers()
        )

    def record_mutation(
        self,
        session_id: str,
        function_name: str,
        args: dict[str, Any],
        source_code: str,
        docstring: str | None,
    ) -> Any:
        resp = requests.post(
            f"{self.base_url}/sessions/{session_id}/mutations",
            headers=self._headers(),
            json={
                "function_name": function_name,
                "args": args,
                "source_code": source_code,
                "docstring": docstring,
            },
        )
        resp.raise_for_status()
        return resp.json()["mock_result"]

    def patch_query(
        self,
        session_id: str,
        function_name: str,
        args: dict[str, Any],
        source_code: str,
        docstring: str | None,
        real_result: Any,
    ) -> Any:
        resp = requests.post(
            f"{self.base_url}/sessions/{session_id}/queries",
            headers=self._headers(),
            json={
                "function_name": function_name,
                "args": args,
                "source_code": source_code,
                "docstring": docstring,
                "real_result": real_result,
            },
        )
        resp.raise_for_status()
        return resp.json()["patched_result"]

    def get_rehearsal(self, session_id: str) -> dict[str, Any]:
        resp = requests.get(
            f"{self.base_url}/sessions/{session_id}/rehearsal",
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()

    def learn(
        self,
        source_code_hash: str,
        function_name: str,
        actual_output: Any,
    ) -> dict[str, Any]:
        resp = requests.post(
            f"{self.base_url}/learn",
            headers=self._headers(),
            json={
                "source_code_hash": source_code_hash,
                "function_name": function_name,
                "actual_output": actual_output,
            },
        )
        resp.raise_for_status()
        return resp.json()
