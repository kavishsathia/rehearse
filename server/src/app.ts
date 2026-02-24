import express from "express";
import sessionsRouter from "./routes/sessions";
import mutationsRouter from "./routes/mutations";
import queriesRouter from "./routes/queries";
import learnRouter from "./routes/learn";

const app = express();

app.use(express.json({ limit: "10mb" }));

// Auth middleware — validate REHEARSE_API_KEY
app.use((req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  const expectedKey = process.env.REHEARSE_API_KEY;

  if (expectedKey && apiKey !== expectedKey) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  next();
});

// Routes
app.use("/sessions", sessionsRouter);
app.use("/sessions", mutationsRouter);
app.use("/sessions", queriesRouter);
app.use("/learn", learnRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
