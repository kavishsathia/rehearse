import { Router, Request, Response } from "express";
import { storeSchema } from "../services/memory";
import { extractSchema } from "../services/agent";
import { LearnRequest, SchemaRecord } from "../types";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  try {
    const { source_code_hash, function_name, actual_output } =
      req.body as LearnRequest;

    // Extract schema from actual output using the Elastic agent
    const schema = await extractSchema(actual_output);

    const record: SchemaRecord = {
      source_code_hash,
      function_name,
      schema,
      last_updated: new Date().toISOString(),
    };

    await storeSchema(record);

    res.json({ source_code_hash, schema });
  } catch (error) {
    console.error("Failed to learn schema:", error);
    res.status(500).json({ error: "Failed to learn schema" });
  }
});

export default router;
