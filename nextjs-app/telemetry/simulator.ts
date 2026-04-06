/**
 * Sensor simulator — publishes fake telemetry to local Mosquitto for dev testing.
 *
 * Usage: bun run simulate
 *
 * Requires an active fermenting batch in Supabase.
 */

import mqtt from "mqtt";
import { createClient } from "@supabase/supabase-js";
import logging from "./logging";

const logger = logging("simulator");

const PUBLISH_INTERVAL_MS = 30000;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(max, val));
}

// Simulated sensor state — center runs hotter than edges
let tCore = 47;
let tLeft = 43;
let tRight = 42;
let gasLeft = 2200;
let gasRight = 2000;

function nextReading() {
    tCore = clamp(tCore + (Math.random() - 0.45) * 1.5, 40, 55);
    tLeft = clamp(tLeft + (Math.random() - 0.5) * 1.2, 35, 50);
    tRight = clamp(tRight + (Math.random() - 0.5) * 1.2, 35, 50);
    gasLeft = clamp(gasLeft + (Math.random() - 0.5) * 150, 800, 4000);
    gasRight = clamp(gasRight + (Math.random() - 0.5) * 150, 800, 4000);

    return {
        t_core: parseFloat(tCore.toFixed(1)),
        t_left: parseFloat(tLeft.toFixed(1)),
        t_right: parseFloat(tRight.toFixed(1)),
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

    const podId = process.env.POD_ID || "pod_01";
    logger.info(`Simulating sensors for ${batch.batch_number} (${batch.id}) as ${podId}`);

    const client = mqtt.connect(process.env.MQTT_BROKER_URL || "mqtt://localhost:1883");

    client.on("connect", () => {
        logger.info("Connected to local MQTT broker");

        const topic = `invisi/fermentation/${podId}/sensors`;

        setInterval(() => {
            const reading = nextReading();
            const payload = JSON.stringify({
                ts: Math.floor(Date.now() / 1000),
                batch_id: batch.id,
                ...reading,
            });

            client.publish(topic, payload, { qos: 1 }, (err) => {
                if (err) {
                    logger.error(`Publish failed: ${err.message}`);
                    return;
                }
                logger.info(
                    `Published: tc=${reading.t_core} tl=${reading.t_left} ` +
                    `tr=${reading.t_right} gl=${reading.gas_left} gr=${reading.gas_right}`
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
