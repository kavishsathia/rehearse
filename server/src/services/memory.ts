import {
  getClient,
  SHORT_TERM_INDEX_PREFIX,
  LONG_TERM_INDEX,
} from "./elasticsearch";
import {
  MutationRecord,
  QueryRecord,
  InterceptionRecord,
  SchemaRecord,
} from "../types";

export async function storeMutation(
  sessionId: string,
  record: MutationRecord
): Promise<void> {
  const es = getClient();
  await es.index({
    index: `${SHORT_TERM_INDEX_PREFIX}${sessionId}`,
    document: record,
    refresh: true,
  });
}

export async function storeQuery(
  sessionId: string,
  record: QueryRecord
): Promise<void> {
  const es = getClient();
  await es.index({
    index: `${SHORT_TERM_INDEX_PREFIX}${sessionId}`,
    document: record,
    refresh: true,
  });
}

export async function getMutations(
  sessionId: string
): Promise<MutationRecord[]> {
  const es = getClient();
  const result = await es.search<MutationRecord>({
    index: `${SHORT_TERM_INDEX_PREFIX}${sessionId}`,
    query: { term: { type: "mutation" } },
    sort: [{ timestamp: "asc" }],
    size: 10000,
  });
  return result.hits.hits.map((hit) => hit._source!);
}

export async function getSessionHistory(
  sessionId: string
): Promise<InterceptionRecord[]> {
  const es = getClient();
  const result = await es.search<InterceptionRecord>({
    index: `${SHORT_TERM_INDEX_PREFIX}${sessionId}`,
    query: { match_all: {} },
    sort: [{ timestamp: "asc" }],
    size: 10000,
  });
  return result.hits.hits.map((hit) => hit._source!);
}

export async function getSchema(
  sourceCodeHash: string
): Promise<SchemaRecord | null> {
  const es = getClient();
  const result = await es.search<SchemaRecord>({
    index: LONG_TERM_INDEX,
    query: { term: { source_code_hash: sourceCodeHash } },
    size: 1,
  });
  if (result.hits.hits.length === 0) return null;
  return result.hits.hits[0]._source!;
}

export async function storeSchema(record: SchemaRecord): Promise<void> {
  const es = getClient();
  // Upsert by source_code_hash
  const existing = await es.search({
    index: LONG_TERM_INDEX,
    query: { term: { source_code_hash: record.source_code_hash } },
    size: 1,
  });

  if (existing.hits.hits.length > 0) {
    await es.update({
      index: LONG_TERM_INDEX,
      id: existing.hits.hits[0]._id!,
      doc: record,
      refresh: true,
    });
  } else {
    await es.index({
      index: LONG_TERM_INDEX,
      document: record,
      refresh: true,
    });
  }
}
