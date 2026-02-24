import { Client } from "@elastic/elasticsearch";

const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL || "http://localhost:9200";
const ELASTICSEARCH_API_KEY = process.env.ELASTICSEARCH_API_KEY;

let client: Client;

export function getClient(): Client {
  if (!client) {
    client = new Client({
      node: ELASTICSEARCH_URL,
      ...(ELASTICSEARCH_API_KEY && {
        auth: { apiKey: ELASTICSEARCH_API_KEY },
      }),
    });
  }
  return client;
}

export const SHORT_TERM_INDEX_PREFIX = "rehearse-session-";
export const LONG_TERM_INDEX = "rehearse-schemas";

export async function ensureLongTermIndex(): Promise<void> {
  const es = getClient();
  const exists = await es.indices.exists({ index: LONG_TERM_INDEX });
  if (!exists) {
    await es.indices.create({
      index: LONG_TERM_INDEX,
      mappings: {
        properties: {
          source_code_hash: { type: "keyword" },
          function_name: { type: "keyword" },
          schema: { type: "object", enabled: false },
          last_updated: { type: "date" },
        },
      },
    });
  }
}

export async function createSessionIndex(sessionId: string): Promise<void> {
  const es = getClient();
  await es.indices.create({
    index: `${SHORT_TERM_INDEX_PREFIX}${sessionId}`,
    mappings: {
      properties: {
        timestamp: { type: "date" },
        type: { type: "keyword" },
        function_name: { type: "keyword" },
        args: { type: "object", enabled: false },
        source_code: { type: "text" },
        docstring: { type: "text" },
        real_result: { type: "object", enabled: false },
        mock_result: { type: "object", enabled: false },
        patched_result: { type: "object", enabled: false },
      },
    },
  });
}

export async function deleteSessionIndex(sessionId: string): Promise<void> {
  const es = getClient();
  const index = `${SHORT_TERM_INDEX_PREFIX}${sessionId}`;
  const exists = await es.indices.exists({ index });
  if (exists) {
    await es.indices.delete({ index });
  }
}
