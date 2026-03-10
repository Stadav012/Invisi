/**
 * Sensor simulator — publishes fake position-aware telemetry to MQTT for dev testing.
 *
 * Usage: bun run simulate
 *
 * Requires an active fermenting batch in Supabase.
 */

import mqtt from "mqtt";
import { createClient } from "@supabase/supabase-js";
import logging from "./logging";

const logger = logging("simulator");

const PUBLISH_INTERVAL_MS = 10000;

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
);

function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(max, val));
}

// Simulated sensor state — center runs hotter than edges
let tempCenter = 47;
let tempLeft = 43;
let tempRight = 42;
let gasLeft = 2200;
let gasRight = 2000;

function nextReading() {
    // Center drifts higher (exothermic core), edges drift lower
    tempCenter = clamp(tempCenter + (Math.random() - 0.45) * 1.5, 40, 55);
    tempLeft = clamp(tempLeft + (Math.random() - 0.5) * 1.2, 35, 50);
    tempRight = clamp(tempRight + (Math.random() - 0.5) * 1.2, 35, 50);
    gasLeft = clamp(gasLeft + (Math.random() - 0.5) * 150, 800, 4000);
    gasRight = clamp(gasRight + (Math.random() - 0.5) * 150, 800, 4000);

    return {
        temp_center: parseFloat(tempCenter.toFixed(1)),
        temp_left: parseFloat(tempLeft.toFixed(1)),
        temp_right: parseFloat(tempRight.toFixed(1)),
        gas_left: Math.round(gasLeft),
        gas_right: Math.round(gasRight),
    };
}

async function main() {
    const { data: batch, error } = await supabase
        .from("batches")
        .select("id, batch_number")
        .eq("status", "fermenting")
        .limit(1)
        .single();

    if (error || !batch) {
        logger.error("No fermenting batch found. Create one first via the UI.");
        process.exit(1);
    }

    logger.info(`Simulating sensors for ${batch.batch_number} (${batch.id})`);

    const client = mqtt.connect(process.env.MQTT_BROKER_URL!, {
        username: process.env.MQTT_USERNAME!,
        password: process.env.MQTT_PASSWORD!,
        protocol: "mqtts",
        rejectUnauthorized: true,
    });

    client.on("connect", () => {
        logger.info("Connected to MQTT broker");

        const topic = `invisi/pod/${batch.id}/telemetry`;

        setInterval(() => {
            const reading = nextReading();
            const payload = JSON.stringify({
                batch_id: batch.id,
                ...reading,
                recorded_at: new Date().toISOString(),
            });

            client.publish(topic, payload, { qos: 1 }, (err) => {
                if (err) {
                    logger.error(`Publish failed: ${err.message}`);
                    return;
                }
                logger.info(
                    `Published: tc=${reading.temp_center} tl=${reading.temp_left} ` +
                    `tr=${reading.temp_right} gl=${reading.gas_left} gr=${reading.gas_right}`
                );
            });
        }, PUBLISH_INTERVAL_MS);
    });

    client.on("error", (err) => {
        logger.error(`MQTT error: ${err.message}`);
    });
}

main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});
