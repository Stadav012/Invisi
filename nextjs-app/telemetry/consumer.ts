import Redis from "ioredis";
import mqtt from "mqtt";
import { createClient } from "@supabase/supabase-js";
import logging from "./logging";

const logger = logging("consumer");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const POD_ID = process.env.POD_ID || "pod_01";

const redis = new Redis(REDIS_URL);
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

// =========================================================================
// FSM States
// =========================================================================

enum FermentationState {
    IDLE = "IDLE",
    ANAEROBIC_HEATING = "ANAEROBIC_HEATING",
    AEROBIC_PLATEAU = "AEROBIC_PLATEAU",
    COOLING = "COOLING",
}

// =========================================================================
// Configuration
// =========================================================================

const DERIVATIVE_THRESHOLD = 0.1;   // C/min — below this = plateau
const SUSTAINED_WINDOWS = 3;        // Consecutive low-derivative windows to trigger state change
const WINDOW_MINUTES = 30;          // Sliding window size
const POLL_INTERVAL_MS = 30_000;    // Check every 30 seconds
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // Supabase batch sync every 15 minutes
const MIX_LOCK_TTL = 14400;         // 4 hours in seconds

// =========================================================================
// State
// =========================================================================

let currentState: FermentationState = FermentationState.IDLE;
let lowDerivativeCount = 0;
let lastSyncTimestamp = Math.floor(Date.now() / 1000);
let mqttClient: mqtt.MqttClient | null = null;

export function getCurrentState(): FermentationState {
    return currentState;
}

export function getLastSyncTimestamp(): number {
    return lastSyncTimestamp;
}

// =========================================================================
// Sliding Window Derivative Algorithm
// =========================================================================

interface Reading {
    ts: number;
    batch_id: string;
    t_core: number | null;
    t_left: number | null;
    t_right: number | null;
    gas_left: number | null;
    gas_right: number | null;
}

function parseReading(json: string): Reading | null {
    try {
        const obj = JSON.parse(json);
        return {
            ts: obj.ts,
            batch_id: obj.batch_id,
            t_core: obj.t_core ?? null,
            t_left: obj.t_left ?? null,
            t_right: obj.t_right ?? null,
            gas_left: obj.gas_left ?? null,
            gas_right: obj.gas_right ?? null,
        };
    } catch {
        return null;
    }
}

async function getRecentReadings(windowMinutes: number): Promise<Reading[]> {
    const now = Math.floor(Date.now() / 1000);
    const from = now - (windowMinutes * 60);
    const key = `${POD_ID}_telemetry`;

    const members = await redis.zrangebyscore(key, from, now);
    const readings: Reading[] = [];

    for (const member of members) {
        const r = parseReading(member);
        if (r && r.t_core !== null) readings.push(r);
    }

    return readings.sort((a, b) => a.ts - b.ts);
}

function computeDerivative(readings: Reading[]): number | null {
    if (readings.length < 2) return null;

    const first = readings[0];
    const last = readings[readings.length - 1];

    if (first.t_core === null || last.t_core === null) return null;

    const dt = (last.ts - first.ts) / 60; // Convert to minutes
    if (dt <= 0) return null;

    return (last.t_core - first.t_core) / dt; // C/min
}

// =========================================================================
// FSM Transition Logic
// =========================================================================

async function transitionState(newState: FermentationState, derivative: number | null, gradient: number | null) {
    const oldState = currentState;
    currentState = newState;
    lowDerivativeCount = 0;

    logger.info(`FSM: ${oldState} -> ${newState} (dT/dt=${derivative?.toFixed(4)}, gradient=${gradient?.toFixed(1)})`);

    // Log event to Supabase on next sync
    try {
        // Fetch active batch for the event log
        const { data: batch } = await supabase
            .from("batches")
            .select("id")
            .eq("status", "fermenting")
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

        if (batch) {
            await supabase.from("fermentation_events").insert({
                batch_id: batch.id,
                event_type: newState === FermentationState.AEROBIC_PLATEAU ? "MIX_ALERT" : "STATE_TRANSITION",
                state_from: oldState,
                state_to: newState,
                gradient: gradient,
                derivative: derivative,
            });
        }
    } catch (err) {
        logger.error(`Failed to log fermentation event: ${err}`);
    }
}

