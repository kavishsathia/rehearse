import path from "path";
import dotenv from "dotenv";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const KIBANA_URL = process.env.KIBANA_URL;
const KIBANA_API_KEY = process.env.KIBANA_API_KEY;

if (!KIBANA_API_KEY || !KIBANA_URL) {
  throw new Error("KIBANA_API_KEY and KIBANA_URL must be set in .env to run integration tests");
}

function headers(): Record<string, string> {
  return {
    Authorization: `ApiKey ${KIBANA_API_KEY}`,
    "kbn-xsrf": "true",
    "Content-Type": "application/json",
  };
}

async function kibanaRequest(method: string, path: string, body?: unknown) {
  const resp = await fetch(`${KIBANA_URL}${path}`, {
    method,
    headers: headers(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await resp.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: resp.status, ok: resp.ok, body: json, text };
}

// Unique IDs so tests don't collide
const TEST_TOOL_ID = `rehearse.test_tool_${Date.now()}`;
const TEST_AGENT_ID = `rehearse-test-agent-${Date.now()}`;

describe("Kibana Agent Builder Integration", () => {
  // Cleanup after all tests
  afterAll(async () => {
    // Delete test agent
    await kibanaRequest("DELETE", `/api/agent_builder/agents/${TEST_AGENT_ID}`);
    // Delete test tool
    await kibanaRequest("DELETE", `/api/agent_builder/tools/${TEST_TOOL_ID}`);
  });

  describe("Tools API", () => {
    it("creates a tool", async () => {
      const res = await kibanaRequest("POST", "/api/agent_builder/tools", {
        id: TEST_TOOL_ID,
        type: "esql",
        description: "Integration test tool — searches for test data",
        configuration: {
          query: 'FROM test-index | WHERE type == ?test_param | LIMIT 10',
          params: {
            test_param: {
              type: "string",
              description: "A test parameter",
            },
          },
        },
      });

      console.log("Create tool response:", res.status, JSON.stringify(res.body));
      expect(res.ok).toBe(true);
    });

    it("lists tools and finds the created tool", async () => {
      const res = await kibanaRequest("GET", "/api/agent_builder/tools");

      console.log("List tools response:", res.status);
      expect(res.ok).toBe(true);

      // Response could be an array or an object with a nested array
      const tools = Array.isArray(res.body)
        ? res.body
        : res.body?.tools ?? res.body?.data ?? Object.values(res.body ?? {}).find(Array.isArray) ?? [];
      console.log("Tools count:", tools.length, "Looking for:", TEST_TOOL_ID);
      const found = tools.find((t: any) => t.id === TEST_TOOL_ID);
      expect(found).toBeDefined();
    });

    it("gets a tool by ID", async () => {
      const res = await kibanaRequest(
        "GET",
        `/api/agent_builder/tools/${TEST_TOOL_ID}`
      );

      console.log("Get tool response:", res.status, JSON.stringify(res.body));
      expect(res.ok).toBe(true);
    });
  });

  describe("Agents API", () => {
    it("creates an agent with the test tool", async () => {
      const res = await kibanaRequest("POST", "/api/agent_builder/agents", {
        id: TEST_AGENT_ID,
        name: "Rehearse Integration Test Agent",
        description: "Agent created by integration tests",
        configuration: {
          instructions:
            "You are a test agent. Respond with valid JSON only. No explanation.",
          tools: [
            {
              tool_ids: [TEST_TOOL_ID, "platform.core.search"],
            },
          ],
        },
      });

      console.log("Create agent response:", res.status, JSON.stringify(res.body));
      expect(res.ok).toBe(true);
    });

    it("lists agents and finds the created agent", async () => {
      const res = await kibanaRequest("GET", "/api/agent_builder/agents");

      console.log("List agents response:", res.status);
      expect(res.ok).toBe(true);

      const agents = Array.isArray(res.body)
        ? res.body
        : res.body?.agents ?? res.body?.data ?? Object.values(res.body ?? {}).find(Array.isArray) ?? [];
      console.log("Agents count:", agents.length, "Looking for:", TEST_AGENT_ID);
      const found = agents.find((a: any) => a.id === TEST_AGENT_ID);
      expect(found).toBeDefined();
    });

    it("gets an agent by ID", async () => {
      const res = await kibanaRequest(
        "GET",
        `/api/agent_builder/agents/${TEST_AGENT_ID}`
      );

      console.log("Get agent response:", res.status, JSON.stringify(res.body));
      expect(res.ok).toBe(true);
    });
  });

  describe("Converse API", () => {
    it("sends a message and gets a response", async () => {
      const res = await kibanaRequest("POST", "/api/agent_builder/converse", {
        input: 'Return the JSON object: {"hello": "world"}',
        agent_id: TEST_AGENT_ID,
      });

      console.log("Converse response:", res.status, JSON.stringify(res.body));
      expect(res.ok).toBe(true);

      // The agent should return some response
      const output = res.body?.response?.message ?? res.body?.output ?? res.body?.message ?? "";
      expect(output).toBeTruthy();
      console.log("Agent output:", output);
    });

    it("generates a mock for a function call", async () => {
      const res = await kibanaRequest("POST", "/api/agent_builder/converse", {
        input: `TASK: Generate a plausible return value for this function call.

Function: send_email
Arguments: {"to": "bob@example.com", "subject": "Meeting tomorrow", "body": "Hi Bob, can we meet at 3pm?"}
Source code:
def send_email(to, subject, body):
    """Send an email via SMTP and return a status dict."""
    return smtp_client.send(to=to, subject=subject, body=body)

Docstring: Send an email via SMTP and return a status dict.

Respond with ONLY the JSON return value.`,
        agent_id: TEST_AGENT_ID,
      });

      console.log("Mock generation response:", res.status);
      expect(res.ok).toBe(true);

      const output = res.body?.response?.message ?? res.body?.output ?? res.body?.message ?? "";
      console.log("Generated mock:", output);

      // Try to parse the response as JSON
      let parsed: any;
      try {
        parsed = JSON.parse(output);
      } catch {
        // Agent might wrap in markdown — still useful to see the output
        console.log("Note: output was not pure JSON, got:", output);
      }

      expect(output).toBeTruthy();
    });
  });

  describe("Cleanup", () => {
    it("deletes the test agent", async () => {
      const res = await kibanaRequest(
        "DELETE",
        `/api/agent_builder/agents/${TEST_AGENT_ID}`
      );
      console.log("Delete agent response:", res.status);
      expect(res.ok).toBe(true);
    });

    it("deletes the test tool", async () => {
      const res = await kibanaRequest(
        "DELETE",
        `/api/agent_builder/tools/${TEST_TOOL_ID}`
      );
      console.log("Delete tool response:", res.status);
      expect(res.ok).toBe(true);
    });
  });
});
