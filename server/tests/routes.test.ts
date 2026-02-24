import request from "supertest";
import app from "../src/app";

// Mock elasticsearch service
jest.mock("../src/services/elasticsearch", () => ({
  getClient: jest.fn(),
  ensureLongTermIndex: jest.fn(),
  createSessionIndex: jest.fn().mockResolvedValue(undefined),
  deleteSessionIndex: jest.fn().mockResolvedValue(undefined),
  SHORT_TERM_INDEX_PREFIX: "rehearse-session-",
  LONG_TERM_INDEX: "rehearse-schemas",
}));

// Mock agent service
jest.mock("../src/services/agent", () => ({
  setupAgent: jest.fn().mockResolvedValue(undefined),
  generateMockResult: jest.fn().mockResolvedValue({ status: "ok", id: "mock-123" }),
  patchQueryResult: jest.fn().mockResolvedValue({ emails: [], patched: true }),
  extractSchema: jest.fn().mockResolvedValue({
    type: "object",
    properties: { status: { type: "string" } },
  }),
  hashSource: jest.fn().mockReturnValue("abc123"),
}));

// Mock memory service
jest.mock("../src/services/memory", () => ({
  storeMutation: jest.fn().mockResolvedValue(undefined),
  storeQuery: jest.fn().mockResolvedValue(undefined),
  getMutations: jest.fn().mockResolvedValue([]),
  getSessionHistory: jest.fn().mockResolvedValue([
    {
      timestamp: "2026-01-01T00:00:00.000Z",
      type: "mutation",
      function_name: "send_email",
      args: { to: "bob@example.com" },
      source_code: "def send_email(to): ...",
      docstring: null,
      mock_result: { status: "ok" },
    },
  ]),
  getSchema: jest.fn().mockResolvedValue(null),
  storeSchema: jest.fn().mockResolvedValue(undefined),
}));

describe("Health check", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("Auth middleware", () => {
  beforeAll(() => {
    process.env.REHEARSE_API_KEY = "test-key";
  });

  afterAll(() => {
    delete process.env.REHEARSE_API_KEY;
  });

  it("rejects requests without API key", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid API key");
  });

  it("accepts requests with valid API key", async () => {
    const res = await request(app)
      .get("/health")
      .set("x-api-key", "test-key");
    expect(res.status).toBe(200);
  });

  it("rejects requests with wrong API key", async () => {
    const res = await request(app)
      .get("/health")
      .set("x-api-key", "wrong-key");
    expect(res.status).toBe(401);
  });
});

describe("Sessions", () => {
  it("POST /sessions creates a new session", async () => {
    const res = await request(app).post("/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("session_id");
    expect(res.body).toHaveProperty("created_at");
    expect(res.body.status).toBe("active");
  });

  it("GET /sessions/:id/rehearsal returns trace", async () => {
    // First create a session
    const createRes = await request(app).post("/sessions");
    const sessionId = createRes.body.session_id;

    const res = await request(app).get(`/sessions/${sessionId}/rehearsal`);
    expect(res.status).toBe(200);
    expect(res.body.session_id).toBe(sessionId);
    expect(res.body).toHaveProperty("trace");
    expect(Array.isArray(res.body.trace)).toBe(true);
  });

  it("GET /sessions/:id/rehearsal returns 404 for unknown session", async () => {
    const res = await request(app).get("/sessions/nonexistent/rehearsal");
    expect(res.status).toBe(404);
  });

  it("DELETE /sessions/:id closes a session", async () => {
    const createRes = await request(app).post("/sessions");
    const sessionId = createRes.body.session_id;

    const res = await request(app).delete(`/sessions/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("closed");
  });

  it("DELETE /sessions/:id returns 404 for unknown session", async () => {
    const res = await request(app).delete("/sessions/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("Mutations", () => {
  it("POST /sessions/:id/mutations records a mutation and returns mock", async () => {
    const createRes = await request(app).post("/sessions");
    const sessionId = createRes.body.session_id;

    const res = await request(app)
      .post(`/sessions/${sessionId}/mutations`)
      .send({
        function_name: "send_email",
        args: { to: "bob@example.com", subject: "Hello", body: "World" },
        source_code: 'def send_email(to, subject, body):\n    smtp.send(to, subject, body)',
        docstring: "Send an email",
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("mock_result");
    expect(res.body.mock_result).toEqual({ status: "ok", id: "mock-123" });
  });
});

describe("Queries", () => {
  it("POST /sessions/:id/queries patches a query result", async () => {
    const createRes = await request(app).post("/sessions");
    const sessionId = createRes.body.session_id;

    const res = await request(app)
      .post(`/sessions/${sessionId}/queries`)
      .send({
        function_name: "get_emails",
        args: {},
        source_code: "def get_emails():\n    return db.fetch_emails()",
        docstring: "Get all emails",
        real_result: { emails: [{ id: 1, from: "alice@example.com" }] },
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("patched_result");
  });
});

describe("Learn", () => {
  it("POST /learn stores output schema", async () => {
    const res = await request(app)
      .post("/learn")
      .send({
        source_code_hash: "abc123def456",
        function_name: "send_email",
        actual_output: { status: "sent", message_id: "msg-789" },
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("source_code_hash");
    expect(res.body).toHaveProperty("schema");
  });
});
