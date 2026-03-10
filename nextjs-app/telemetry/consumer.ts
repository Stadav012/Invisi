import { Redis } from "@upstash/redis";
import { createClient } from "@supabase/supabase-js";
import logging from "./logging";

const logger = logging("consumer");

const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || "sensor-readings";
const CONSUMER_GROUP = "supabase-writers";
const CONSUMER_NAME = "writer-1";
const POLL_INTERVAL_MS = 10000; // Check Redis every 10 seconds

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_URL!,
    token: process.env.UPSTASH_REDIS_TOKEN!,
});

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
);

const SENSOR_FIELDS = [
    "temp_center", "temp_left", "temp_right",
    "gas_left", "gas_right",
    "temperature", "humidity", "ph", "co2"
] as const;

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
        if (!msg.includes("BUSYGROUP")) throw err;
    }
}

function parseNumber(val: string | undefined): number | null {
    if (!val || val === "") return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
}

interface ParsedMessage {
    id: string;
    data: Record<string, any>;
}

function parseRedisResponse(response: any): ParsedMessage[] {
    const results: ParsedMessage[] = [];
    if (!response || response.length === 0 || (response[0] as any)[1].length === 0) return results;

    for (const stream of response) {
        const streamEntries = (stream as [string, any[]])[1];
        for (const entry of streamEntries) {
            const id = entry[0] as string;
            const fieldArray = entry[1] as any[];

            const raw: Record<string, string> = {};
            for (let i = 0; i < fieldArray.length; i += 2) {
                raw[fieldArray[i]] = String(fieldArray[i + 1]);
            }

            const data: Record<string, any> = {
                batch_id: raw.batch_id,
                recorded_at: raw.recorded_at || new Date().toISOString(),
            };

            for (const field of SENSOR_FIELDS) {
                data[field] = parseNumber(raw[field]);
            }

            results.push({ id, data });
        }
    }
    return results;
}

async function deleteFromRedis(ids: string[]) {
    await redis.xack(REDIS_STREAM_KEY, CONSUMER_GROUP, ids);
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        if (chunk.length > 0) {
            await (redis.xdel as any)(REDIS_STREAM_KEY, ...chunk);
        }
    }
}

async function processMessages() {
    try {
        // Read pending and new messages
        const [pendingRes, newRes] = await Promise.all([
            redis.xreadgroup(CONSUMER_GROUP, CONSUMER_NAME, REDIS_STREAM_KEY, "0", { count: 100 }),
            redis.xreadgroup(CONSUMER_GROUP, CONSUMER_NAME, REDIS_STREAM_KEY, ">", { count: 100 })
        ]);

        const allMessages = [...parseRedisResponse(pendingRes), ...parseRedisResponse(newRes)];
        if (allMessages.length === 0) return;

        // Direct pass-through: write each reading individually to Supabase
        for (const msg of allMessages) {
            if (!msg.data.batch_id) {
                await deleteFromRedis([msg.id]);
                continue;
            }

            const { error } = await supabase.from("sensor_readings").insert(msg.data);

            if (error) {
                logger.error(`Insert failed for ${msg.data.batch_id}: ${error.message}`);
            } else {
                logger.info(
                    `Stored reading for batch ${msg.data.batch_id}: ` +
                    `tc=${msg.data.temp_center} tl=${msg.data.temp_left} tr=${msg.data.temp_right} ` +
                    `gl=${msg.data.gas_left} gr=${msg.data.gas_right}`
                );
                await deleteFromRedis([msg.id]);
            }
        }
    } catch (err) {
        logger.error(`Consumer error: ${err}`);
    }
}

export async function startConsumer() {
    await ensureConsumerGroup();
    logger.info("Direct pass-through consumer started...");

    await processMessages();
    setInterval(processMessages, POLL_INTERVAL_MS);
}
