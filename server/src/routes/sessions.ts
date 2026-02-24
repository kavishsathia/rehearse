import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { createSessionIndex } from "../services/elasticsearch";
import { getSessionHistory } from "../services/memory";
import { SessionInfo } from "../types";

const router = Router();

// In-memory session registry (could be moved to ES in production)
const sessions = new Map<string, SessionInfo>();

router.post("/", async (req: Request, res: Response) => {
  try {
    const sessionId = uuidv4();
    const session: SessionInfo = {
      session_id: sessionId,
      created_at: new Date().toISOString(),
      status: "active",
    };

    await createSessionIndex(sessionId);
    sessions.set(sessionId, session);

    res.json(session);
  } catch (error) {
    console.error("Failed to create session:", error);
    res.status(500).json({ error: "Failed to create session" });
  }
});

router.get("/:id/rehearsal", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const id = req.params.id;
    const session = sessions.get(id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const history = await getSessionHistory(id);
    res.json({
      session_id: id,
      created_at: session.created_at,
      status: session.status,
      trace: history,
    });
  } catch (error) {
    console.error("Failed to get rehearsal:", error);
    res.status(500).json({ error: "Failed to get rehearsal" });
  }
});

router.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const id = req.params.id;
    const session = sessions.get(id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    session.status = "closed";
    res.json({ session_id: id, status: "closed" });
  } catch (error) {
    console.error("Failed to close session:", error);
    res.status(500).json({ error: "Failed to close session" });
  }
});

export default router;
