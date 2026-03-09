import { Redis } from "@upstash/redis";
import { createClient } from "@supabase/supabase-js";
import logging from "./logging";

const logger = logging("consumer");

const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || "sensor-readings";
const CONSUMER_GROUP = "supabase-writers";
const CONSUMER_NAME = "writer-1";
// Check every 30 seconds for any batches that need aggregating
const CHECK_INTERVAL_MS = 30000;

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

            const data: Record<string, string> = {};
            for (let i = 0; i < fieldArray.length; i += 2) {
                data[fieldArray[i]] = String(fieldArray[i + 1]);
            }

            results.push({
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
    return results;
}

async function performAggregation() {
    try {
        // 1. Fetch active batches and their intervals
        const { data: batches } = await supabase
            .from("batches")
            .select("id, recording_interval_mins")
            .eq("status", "fermenting");

        if (!batches || batches.length === 0) return;

        const batchMap = new Map(batches.map(b => [b.id, b]));

        // 2. Fetch the latest reading time for each active batch
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

        // 3. Read pending (0) and new (>) messages
        const [pendingRes, newRes] = await Promise.all([
            redis.xreadgroup(CONSUMER_GROUP, CONSUMER_NAME, REDIS_STREAM_KEY, "0", { count: 5000 }),
            redis.xreadgroup(CONSUMER_GROUP, CONSUMER_NAME, REDIS_STREAM_KEY, ">", { count: 5000 })
        ]);

        const allMessages = [...parseRedisResponse(pendingRes), ...parseRedisResponse(newRes)];
        if (allMessages.length === 0) return;

        // 4. Group by batch_id
        const messagesByBatch = new Map<string, typeof allMessages>();
        for (const msg of allMessages) {
            if (!messagesByBatch.has(msg.data.batch_id)) messagesByBatch.set(msg.data.batch_id, []);
            messagesByBatch.get(msg.data.batch_id)!.push(msg);
        }

        // 5. Aggregate and insert
        for (const [batch_id, msgs] of messagesByBatch.entries()) {
            const batchInfo = batchMap.get(batch_id);

            // If batch is deleted or no longer fermenting, clear its messages to free up Redis
            if (!batchInfo) {
                const ids = msgs.map(m => m.id);
                await redis.xack(REDIS_STREAM_KEY, CONSUMER_GROUP, ids);
                for (let i = 0; i < ids.length; i += 100) {
                    const chunk = ids.slice(i, i + 100);
                    if (chunk.length > 0) {
                        await (redis.xdel as any)(REDIS_STREAM_KEY, ...chunk);
                    }
                }
                continue;
            }

            const intervalMins = batchInfo.recording_interval_mins || 1;
            const intervalMs = intervalMins * 60 * 1000;
            const lastRecordedAt = lastReadingsMap.get(batch_id) || 0;
            const now = Date.now();

            // Check if enough time has passed to aggregate
            if (now - lastRecordedAt >= intervalMs) {
                let sumTemp = 0, sumHum = 0, sumPh = 0, sumCo2 = 0;
                let countTemp = 0, countHum = 0, countPh = 0, countCo2 = 0;

                for (const msg of msgs) {
                    if (msg.data.temperature !== null) { sumTemp += msg.data.temperature; countTemp++; }
                    if (msg.data.humidity !== null) { sumHum += msg.data.humidity; countHum++; }
                    if (msg.data.ph !== null) { sumPh += msg.data.ph; countPh++; }
                    if (msg.data.co2 !== null) { sumCo2 += msg.data.co2; countCo2++; }
                }

                if (countTemp === 0 && countHum === 0 && countPh === 0 && countCo2 === 0) {
                    // Empty data payload edgecase
                    const ids = msgs.map(m => m.id);
                    await redis.xack(REDIS_STREAM_KEY, CONSUMER_GROUP, ids);
                    for (let i = 0; i < ids.length; i += 100) {
                        const chunk = ids.slice(i, i + 100);
                        if (chunk.length > 0) {
                            await (redis.xdel as any)(REDIS_STREAM_KEY, ...chunk);
                        }
                    }
                    continue;
                }

                const aggRow = {
                    batch_id,
                    temperature: countTemp > 0 ? parseFloat((sumTemp / countTemp).toFixed(2)) : null,
                    humidity: countHum > 0 ? parseFloat((sumHum / countHum).toFixed(2)) : null,
                    ph: countPh > 0 ? parseFloat((sumPh / countPh).toFixed(2)) : null,
                    co2: countCo2 > 0 ? Math.round(sumCo2 / countCo2) : null,
                    recorded_at: new Date().toISOString()
                };

                const { error } = await supabase.from("sensor_readings").insert(aggRow);

                if (error) {
                    logger.error(`Supabase insert failed for batch ${batch_id}: ${error.message}`);
                } else {
                    logger.info(`Aggregated ${msgs.length} readings for batch ${batch_id}`);
                    // Acknowledge and delete processed messages from Redis
                    const ids = msgs.map(m => m.id);
                    await redis.xack(REDIS_STREAM_KEY, CONSUMER_GROUP, ids);
                    for (let i = 0; i < ids.length; i += 100) {
                        const chunk = ids.slice(i, i + 100);
                        if (chunk.length > 0) {
                            await (redis.xdel as any)(REDIS_STREAM_KEY, ...chunk);
                        }
                    }
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

    // Initial run
    await performAggregation();

    // Periodic interval
    setInterval(performAggregation, CHECK_INTERVAL_MS);
}
