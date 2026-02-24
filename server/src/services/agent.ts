import crypto from "crypto";
import { getMutations, getSchema } from "./memory";
import { SHORT_TERM_INDEX_PREFIX, LONG_TERM_INDEX } from "./elasticsearch";
import { MutationRecord } from "../types";

/**
 * Uses the Elastic Agent Builder (Kibana API) to generate mock results
 * and patch query results based on virtual mutations.
 *
 * On startup, registers ES|QL tools and a custom agent.
 * At runtime, converses with the agent to produce mocks and patches.
 */

const KIBANA_URL = process.env.KIBANA_URL || "http://localhost:5601";
const KIBANA_API_KEY = process.env.KIBANA_API_KEY || "";

const AGENT_ID = "rehearse-mock-agent";
const TOOL_SEARCH_MUTATIONS = "rehearse.search_mutations";
const TOOL_GET_SCHEMA = "rehearse.get_schema";

function kibanaHeaders(): Record<string, string> {
  return {
    Authorization: `ApiKey ${KIBANA_API_KEY}`,
    "kbn-xsrf": "true",
    "Content-Type": "application/json",
  };
}

async function kibanaRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const resp = await fetch(`${KIBANA_URL}${path}`, {
    method,
    headers: kibanaHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Kibana ${method} ${path} failed (${resp.status}): ${text}`);
  }

  return resp.json();
}

/**
 * Register the ES|QL tools and agent in Elastic Agent Builder.
 * Called once on server startup. Idempotent — overwrites if exists.
 */
export async function setupAgent(): Promise<void> {
  // Tool: search mutations in a session's short-term memory
  await kibanaRequest("POST", "/api/agent_builder/tools", {
    id: TOOL_SEARCH_MUTATIONS,
    type: "esql",
    description:
      "Search for recorded virtual mutations across rehearsal sessions by function name. Returns function names, arguments, and mock results.",
    configuration: {
      query: `FROM rehearse-session-* | WHERE type == "mutation" AND function_name == ?function_name | SORT timestamp DESC | LIMIT 100`,
      params: {
        function_name: {
          type: "string",
          description: "The function name to search mutations for",
        },
      },
    },
  });

  // Tool: look up output schema from long-term memory
  await kibanaRequest("POST", "/api/agent_builder/tools", {
    id: TOOL_GET_SCHEMA,
    type: "esql",
    description:
      "Look up a known output schema for a function by its source code hash. Returns the JSON Schema of the expected return value.",
    configuration: {
      query: `FROM ${LONG_TERM_INDEX} | WHERE source_code_hash == ?hash | LIMIT 1`,
      params: {
        hash: {
          type: "string",
          description: "SHA-256 hash of the function source code",
        },
      },
    },
  });

  // Agent: the mock generator / query patcher
  await kibanaRequest("POST", "/api/agent_builder/agents", {
    id: AGENT_ID,
    name: "Rehearse Mock Agent",
    description:
      "Generates plausible mock return values for intercepted function calls and patches query results to reflect virtual mutations.",
    configuration: {
      instructions: `You are a function output simulator for the Rehearse system.

Your job is to help AI agents rehearse workflows involving irreversible side effects (sending emails, API calls, database writes, etc.) by providing realistic mock outputs.

You have two main tasks:

1. MOCK GENERATION: When given a function's name, source code, docstring, and arguments, generate a plausible return value. Use the get_schema tool to check if a known output schema exists for this function. If it does, generate values conforming to that schema. If not, infer the shape from the source code and docstring.

2. QUERY PATCHING: When given a query function's real result and a list of virtual mutations, determine how those mutations would affect the query result. Use the search_mutations tool to find relevant mutations. Return the real result modified to reflect the virtual mutations.

CRITICAL RULES:
- Always respond with ONLY valid JSON. No explanation, no markdown, no code fences, no backticks.
- Do NOT wrap your response in \`\`\`json or any other formatting. Just output the raw JSON value directly.`,
      tools: [
        {
          tool_ids: [
            TOOL_SEARCH_MUTATIONS,
            TOOL_GET_SCHEMA,
            "platform.core.search",
          ],
        },
      ],
    },
  });

  console.log("Rehearse agent and tools registered in Agent Builder");
}

