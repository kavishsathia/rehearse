import {
  setupAgent,
  generateMockResult,
  patchQueryResult,
  extractSchema,
  hashSource,
} from "../src/services/agent";

// Mock memory service
jest.mock("../src/services/memory", () => ({
  getMutations: jest.fn().mockResolvedValue([]),
  getSchema: jest.fn().mockResolvedValue(null),
}));

jest.mock("../src/services/elasticsearch", () => ({
  SHORT_TERM_INDEX_PREFIX: "rehearse-session-",
  LONG_TERM_INDEX: "rehearse-schemas",
}));

import { getMutations, getSchema } from "../src/services/memory";

// Track all fetch calls
const fetchCalls: Array<{ url: string; method: string; body: any }> = [];

// Mock global fetch
const mockFetch = jest.fn().mockImplementation(async (url: string, init: any) => {
  const body = init?.body ? JSON.parse(init.body) : undefined;
  fetchCalls.push({ url, method: init?.method, body });

  // Return different responses based on the URL path
  if (url.includes("/api/agent_builder/tools")) {
    return {
      ok: true,
      json: async () => ({ id: body?.id, status: "created" }),
      text: async () => "",
    };
  }

  if (url.includes("/api/agent_builder/agents")) {
    return {
      ok: true,
      json: async () => ({ id: body?.id, status: "created" }),
      text: async () => "",
    };
  }

  if (url.includes("/api/agent_builder/converse")) {
    // Return a mock JSON response from the agent
    return {
      ok: true,
      json: async () => ({
        output: JSON.stringify({ status: "sent", message_id: "msg-001" }),
      }),
      text: async () => "",
    };
  }

  return { ok: false, status: 404, text: async () => "Not found" };
});

global.fetch = mockFetch as any;

beforeEach(() => {
  fetchCalls.length = 0;
  mockFetch.mockClear();
  (getMutations as jest.Mock).mockReset().mockResolvedValue([]);
  (getSchema as jest.Mock).mockReset().mockResolvedValue(null);
});

describe("setupAgent", () => {
  it("registers two tools and one agent", async () => {
    await setupAgent();

    // Should make 3 calls: 2 tools + 1 agent
    expect(fetchCalls).toHaveLength(3);

    // First call: search_mutations tool
    expect(fetchCalls[0].url).toContain("/api/agent_builder/tools");
    expect(fetchCalls[0].method).toBe("POST");
    expect(fetchCalls[0].body.id).toBe("rehearse.search_mutations");
    expect(fetchCalls[0].body.type).toBe("esql");

    // Second call: get_schema tool
    expect(fetchCalls[1].url).toContain("/api/agent_builder/tools");
    expect(fetchCalls[1].body.id).toBe("rehearse.get_schema");

    // Third call: agent
    expect(fetchCalls[2].url).toContain("/api/agent_builder/agents");
    expect(fetchCalls[2].body.id).toBe("rehearse-mock-agent");
    expect(fetchCalls[2].body.configuration.tools[0].tool_ids).toContain(
      "rehearse.search_mutations"
    );
    expect(fetchCalls[2].body.configuration.tools[0].tool_ids).toContain(
      "rehearse.get_schema"
    );
    expect(fetchCalls[2].body.configuration.tools[0].tool_ids).toContain(
      "platform.core.search"
    );
  });

  it("sends correct auth headers", async () => {
    await setupAgent();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toMatch(/^ApiKey /);
    expect(headers["kbn-xsrf"]).toBe("true");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws on Kibana error", async () => {
    mockFetch.mockImplementationOnce(async (url: string, init: any) => {
      fetchCalls.push({ url, method: init?.method, body: null });
      return {
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      };
    });

    await expect(setupAgent()).rejects.toThrow("Kibana POST /api/agent_builder/tools failed (500)");
  });
});

