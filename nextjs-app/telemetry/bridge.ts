import mqtt from "mqtt";
import Redis from "ioredis";
import logging from "./logging";

const logger = logging("bridge");

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const MQTT_TOPIC = process.env.MQTT_TOPIC || "invisi/fermentation/+/sensors";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const TTL_HOURS = 72;
const TTL_MS = TTL_HOURS * 60 * 60 * 1000;

const redis = new Redis(REDIS_URL);

interface SensorPayload {
    ts: number;
    batch_id: string;
    t_core?: number;
    t_left?: number;
    t_right?: number;
    gas_left?: number;
    gas_right?: number;
}

function zsetKey(podId: string): string {
    return `${podId}_telemetry`;
}

function extractPodId(topic: string): string {
    // invisi/fermentation/pod_01/sensors → pod_01
    const parts = topic.split("/");
    return parts[2] || "unknown";
}

export function startBridge() {
    const client = mqtt.connect(MQTT_BROKER_URL);

    client.on("connect", () => {
        logger.info(`Connected to MQTT broker at ${MQTT_BROKER_URL}`);
        client.subscribe(MQTT_TOPIC, { qos: 1 }, (err) => {
            if (err) {
                logger.error(`Subscribe failed: ${err.message}`);
                return;
            }
            logger.info(`Subscribed to ${MQTT_TOPIC} (QoS 1)`);
        });
    });

    client.on("message", async (topic, message) => {
        try {
            const payload: SensorPayload = JSON.parse(message.toString());

            if (!payload.batch_id) {
                logger.error("Message missing batch_id, skipping");
                return;
            }

            const podId = extractPodId(topic);
            const key = zsetKey(podId);
            const score = payload.ts || Math.floor(Date.now() / 1000);
            const member = JSON.stringify(payload);

            // ZADD with Unix epoch as score
            await redis.zadd(key, score, member);

            // TTL pruning — remove entries older than 72 hours
            const cutoff = Math.floor(Date.now() / 1000) - (TTL_HOURS * 3600);
            await redis.zremrangebyscore(key, "-inf", cutoff);

            logger.info(
                `ZADD ${key} score=${score}: ` +
                `tc=${payload.t_core} tl=${payload.t_left} tr=${payload.t_right} ` +
                `gl=${payload.gas_left} gr=${payload.gas_right}`
            );
        } catch (err) {
            logger.error(`Failed to process message: ${err}`);
        }
    });

    client.on("error", (err) => {
        logger.error(`MQTT error: ${err.message}`);
    });

    return client;
}
