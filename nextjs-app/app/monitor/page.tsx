"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import {
    Activity,
    Thermometer,
    Wind,
    Cpu,
    Wifi,
    Clock,
    ArrowUpRight,
    ArrowDownRight,
    Minus,
    Circle,
} from "lucide-react";

interface HealthData {
    status: string;
    service: string;
    mode: string;
    fsm_state: string;
    last_sync: string;
    uptime: number;
    started_at: string;
}

interface SensorReading {
    t_core: number | null;
    t_left: number | null;
    t_right: number | null;
    gas_left: number | null;
    gas_right: number | null;
    fermentation_state: string | null;
    recorded_at: string;
}

const STATE_CONFIG: Record<string, { color: string; bg: string; icon: typeof ArrowUpRight }> = {
    IDLE: { color: "text-gray-500", bg: "bg-gray-100", icon: Circle },
    ANAEROBIC_HEATING: { color: "text-orange-600", bg: "bg-orange-50", icon: ArrowUpRight },
    AEROBIC_PLATEAU: { color: "text-amber-600", bg: "bg-amber-50", icon: Minus },
    COOLING: { color: "text-blue-600", bg: "bg-blue-50", icon: ArrowDownRight },
};

function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function StatCard({
    label,
    value,
    unit,
    icon: Icon,
    color,
    subtext,
}: {
    label: string;
    value: string | number | null;
    unit?: string;
    icon: typeof Thermometer;
    color: string;
    subtext?: string;
}) {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3 mb-3">
                <div className={`h-9 w-9 rounded-xl ${color} flex items-center justify-center`}>
                    <Icon size={18} className="text-white" />
                </div>
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">
                {value ?? "—"}
                {unit && <span className="text-lg text-gray-400 ml-1">{unit}</span>}
            </p>
            {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
        </div>
    );
}

