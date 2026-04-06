import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

async function run() {
    const key = `${process.env.POD_ID || "pod_01"}_telemetry`;

    console.log(`Reading from ZSET ${key}...`);
    const members = await redis.zrangebyscore(key, "-inf", "+inf", "WITHSCORES");

    if (members.length === 0) {
        console.log("No entries in ZSET");
    } else {
        for (let i = 0; i < members.length; i += 2) {
            console.log(`Score: ${members[i + 1]} | Data: ${members[i]}`);
        }
    }

    await redis.quit();
}

run().catch(console.error);
