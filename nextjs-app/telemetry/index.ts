import { startBridge } from "./bridge";
import { startConsumer } from "./consumer";
import logging from "./logging";
import { createServer } from "http";

const logger = logging("main");
const PORT = parseInt(process.env.PORT || "10000", 10);

const startedAt = new Date().toISOString();

async function main() {
    logger.info("Starting Invisi telemetry pipeline...");

    startBridge();
    await startConsumer();

    // Health check server — keeps Render free web service alive
    const server = createServer((req, res) => {
        if (req.url === "/health" || req.url === "/") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                status: "ok",
                service: "invisi-telemetry",
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
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