async function triggerMixAlert(derivative: number, gradient: number) {
    const lockKey = `mix_lock:${POD_ID}`;

    // Check debounce lock
    const locked = await redis.get(lockKey);
    if (locked) {
        logger.info("Mix alert suppressed — lock active for 4 hours");
        return;
    }

    // Set lock (4-hour rate limit)
    await redis.set(lockKey, "1", "EX", MIX_LOCK_TTL);

    // Publish HITL alert to MQTT for hardware LED actuation
    const alertTopic = `invisi/fermentation/${POD_ID}/alerts`;
    const alertPayload = JSON.stringify({
        type: "ACTIVATE_MIX_ALERT",
        gradient: gradient,
        derivative: derivative,
        ts: Math.floor(Date.now() / 1000),
    });

    if (mqttClient) {
        mqttClient.publish(alertTopic, alertPayload, { qos: 1 }, (err) => {
            if (err) {
                logger.error(`Failed to publish mix alert: ${err.message}`);
            } else {
                logger.info(`Published ACTIVATE_MIX_ALERT to ${alertTopic}`);
            }
        });
    }
}

async function runFSM() {
    const readings = await getRecentReadings(WINDOW_MINUTES);

    if (readings.length === 0) {
        if (currentState !== FermentationState.IDLE) {
            await transitionState(FermentationState.IDLE, null, null);
        }
        return;
    }

    const derivative = computeDerivative(readings);
    if (derivative === null) return;

    // Compute current thermal gradient
    const latest = readings[readings.length - 1];
    let gradient: number | null = null;
    if (latest.t_core !== null) {
        const edges: number[] = [];
        if (latest.t_left !== null) edges.push(latest.t_left);
        if (latest.t_right !== null) edges.push(latest.t_right);
        if (edges.length > 0) {
            const edgeAvg = edges.reduce((a, b) => a + b, 0) / edges.length;
            gradient = latest.t_core - edgeAvg;
        }
    }

    logger.info(
        `FSM tick: state=${currentState} dT/dt=${derivative.toFixed(4)} C/min ` +
        `gradient=${gradient?.toFixed(1) ?? "N/A"} lowCount=${lowDerivativeCount}`
    );

    switch (currentState) {
        case FermentationState.IDLE:
            // Any positive temperature activity → ANAEROBIC_HEATING
            if (derivative > 0) {
                await transitionState(FermentationState.ANAEROBIC_HEATING, derivative, gradient);
            }
            break;

        case FermentationState.ANAEROBIC_HEATING:
            // Detect plateau: derivative drops below threshold
            if (derivative < DERIVATIVE_THRESHOLD) {
                lowDerivativeCount++;
                if (lowDerivativeCount >= SUSTAINED_WINDOWS) {
                    await transitionState(FermentationState.AEROBIC_PLATEAU, derivative, gradient);
                    await triggerMixAlert(derivative, gradient ?? 0);
                }
            } else {
                lowDerivativeCount = 0; // Reset — still heating
            }
            break;

        case FermentationState.AEROBIC_PLATEAU:
            // Detect cooling: sustained negative derivative
            if (derivative < -DERIVATIVE_THRESHOLD) {
                lowDerivativeCount++;
                if (lowDerivativeCount >= SUSTAINED_WINDOWS) {
                    await transitionState(FermentationState.COOLING, derivative, gradient);
                }
            } else {
                lowDerivativeCount = 0;

                // Check if gradient warrants another mix alert
                if (gradient !== null && gradient > 5.0) {
                    await triggerMixAlert(derivative, gradient);
                }
            }
            break;

        case FermentationState.COOLING:
            // Could transition back to IDLE if temperature drops to ambient
            if (latest.t_core !== null && latest.t_core < 30) {
                await transitionState(FermentationState.IDLE, derivative, gradient);
            }
            break;
    }
}

// =========================================================================
// Supabase Batch Sync (every 15 minutes)
// =========================================================================

