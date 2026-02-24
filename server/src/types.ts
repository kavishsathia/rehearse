export interface MutationRecord {
  timestamp: string;
  type: "mutation";
  function_name: string;
  args: Record<string, unknown>;
  source_code: string;
  docstring: string | null;
  mock_result: unknown;
}

export interface QueryRecord {
  timestamp: string;
  type: "query";
  function_name: string;
  args: Record<string, unknown>;
  source_code: string;
  docstring: string | null;
  real_result: unknown;
  patched_result: unknown;
}

export type InterceptionRecord = MutationRecord | QueryRecord;

export interface SessionInfo {
  session_id: string;
  created_at: string;
  status: "active" | "closed";
}

export interface SchemaRecord {
  source_code_hash: string;
  function_name: string;
  schema: unknown;
  last_updated: string;
}

export interface MutationRequest {
  function_name: string;
  args: Record<string, unknown>;
  source_code: string;
  docstring: string | null;
}

export interface QueryRequest {
  function_name: string;
  args: Record<string, unknown>;
  source_code: string;
  docstring: string | null;
  real_result: unknown;
}

export interface LearnRequest {
  source_code_hash: string;
  function_name: string;
  actual_output: unknown;
}