export default function MonitorPage() {
    const [health, setHealth] = useState<HealthData | null>(null);
    const [reading, setReading] = useState<SensorReading | null>(null);
    const [readings, setReadings] = useState<SensorReading[]>([]);
    const [activeBatchId, setActiveBatchId] = useState<string | null>(null);

    // Fetch active batch
    useEffect(() => {
        fetch("/api/batches")
            .then((r) => r.json())
            .then((batches) => {
                const fermenting = batches.find((b: any) => b.status === "fermenting");
                if (fermenting) setActiveBatchId(fermenting.id);
            })
            .catch(() => {});
    }, []);

    // Fetch health from telemetry pipeline
    useEffect(() => {
        const fetchHealth = () => {
            fetch("http://localhost:10000/health")
                .then((r) => r.json())
                .then(setHealth)
                .catch(() => setHealth(null));
        };
        fetchHealth();
        const interval = setInterval(fetchHealth, 5000);
        return () => clearInterval(interval);
    }, []);

    // Fetch latest readings
    useEffect(() => {
        if (!activeBatchId) return;
        const fetchReadings = async () => {
            try {
                const res = await fetch(`/api/readings?batch_id=${activeBatchId}&limit=20`);
                if (!res.ok) return;
                const data = await res.json();
                setReadings(data);
                if (data.length > 0) setReading(data[0]);
            } catch {}
        };
        fetchReadings();
        const interval = setInterval(fetchReadings, 10_000);
        return () => clearInterval(interval);
    }, [activeBatchId]);

    const fsmState = health?.fsm_state || reading?.fermentation_state || "IDLE";
    const stateConfig = STATE_CONFIG[fsmState] || STATE_CONFIG.IDLE;
    const StateIcon = stateConfig.icon;

    const gradient =
        reading?.t_core != null && reading?.t_left != null && reading?.t_right != null
            ? (reading.t_core - (reading.t_left + reading.t_right) / 2).toFixed(1)
            : null;

    return (
        <div className="min-h-screen bg-[#F8F7F4]">
            <Header />

            <motion.main
                initial="hidden"
                animate="visible"
                variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
                className="max-w-7xl mx-auto px-6 md:px-10 py-8 pb-32"
            >
                {/* Title */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="mb-8"
                >
                    <h1 className="text-3xl font-bold text-gray-900">Live Monitor</h1>
                    <p className="text-gray-500 mt-1">Real-time telemetry from your fermentation pods</p>
                </motion.div>

                {/* FSM State Banner */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className={`${stateConfig.bg} rounded-3xl p-6 mb-8 border border-gray-100`}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className={`h-14 w-14 rounded-2xl bg-white shadow-sm flex items-center justify-center`}>
                                <StateIcon size={28} className={stateConfig.color} />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Fermentation State</p>
                                <p className={`text-2xl font-bold ${stateConfig.color} mt-0.5`}>
                                    {fsmState.replace(/_/g, " ")}
                                </p>
                            </div>
                        </div>
                        <div className="hidden md:flex items-center gap-6 text-sm">
                            {health && (
                                <>
                                    <div className="flex items-center gap-2 text-gray-500">
                                        <Clock size={14} />
                                        <span>Uptime: {formatUptime(health.uptime)}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-gray-500">
                                        <Wifi size={14} />
                                        <span>Last sync: {new Date(health.last_sync).toLocaleTimeString()}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="inline-flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                                        <span className="text-green-700 font-medium">Online</span>
                                    </div>
                                </>
                            )}
                            {!health && (
                                <div className="flex items-center gap-2">
                                    <span className="inline-flex h-2 w-2 rounded-full bg-red-500" />
                                    <span className="text-red-600 font-medium">Pipeline Offline</span>
                                </div>
                            )}
                        </div>
                    </div>
                </motion.div>

                {/* Sensor Cards */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8"
                >
                    <StatCard label="Core Temp" value={reading?.t_core?.toFixed(1) ?? null} unit="°C" icon={Thermometer} color="bg-red-500" />
                    <StatCard label="Left Temp" value={reading?.t_left?.toFixed(1) ?? null} unit="°C" icon={Thermometer} color="bg-orange-500" />
                    <StatCard label="Right Temp" value={reading?.t_right?.toFixed(1) ?? null} unit="°C" icon={Thermometer} color="bg-yellow-500" />
                    <StatCard label="Gradient" value={gradient} unit="°C" icon={Activity} color="bg-purple-500" subtext={gradient && parseFloat(gradient) > 5 ? "Turn recommended" : undefined} />
                    <StatCard label="Gas Left" value={reading?.gas_left ?? null} icon={Wind} color="bg-teal-500" subtext="PPM" />
                    <StatCard label="Gas Right" value={reading?.gas_right ?? null} icon={Wind} color="bg-cyan-500" subtext="PPM" />
                </motion.div>

                {/* Recent Readings Table */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden"
                >
                    <div className="px-6 py-5 border-b border-gray-50 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-gray-900 flex items-center justify-center">
                                <Cpu size={18} className="text-white" />
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-900">Telemetry Log</h3>
                                <p className="text-xs text-gray-400">{readings.length} recent readings</p>
                            </div>
                        </div>
                        {health && (
                            <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-lg">
                                {health.mode.toUpperCase()} MODE
                            </span>
                        )}
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-xs text-gray-400 uppercase tracking-wider">
                                    <th className="text-left px-6 py-3 font-medium">Time</th>
                                    <th className="text-right px-4 py-3 font-medium">Core</th>
                                    <th className="text-right px-4 py-3 font-medium">Left</th>
                                    <th className="text-right px-4 py-3 font-medium">Right</th>
                                    <th className="text-right px-4 py-3 font-medium">Gas L</th>
                                    <th className="text-right px-4 py-3 font-medium">Gas R</th>
                                    <th className="text-right px-6 py-3 font-medium">State</th>
                                </tr>
                            </thead>
                            <tbody>
                                {readings.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="text-center py-12 text-gray-300">
                                            No telemetry data yet
                                        </td>
                                    </tr>
                                )}
                                {readings.map((r, i) => (
                                    <tr key={i} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                                        <td className="px-6 py-3 text-gray-600 font-mono text-xs">
                                            {new Date(r.recorded_at).toLocaleTimeString()}
                                        </td>
                                        <td className="text-right px-4 py-3 font-bold text-gray-900">
                                            {r.t_core?.toFixed(1) ?? "—"}°
                                        </td>
                                        <td className="text-right px-4 py-3 text-gray-600">
                                            {r.t_left?.toFixed(1) ?? "—"}°
                                        </td>
                                        <td className="text-right px-4 py-3 text-gray-600">
                                            {r.t_right?.toFixed(1) ?? "—"}°
                                        </td>
                                        <td className="text-right px-4 py-3 text-gray-600">{r.gas_left ?? "—"}</td>
                                        <td className="text-right px-4 py-3 text-gray-600">{r.gas_right ?? "—"}</td>
                                        <td className="text-right px-6 py-3">
                                            {r.fermentation_state && (
                                                <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
                                                    {r.fermentation_state.replace(/_/g, " ")}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </motion.div>
            </motion.main>

            <BottomNav />
        </div>
    );
}