describe("generateMockResult", () => {
  it("calls converse endpoint with correct agent_id", async () => {
    const result = await generateMockResult(
      "session-1",
      "send_email",
      { to: "bob@example.com", subject: "Hi" },
      "def send_email(to, subject): ...",
      "Send an email"
    );

    const converseCall = fetchCalls.find((c) =>
      c.url.includes("/api/agent_builder/converse")
    );
    expect(converseCall).toBeDefined();
    expect(converseCall!.body.agent_id).toBe("rehearse-mock-agent");
    expect(converseCall!.body.input).toContain("send_email");
    expect(converseCall!.body.input).toContain("bob@example.com");
  });

  it("parses JSON response from agent", async () => {
    const result = await generateMockResult(
      "session-1",
      "send_email",
      { to: "bob@example.com" },
      "def send_email(to): ...",
      null
    );

    expect(result).toEqual({ status: "sent", message_id: "msg-001" });
  });

  it("returns raw string if agent response is not valid JSON", async () => {
    mockFetch.mockImplementationOnce(async (url: string, init: any) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      fetchCalls.push({ url, method: init?.method, body });
      return {
        ok: true,
        json: async () => ({ output: "not valid json" }),
        text: async () => "",
      };
    });

    const result = await generateMockResult(
      "session-1",
      "send_email",
      {},
      "def send_email(): ...",
      null
    );

    expect(result).toBe("not valid json");
  });

  it("includes schema in prompt when available", async () => {
    (getSchema as jest.Mock).mockResolvedValueOnce({
      source_code_hash: "abc",
      schema: { type: "object", properties: { status: { type: "string" } } },
    });

    await generateMockResult(
      "session-1",
      "send_email",
      {},
      "def send_email(): ...",
      null
    );

    const converseCall = fetchCalls.find((c) =>
      c.url.includes("/api/agent_builder/converse")
    );
    expect(converseCall!.body.input).toContain("Known output schema");
  });

  it("includes recent mutations in prompt for context", async () => {
    (getMutations as jest.Mock).mockResolvedValueOnce([
      {
        timestamp: "2026-01-01T00:00:00Z",
        type: "mutation" as const,
        function_name: "create_user",
        args: { name: "Alice" },
        source_code: "...",
        docstring: null,
        mock_result: { id: 1 },
      },
    ]);

    await generateMockResult(
      "session-1",
      "send_email",
      {},
      "def send_email(): ...",
      null
    );

    const converseCall = fetchCalls.find((c) =>
      c.url.includes("/api/agent_builder/converse")
    );
    expect(converseCall!.body.input).toContain("create_user");
    expect(converseCall!.body.input).toContain("Recent mutations");
  });
});

describe("patchQueryResult", () => {
  it("returns real result when no mutations exist", async () => {
    const realResult = { emails: [{ id: 1 }] };
    const result = await patchQueryResult(
      "session-1",
      "get_emails",
      {},
      "def get_emails(): ...",
      null,
      realResult
    );

    expect(result).toEqual(realResult);
    // Should NOT have called converse
    const converseCalls = fetchCalls.filter((c) =>
      c.url.includes("/api/agent_builder/converse")
    );
    expect(converseCalls).toHaveLength(0);
  });

  it("calls converse when mutations exist", async () => {
    (getMutations as jest.Mock).mockResolvedValueOnce([
      {
        timestamp: "2026-01-01T00:00:00Z",
        type: "mutation" as const,
        function_name: "send_email",
        args: { to: "bob@example.com" },
        source_code: "...",
        docstring: null,
        mock_result: { status: "sent" },
      },
    ]);

    await patchQueryResult(
      "session-1",
      "get_sent_emails",
      {},
      "def get_sent_emails(): ...",
      null,
      { emails: [] }
    );

    const converseCall = fetchCalls.find((c) =>
      c.url.includes("/api/agent_builder/converse")
    );
    expect(converseCall).toBeDefined();
    expect(converseCall!.body.input).toContain("send_email");
    expect(converseCall!.body.input).toContain("Virtual mutations to reflect");
  });

  it("includes real result in the prompt", async () => {
    (getMutations as jest.Mock).mockResolvedValueOnce([
      {
        timestamp: "2026-01-01T00:00:00Z",
        type: "mutation" as const,
        function_name: "drop_table",
        args: { name: "users" },
        source_code: "...",
        docstring: null,
        mock_result: null,
      },
    ]);

    await patchQueryResult(
      "session-1",
      "list_tables",
      {},
      "def list_tables(): ...",
      null,
      ["users", "orders", "products"]
    );

    const converseCall = fetchCalls.find((c) =>
      c.url.includes("/api/agent_builder/converse")
    );
    expect(converseCall!.body.input).toContain("Real result");
    expect(converseCall!.body.input).toContain("users");
  });
});

describe("extractSchema", () => {
  it("sends output to converse for schema extraction", async () => {
    const expectedSchema = {
      type: "object",
      properties: {
        status: { type: "string" },
        message_id: { type: "string" },
      },
    };

    mockFetch.mockImplementationOnce(async (url: string, init: any) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      fetchCalls.push({ url, method: init?.method, body });
      return {
        ok: true,
        json: async () => ({ output: JSON.stringify(expectedSchema) }),
        text: async () => "",
      };
    });

    const schema = await extractSchema({ status: "sent", message_id: "msg-1" });

    const converseCall = fetchCalls.find((c) =>
      c.url.includes("/api/agent_builder/converse")
    );
    expect(converseCall).toBeDefined();
    expect(converseCall!.body.input).toContain("Extract the JSON Schema");
    expect(schema).toEqual(expectedSchema);
  });
});

describe("hashSource", () => {
  it("returns consistent SHA-256 hash", () => {
    const hash1 = hashSource("def foo(): pass");
    const hash2 = hashSource("def foo(): pass");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it("returns different hash for different source", () => {
    const hash1 = hashSource("def foo(): pass");
    const hash2 = hashSource("def bar(): pass");
    expect(hash1).not.toBe(hash2);
  });
});
