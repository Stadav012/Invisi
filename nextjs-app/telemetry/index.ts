import { startBridge } from "./bridge";
import { startConsumer, getCurrentState, getLastSyncTimestamp } from "./consumer";
import logging from "./logging";
import { createServer } from "http";

const logger = logging("main");
const PORT = parseInt(process.env.PORT || "10000", 10);

const startedAt = new Date().toISOString();

async function main() {
    logger.info("Starting Invisi telemetry pipeline (edge mode)...");

    // Health check server
    const server = createServer((req, res) => {
        if (req.url === "/health" || req.url === "/") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                status: "ok",
                service: "invisi-telemetry",
                mode: "edge",
                fsm_state: getCurrentState(),
                last_sync: new Date(getLastSyncTimestamp() * 1000).toISOString(),
                uptime: process.uptime(),
                started_at: startedAt,
            }));
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    server.listen(PORT, () => {
        logger.info(`Health check server on port ${PORT}`);
    });

    // Start pipeline
    startBridge();
    await startConsumer();
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
