import { Redis } from "@upstash/redis";

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_URL!,
    token: process.env.UPSTASH_REDIS_TOKEN!,
});

async function run() {
    console.log("Reading from stream (Pending)...");
    // "0" fetches pending messages we haven't xacked yet
    const res = await redis.xreadgroup("supabase-writers", "writer-1", process.env.REDIS_STREAM_KEY || "sensor-readings", "0", { count: 1 });
    console.log("Response:", JSON.stringify(res, null, 2));
}

run().catch(console.error);
