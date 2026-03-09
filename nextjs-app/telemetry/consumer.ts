
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

export async function startConsumer() {
    await ensureConsumerGroup();

    logger.info("Consumer started, polling Redis Stream...");

    // Periodic flush
    setInterval(flushBuffer, FLUSH_INTERVAL_MS);

    // Continuous polling loop
    const loop = async () => {
        // Recover any pending unacknowledged messages first
        let recovering = true;
        while (true) {
            try {
                const response = await redis.xreadgroup(
                    CONSUMER_GROUP,
                    CONSUMER_NAME,
                    REDIS_STREAM_KEY,
                    recovering ? "0" : ">",
                    { count: BATCH_SIZE }
                );

                if (!response || response.length === 0 || (response[0] as any)[1].length === 0) {
                    recovering = false; // Move on to new messages
                } else {
                    for (const stream of response) {
                        const streamEntries = (stream as [string, any[]])[1];
                        for (const entry of streamEntries) {
                            const id = entry[0] as string;
                            const fieldArray = entry[1] as any[];

                            const data: Record<string, string> = {};
                            for (let i = 0; i < fieldArray.length; i += 2) {
                                data[fieldArray[i]] = String(fieldArray[i + 1]);
                            }

                            buffer.push({
                                id,
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
                    }

                    if (buffer.length >= BATCH_SIZE) {
                        await flushBuffer();
                    }
                }
            } catch (err) {
                logger.error(`Poll error: ${err}`);
            }

            // Small delay to avoid hammering Upstash
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    };

    loop();
}
