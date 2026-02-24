import app from "./app";
import { ensureLongTermIndex } from "./services/elasticsearch";
import { setupAgent } from "./services/agent";

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await ensureLongTermIndex();
    await setupAgent();
    app.listen(PORT, () => {
      console.log(`Rehearse server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();