export async function generateMockResult(
  sessionId: string,
  functionName: string,
  args: Record<string, unknown>,
  sourceCode: string,
  docstring: string | null
): Promise<unknown> {
  const sourceHash = hashSource(sourceCode);
  const schemaRecord = await getSchema(sourceHash);
  const recentMutations = await getMutations(sessionId);

  const prompt = buildMockPrompt(
    functionName,
    args,
    sourceCode,
    docstring,
    schemaRecord?.schema,
    recentMutations
  );

  const response = (await kibanaRequest(
    "POST",
    "/api/agent_builder/converse",
    {
      input: prompt,
      agent_id: AGENT_ID,
    }
  )) as any;

  const content = response?.response?.message ?? response?.output ?? response?.message ?? "";
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

export async function patchQueryResult(
  sessionId: string,
  functionName: string,
  args: Record<string, unknown>,
  sourceCode: string,
  docstring: string | null,
  realResult: unknown
): Promise<unknown> {
  const mutations = await getMutations(sessionId);

  if (mutations.length === 0) {
    return realResult;
  }

  const prompt = buildPatchPrompt(
    functionName,
    args,
    sourceCode,
    docstring,
    realResult,
    mutations
  );

  const response = (await kibanaRequest(
    "POST",
    "/api/agent_builder/converse",
    {
      input: prompt,
      agent_id: AGENT_ID,
    }
  )) as any;

  const content = response?.response?.message ?? response?.output ?? response?.message ?? "";
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

export async function extractSchema(actualOutput: unknown): Promise<unknown> {
  const prompt = `Extract the JSON Schema (structure, types, field names — no actual values) from this function output:\n${JSON.stringify(actualOutput, null, 2)}`;

  const response = (await kibanaRequest(
    "POST",
    "/api/agent_builder/converse",
    {
      input: prompt,
      agent_id: AGENT_ID,
    }
  )) as any;

  const content = response?.response?.message ?? response?.output ?? response?.message ?? "";
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function buildMockPrompt(
  functionName: string,
  args: Record<string, unknown>,
  sourceCode: string,
  docstring: string | null,
  schema: unknown | undefined,
  recentMutations: MutationRecord[]
): string {
  let prompt = `TASK: Generate a plausible return value for this function call.\n\n`;
  prompt += `Function: ${functionName}\n`;
  prompt += `Arguments: ${JSON.stringify(args)}\n`;
  prompt += `Source code:\n${sourceCode}\n`;
  if (docstring) prompt += `Docstring: ${docstring}\n`;
  if (schema)
    prompt += `\nKnown output schema: ${JSON.stringify(schema, null, 2)}\n`;
  if (recentMutations.length > 0) {
    prompt += `\nRecent mutations in this session (for context):\n`;
    for (const m of recentMutations.slice(-10)) {
      prompt += `- ${m.function_name}(${JSON.stringify(m.args)}) → ${JSON.stringify(m.mock_result)}\n`;
    }
  }
  prompt += `\nRespond with ONLY the JSON return value.`;
  return prompt;
}

function buildPatchPrompt(
  functionName: string,
  args: Record<string, unknown>,
  sourceCode: string,
  docstring: string | null,
  realResult: unknown,
  mutations: MutationRecord[]
): string {
  let prompt = `TASK: Patch this query result to reflect virtual mutations.\n\n`;
  prompt += `Query function: ${functionName}\n`;
  prompt += `Arguments: ${JSON.stringify(args)}\n`;
  prompt += `Source code:\n${sourceCode}\n`;
  if (docstring) prompt += `Docstring: ${docstring}\n`;
  prompt += `\nReal result:\n${JSON.stringify(realResult, null, 2)}\n`;
  prompt += `\nVirtual mutations to reflect:\n`;
  for (const m of mutations) {
    prompt += `- ${m.function_name}(${JSON.stringify(m.args)}) → ${JSON.stringify(m.mock_result)}\n`;
  }
  prompt += `\nRespond with ONLY the patched JSON result.`;
  return prompt;
}

export function hashSource(sourceCode: string): string {
  return crypto.createHash("sha256").update(sourceCode).digest("hex");
}
