"""
End-to-end test: increment_count (mutation) + get_count (query).

Prerequisites:
  1. Server running:  cd server && npm run dev
  2. .env has KIBANA_URL and KIBANA_API_KEY set
  3. ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY set for the server

Run:
  REHEARSE_API_KEY=test REHEARSE_URL=http://localhost:3000 python e2e/test_counter.py
"""

import os
import sys

# Add SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk"))

import rehearse

# ── Simulated real state ──────────────────────────────────────────────

_real_count = 0


@rehearse.mutation
def increment_count(amount: int = 1) -> dict:
    """Increment the global counter by `amount` and return the new value."""
    global _real_count
    _real_count += amount
    return {"previous": _real_count - amount, "new": _real_count}


@rehearse.query
def get_count() -> dict:
    """Return the current counter value."""
    return {"count": _real_count}


# ── Run the rehearsal ─────────────────────────────────────────────────

def main():
    print("=== Rehearse E2E: counter ===\n")
    print(f"REHEARSE_API_KEY set: {bool(os.environ.get('REHEARSE_API_KEY'))}")
    print(f"REHEARSE_URL:        {os.environ.get('REHEARSE_URL', 'http://localhost:3000')}")
    print(f"Real count before:   {_real_count}\n")

    with rehearse.Session() as session:
        print(f"Session ID: {session.session_id}\n")

        # Step 1: read the count (should be 0, no mutations yet → passes through)
        result1 = get_count()
        print(f"1. get_count()          → {result1}")

        # Step 2: increment (mutation → mocked, real counter stays 0)
        result2 = increment_count(amount=1)
        print(f"2. increment_count(1)   → {result2}")

        # Step 3: increment again
        result3 = increment_count(amount=5)
        print(f"3. increment_count(5)   → {result3}")

        # Step 4: read count again (should be patched to reflect virtual increments)
        result4 = get_count()
        print(f"4. get_count()          → {result4}")

        # Step 5: fetch the full rehearsal trace
        trace = session.get_rehearsal()
        print(f"\n--- Rehearsal trace ({len(trace.get('trace', []))} entries) ---")
        for i, entry in enumerate(trace.get("trace", [])):
            t = entry.get("type", "?")
            fn = entry.get("function_name", "?")
            if t == "mutation":
                print(f"  [{i}] MUTATION {fn}  args={entry.get('args')}  mock_result={entry.get('mock_result')}")
            else:
                print(f"  [{i}] QUERY   {fn}  args={entry.get('args')}  patched_result={entry.get('patched_result')}")

    print(f"\nReal count after:    {_real_count}")
    assert _real_count == 0, f"Real count should still be 0 but was {_real_count}"
    print("✓ Real counter was never mutated — rehearsal worked!")


if __name__ == "__main__":
    main()
