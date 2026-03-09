/**
 * Sensor simulator — publishes fake telemetry to MQTT for dev testing.
 *
 * Usage: npm run simulate
 *
 * Requires an active fermenting batch in Supabase. If none exists,
 * connects but skips publishing and logs a warning.
 */

import mqtt from "mqtt";
import { createClient } from "@supabase/supabase-js";
import logging from "./logging";

const logger = logging("simulator");

const PUBLISH_INTERVAL_MS = 5000;

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
);

function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(max, val));
}

// Sensor state that drifts realistically
let temp = 45;
let humidity = 85;
let ph = 4.5;
let co2 = 2500;

function nextReading() {
    temp = clamp(temp + (Math.random() - 0.48) * 1.5, 35, 55);
    humidity = clamp(humidity + (Math.random() - 0.5) * 3, 60, 98);
    ph = clamp(ph + (Math.random() - 0.52) * 0.2, 3.5, 6.0);
    co2 = clamp(co2 + (Math.random() - 0.5) * 200, 1000, 5000);

    return {
        temperature: parseFloat(temp.toFixed(1)),
        humidity: parseFloat(humidity.toFixed(1)),
        ph: parseFloat(ph.toFixed(2)),
        co2: Math.round(co2),
    };
}

async function main() {
    // Find an active fermenting batch
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
                    `Published: temp=${reading.temperature} hum=${reading.humidity} ` +
                    `ph=${reading.ph} co2=${reading.co2}`
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
