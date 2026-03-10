import { Redis } from "@upstash/redis";
import { createClient } from "@supabase/supabase-js";
import logging from "./logging";

const logger = logging("consumer");

const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || "sensor-readings";
const CONSUMER_GROUP = "supabase-writers";
const CONSUMER_NAME = "writer-1";
const CHECK_INTERVAL_MS = 30000;

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_URL!,
    token: process.env.UPSTASH_REDIS_TOKEN!,
});

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
);

// All numeric sensor fields we track per-position
const SENSOR_FIELDS = [
    "temp_center", "temp_left", "temp_right",
    "gas_left", "gas_right",
    // Legacy fields kept for backward compat
    "temperature", "humidity", "ph", "co2"
] as const;

type SensorField = typeof SENSOR_FIELDS[number];

interface ReadingRow {
    batch_id: string;
    recorded_at: string;
    [key: string]: string | number | null;
}

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

function parseRedisResponse(response: any): { id: string; data: ReadingRow }[] {
    const results: { id: string; data: ReadingRow }[] = [];
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

            const data: ReadingRow = {
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

async function performAggregation() {
    try {
        const { data: batches } = await supabase
            .from("batches")
            .select("id, recording_interval_mins")
            .eq("status", "fermenting");

        if (!batches || batches.length === 0) return;

        const batchMap = new Map(batches.map(b => [b.id, b]));

        const lastReadingsMap = new Map<string, number>();
        await Promise.all(batches.map(async b => {
            const { data } = await supabase
                .from("sensor_readings")
                .select("recorded_at")
                .eq("batch_id", b.id)
                .order("recorded_at", { ascending: false })
                .limit(1)
                .single();

            lastReadingsMap.set(b.id, data ? new Date(data.recorded_at).getTime() : 0);
        }));

        const [pendingRes, newRes] = await Promise.all([
            redis.xreadgroup(CONSUMER_GROUP, CONSUMER_NAME, REDIS_STREAM_KEY, "0", { count: 5000 }),
            redis.xreadgroup(CONSUMER_GROUP, CONSUMER_NAME, REDIS_STREAM_KEY, ">", { count: 5000 })
        ]);

        const allMessages = [...parseRedisResponse(pendingRes), ...parseRedisResponse(newRes)];
        if (allMessages.length === 0) return;

        const messagesByBatch = new Map<string, typeof allMessages>();
        for (const msg of allMessages) {
            if (!messagesByBatch.has(msg.data.batch_id)) messagesByBatch.set(msg.data.batch_id, []);
            messagesByBatch.get(msg.data.batch_id)!.push(msg);
        }

        for (const [batch_id, msgs] of messagesByBatch.entries()) {
            const batchInfo = batchMap.get(batch_id);

            if (!batchInfo) {
                await deleteFromRedis(msgs.map(m => m.id));
                continue;
            }

            const intervalMins = batchInfo.recording_interval_mins || 1;
            const intervalMs = intervalMins * 60 * 1000;
            const lastRecordedAt = lastReadingsMap.get(batch_id) || 0;
            const now = Date.now();

            if (now - lastRecordedAt >= intervalMs) {
                // Aggregate each sensor field independently
                const sums: Record<string, number> = {};
                const counts: Record<string, number> = {};

                for (const field of SENSOR_FIELDS) {
                    sums[field] = 0;
                    counts[field] = 0;
                }

                for (const msg of msgs) {
                    for (const field of SENSOR_FIELDS) {
                        const val = msg.data[field];
                        if (val !== null && val !== undefined && typeof val === "number") {
                            sums[field] += val;
                            counts[field]++;
                        }
                    }
                }

                // Check if we have any data at all
                const hasAnyData = SENSOR_FIELDS.some(f => counts[f] > 0);
                if (!hasAnyData) {
                    await deleteFromRedis(msgs.map(m => m.id));
                    continue;
                }

                const aggRow: Record<string, any> = {
                    batch_id,
                    recorded_at: new Date().toISOString(),
                };

                for (const field of SENSOR_FIELDS) {
                    if (counts[field] > 0) {
                        const avg = sums[field] / counts[field];
                        // Use 2 decimal places for temperatures, round integers for gas
                        aggRow[field] = field.startsWith("gas_")
                            ? Math.round(avg)
                            : parseFloat(avg.toFixed(2));
                    } else {
                        aggRow[field] = null;
                    }
                }

                const { error } = await supabase.from("sensor_readings").insert(aggRow);

                if (error) {
                    logger.error(`Supabase insert failed for batch ${batch_id}: ${error.message}`);
                } else {
                    logger.info(`Aggregated ${msgs.length} readings for batch ${batch_id}`);
                    await deleteFromRedis(msgs.map(m => m.id));
                }
            }
        }
    } catch (err) {
        logger.error(`Aggregation error: ${err}`);
    }
}

export async function startConsumer() {
    await ensureConsumerGroup();

    logger.info("Aggregating Consumer started...");

    await performAggregation();
    setInterval(performAggregation, CHECK_INTERVAL_MS);
}
