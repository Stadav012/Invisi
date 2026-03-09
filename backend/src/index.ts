import "dotenv/config";
import { startBridge } from "./bridge";
import { startConsumer } from "./consumer";
import logging from "./logging";

const logger = logging("main");

async function main() {
    logger.info("Starting Invisi telemetry pipeline...");

    startBridge();
    await startConsumer();
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
