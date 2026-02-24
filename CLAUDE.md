# Rehearse

AI agents rehearse irreversible actions in a simulated environment before executing for real.

## What this is

A two-component system: a **Python SDK** with decorators that intercept function calls, and a **TypeScript/Express server** that uses Elasticsearch Agent Builder to generate mock results and patch query results based on virtual mutations.

The core idea: mutations (`@rehearse.mutation`) are intercepted and never executed — the Elastic agent generates plausible return values. Queries (`@rehearse.query`) execute for real, then get patched by the agent to reflect virtual mutations from the session.

## Project structure

```
rehearse/
├── server/          # TypeScript/Express mocking server
│   └── src/
│       ├── index.ts              # Entry point — registers agent on startup
│       ├── app.ts                # Express app, middleware, route mounting
│       ├── types.ts              # Shared types
│       ├── routes/
│       │   ├── sessions.ts       # POST /sessions, GET /:id/rehearsal, DELETE /:id
│       │   ├── mutations.ts      # POST /sessions/:id/mutations
│       │   ├── queries.ts        # POST /sessions/:id/queries
│       │   └── learn.ts          # POST /learn
│       └── services/
│           ├── agent.ts          # Kibana Agent Builder: tool/agent registration, converse
│           ├── elasticsearch.ts  # ES client, index lifecycle
│           └── memory.ts         # Short-term & long-term memory CRUD
├── sdk/             # Python SDK
│   └── rehearse/
│       ├── __init__.py           # Exports: mutation, query, Session
│       ├── decorators.py         # @rehearse.mutation, @rehearse.query
│       ├── session.py            # Context manager, contextvars for session ID
│       └── client.py             # HTTP client to mocking server
└── e2e/
    └── test_counter.py           # End-to-end test with increment_count + get_count
```

## Key architecture decisions

- **Elasticsearch Agent Builder** (Kibana API) powers the mock agent — registered via `/api/agent_builder/tools` and `/api/agent_builder/agents`, invoked via `/api/agent_builder/converse`
- **Short-term memory**: per-session ES index (`rehearse-session-{id}`) stores mutations and queries for the session
- **Long-term memory**: persistent `rehearse-schemas` index maps function source hash → output schema, so mocks improve over time
- **ES|QL tools**: `search_mutations` (queries `rehearse-session-*` by function name) and `get_schema` (queries `rehearse-schemas` by hash) — note: ES|QL params (`?param`) only work in WHERE clauses, not in FROM index names
- **Session scoping**: Python `contextvars.ContextVar` holds session ID so decorators can access it without explicit passing
- **`REHEARSE_API_KEY` env var**: if not set, decorators are no-ops with zero overhead

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `KIBANA_URL` | server | Kibana endpoint for Agent Builder API |
| `KIBANA_API_KEY` | server | Auth for Kibana API |
| `ELASTICSEARCH_URL` | server | ES cluster endpoint (`.es.` not `.kb.`) |
| `ELASTICSEARCH_API_KEY` | server | Auth for ES client |
| `REHEARSE_API_KEY` | sdk + server | Toggles rehearsal mode; also used as server auth |
| `REHEARSE_URL` | sdk | Mocking server URL (default `http://localhost:3000`) |

## Running

```bash
# Server
cd server && npm install && npm run dev

# E2E test
REHEARSE_API_KEY=test REHEARSE_URL=http://localhost:3000 python e2e/test_counter.py
```

## Tests

```bash
# Server unit tests
cd server && npm test

# Python SDK tests
cd sdk && venv/bin/pytest tests/

# Integration tests (hits real Kibana)
cd server && npx jest tests/agent.integration.test.ts
```

## Gotchas

- `KIBANA_API_KEY` in agent.ts is captured at module scope — changing the env var after import has no effect (relevant for unit tests)
- The agent sometimes wraps JSON in markdown code fences despite instructions — the system prompt explicitly tells it not to
- Converse API response format: `response.response.message` (not `response.output`)
- Same Elastic Cloud API key works for both Kibana and ES endpoints
