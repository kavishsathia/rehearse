import { Router, Request, Response } from "express";
import { storeQuery } from "../services/memory";
import { patchQueryResult } from "../services/agent";
import { QueryRequest, QueryRecord } from "../types";

const router = Router();

router.post("/:id/queries", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const sessionId = req.params.id;
    const { function_name, args, source_code, docstring, real_result } =
      req.body as QueryRequest;

    // Patch the real result based on virtual mutations
    const patchedResult = await patchQueryResult(
      sessionId,
      function_name,
      args,
      source_code,
      docstring,
      real_result
    );

    // Store the query in short-term memory
    const record: QueryRecord = {
      timestamp: new Date().toISOString(),
      type: "query",
      function_name,
      args,
      source_code,
      docstring,
      real_result,
      patched_result: patchedResult,
    };

    await storeQuery(sessionId, record);

    res.json({ patched_result: patchedResult });
  } catch (error) {
    console.error("Failed to process query:", error);
    res.status(500).json({ error: "Failed to process query" });
  }
});

export default router;
