import { Router, Request, Response } from "express";
import { storeMutation } from "../services/memory";
import { generateMockResult } from "../services/agent";
import { MutationRequest, MutationRecord } from "../types";

const router = Router();

router.post("/:id/mutations", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const sessionId = req.params.id;
    const { function_name, args, source_code, docstring } =
      req.body as MutationRequest;

    // Generate a mock result using the Elastic agent
    const mockResult = await generateMockResult(
      sessionId,
      function_name,
      args,
      source_code,
      docstring
    );

    // Store the mutation in short-term memory
    const record: MutationRecord = {
      timestamp: new Date().toISOString(),
      type: "mutation",
      function_name,
      args,
      source_code,
      docstring,
      mock_result: mockResult,
    };

    await storeMutation(sessionId, record);

    res.json({ mock_result: mockResult });
  } catch (error) {
    console.error("Failed to process mutation:", error);
    res.status(500).json({ error: "Failed to process mutation" });
  }
});

export default router;
