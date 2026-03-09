
import { Redis } from "@upstash/redis";
import { createClient } from "@supabase/supabase-js";
import logging from "./logging";

const logger = logging("consumer");

const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || "sensor-readings";
const CONSUMER_GROUP = "supabase-writers";
const CONSUMER_NAME = "writer-1";
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5000;

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_URL!,
    token: process.env.UPSTASH_REDIS_TOKEN!,
});

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
);

interface ReadingRow {
    batch_id: string;
    temperature: number | null;
    humidity: number | null;
    ph: number | null;
    co2: number | null;
    recorded_at: string;
}

let buffer: { id: string; data: ReadingRow }[] = [];

async function ensureConsumerGroup() {
    try {
        await redis.xgroup(REDIS_STREAM_KEY, {
            type: "CREATE",
            group: CONSUMER_GROUP,
            id: "0",
            options: { MKSTREAM: true },
        });
        logger.info(`Created consumer group "${CONSUMER_GROUP}"`);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Group already exists — safe to ignore
        if (!msg.includes("BUSYGROUP")) throw err;
    }
}

async function flushBuffer() {
    if (buffer.length === 0) return;

    const toFlush = buffer.splice(0);
    const rows = toFlush.map((entry) => entry.data);

    const { error } = await supabase.from("sensor_readings").insert(rows);

    if (error) {
        logger.error(`Supabase insert failed: ${error.message}`);
        // Push back into buffer for retry
        buffer.unshift(...toFlush);
        return;
    }

    // Acknowledge successfully written entries
    const ids = toFlush.map((entry) => entry.id);
    await redis.xack(REDIS_STREAM_KEY, CONSUMER_GROUP, ids);

    logger.info(`Flushed ${rows.length} readings to Supabase`);
}

function parseNumber(val: string | undefined): number | null {
    if (!val || val === "") return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
}

async function poll() {
    try {
        const response = await redis.xreadgroup(
            CONSUMER_GROUP,
            CONSUMER_NAME,
            REDIS_STREAM_KEY,
            ">",
            { count: BATCH_SIZE }
        );

        if (!response || response.length === 0) return;

        for (const entry of response) {
            const fields = entry as { id: string;[key: string]: string };
            const id = fields.id || (entry as unknown as [string, Record<string, string>])[0];

            // Handle both array-style [id, {fields}] and object-style responses
            let data: Record<string, string>;
            if (Array.isArray(entry)) {
                data = entry[1] as Record<string, string>;
            } else {
                data = fields;
            }

            buffer.push({
                id: typeof id === "string" ? id : String(id),
                data: {
                    batch_id: data.batch_id,
                    temperature: parseNumber(data.temperature),
                    humidity: parseNumber(data.humidity),
                    ph: parseNumber(data.ph),
                    co2: parseNumber(data.co2),
                    recorded_at: data.recorded_at || new Date().toISOString(),
                },
            });
        }

        if (buffer.length >= BATCH_SIZE) {
            await flushBuffer();
        }
    } catch (err) {
        logger.error(`Poll error: ${err}`);
    }
}

export async function startConsumer() {
    await ensureConsumerGroup();

    logger.info("Consumer started, polling Redis Stream...");

    // Periodic flush
    setInterval(flushBuffer, FLUSH_INTERVAL_MS);

    // Continuous polling loop
    const loop = async () => {
        while (true) {
            await poll();
            // Small delay to avoid hammering Upstash
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    };

    loop();
}
