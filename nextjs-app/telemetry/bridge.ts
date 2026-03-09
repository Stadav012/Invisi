
import mqtt from "mqtt";
import { Redis } from "@upstash/redis";
import logging from "./logging";

const logger = logging("bridge");

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL!;
const MQTT_USERNAME = process.env.MQTT_USERNAME!;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD!;
const MQTT_TOPIC = process.env.MQTT_TOPIC || "invisi/pod/+/telemetry";
const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || "sensor-readings";

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_URL!,
    token: process.env.UPSTASH_REDIS_TOKEN!,
});

interface SensorPayload {
    batch_id: string;
    temperature: number;
    humidity: number;
    ph: number;
    co2: number;
    recorded_at: string;
}

export function startBridge() {
    const client = mqtt.connect(MQTT_BROKER_URL, {
        username: MQTT_USERNAME,
        password: MQTT_PASSWORD,
        protocol: "mqtts",
        rejectUnauthorized: true,
    });

    client.on("connect", () => {
        logger.info(`Connected to MQTT broker`);
        client.subscribe(MQTT_TOPIC, (err) => {
            if (err) {
                logger.error(`Subscribe failed: ${err.message}`);
                return;
            }
            logger.info(`Subscribed to ${MQTT_TOPIC}`);
        });
    });

    client.on("message", async (_topic, message) => {
        try {
            const payload: SensorPayload = JSON.parse(message.toString());

            if (!payload.batch_id) {
                logger.error("Message missing batch_id, skipping");
                return;
            }

            // XADD to Redis Stream
            await redis.xadd(REDIS_STREAM_KEY, "*", {
                batch_id: payload.batch_id,
                temperature: String(payload.temperature ?? ""),
                humidity: String(payload.humidity ?? ""),
                ph: String(payload.ph ?? ""),
                co2: String(payload.co2 ?? ""),
                recorded_at: payload.recorded_at || new Date().toISOString(),
            });

            logger.info(
                `Pushed reading for batch ${payload.batch_id}: ` +
                `temp=${payload.temperature} hum=${payload.humidity} ` +
                `ph=${payload.ph} co2=${payload.co2}`
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