async function batchSyncReadings() {
    const key = `${POD_ID}_telemetry`;
    const now = Math.floor(Date.now() / 1000);

    const members = await redis.zrangebyscore(key, lastSyncTimestamp, now);

    if (members.length === 0) {
        logger.info("Readings sync: no new readings");
        return;
    }

    const rows: Record<string, any>[] = [];
    for (const member of members) {
        const r = parseReading(member);
        if (!r || !r.batch_id) continue;

        rows.push({
            batch_id: r.batch_id,
            t_core: r.t_core,
            t_left: r.t_left,
            t_right: r.t_right,
            gas_left: r.gas_left,
            gas_right: r.gas_right,
            recorded_at: new Date(r.ts * 1000).toISOString(),
            fermentation_state: currentState,
        });
    }

    if (rows.length === 0) return;

    const { error } = await supabase.from("sensor_readings").insert(rows);

    if (error) {
        if (error.message.includes("foreign key")) {
            logger.info(`Readings sync: batch gone, discarding ${rows.length}`);
        } else {
            logger.error(`Readings sync failed: ${error.message}`);
            return;
        }
    } else {
        logger.info(`Readings sync: inserted ${rows.length} to Supabase`);
    }

    lastSyncTimestamp = now;
}

// =========================================================================
// Sorting Results Batch Sync
// =========================================================================

let lastSortingSyncTimestamp = Math.floor(Date.now() / 1000);

interface SortingEntry {
    ts: number;
    batch_id: string;
    prediction: number;
    label: string;
    confidence: number;
    inference_ms: number;
}

function parseSortingEntry(json: string): SortingEntry | null {
    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
}

async function batchSyncSorting() {
    const key = `${POD_ID}_sorting`;
    const now = Math.floor(Date.now() / 1000);

    const members = await redis.zrangebyscore(key, lastSortingSyncTimestamp, now);

    if (members.length === 0) {
        logger.info("Sorting sync: no new results");
        return;
    }

    const rows: Record<string, any>[] = [];
    for (const member of members) {
        const entry = parseSortingEntry(member);
        if (!entry || !entry.batch_id) continue;

        rows.push({
            batch_id: entry.batch_id,
            prediction: entry.prediction,
            label: entry.label,
            confidence: entry.confidence,
            inference_ms: entry.inference_ms,
            sorted_at: new Date(entry.ts * 1000).toISOString(),
        });
    }

    if (rows.length === 0) return;

    const { error } = await supabase.from("sorting_results").insert(rows);

    if (error) {
        if (error.message.includes("foreign key")) {
            logger.info(`Sorting sync: batch gone, discarding ${rows.length}`);
        } else {
            logger.error(`Sorting sync failed: ${error.message}`);
            return;
        }
    } else {
        logger.info(`Sorting sync: inserted ${rows.length} results to Supabase`);
    }

    lastSortingSyncTimestamp = now;
}

// =========================================================================
// Entrypoint
// =========================================================================

export async function startConsumer() {
    // Connect to local MQTT for publishing alerts
    mqttClient = mqtt.connect(MQTT_BROKER_URL);
    mqttClient.on("connect", () => {
        logger.info("FSM consumer connected to MQTT for alerts");
    });

    logger.info("FSM consumer started");
    logger.info(`  Derivative threshold: ${DERIVATIVE_THRESHOLD} C/min`);
    logger.info(`  Sustained windows: ${SUSTAINED_WINDOWS}`);
    logger.info(`  Window size: ${WINDOW_MINUTES} min`);
    logger.info(`  Sync interval: ${SYNC_INTERVAL_MS / 60000} min`);

    // FSM poll loop
    const fsmLoop = async () => {
        try {
            await runFSM();
        } catch (err) {
            logger.error(`FSM error: ${err}`);
        }
    };

    await fsmLoop();
    setInterval(fsmLoop, POLL_INTERVAL_MS);

    // Supabase batch sync loop — readings + sorting
    setInterval(async () => {
        try {
            await batchSyncReadings();
        } catch (err) {
            logger.error(`Readings sync error: ${err}`);
        }

        try {
            await batchSyncSorting();
        } catch (err) {
            logger.error(`Sorting sync error: ${err}`);
        }
    }, SYNC_INTERVAL_MS);
}
