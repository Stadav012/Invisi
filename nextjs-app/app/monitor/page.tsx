"use client";

import { useState, useEffect, useCallback } from "react";
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
    ChevronLeft,
    ChevronRight,
    ArrowUpRight,
    ArrowDownRight,
    Minus,
    Circle,
    Loader2,
} from "lucide-react";

interface HealthData {
    status: string;
    service: string;
    mode: string;
    fsm_state: string;
    last_sync: string;
    uptime: number;
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

const STATE_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
    IDLE: { label: "Idle", color: "text-gray-600", bg: "bg-gray-100", dot: "bg-gray-400" },
    ANAEROBIC_HEATING: { label: "Anaerobic Heating", color: "text-orange-700", bg: "bg-orange-50", dot: "bg-orange-500" },
    AEROBIC_PLATEAU: { label: "Aerobic Plateau", color: "text-amber-700", bg: "bg-amber-50", dot: "bg-amber-500" },
    COOLING: { label: "Cooling", color: "text-blue-700", bg: "bg-blue-50", dot: "bg-blue-500" },
};

const PAGE_SIZE = 30;

function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function MonitorPage() {
    const [health, setHealth] = useState<HealthData | null>(null);
    const [readings, setReadings] = useState<SensorReading[]>([]);
    const [latestReading, setLatestReading] = useState<SensorReading | null>(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);
    const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
    const [batchName, setBatchName] = useState("");

    // Fetch active batch
    useEffect(() => {
        fetch("/api/batches")
            .then((r) => r.json())
            .then((batches) => {
                const fermenting = batches.find((b: any) => b.status === "fermenting");
                if (fermenting) {
                    setActiveBatchId(fermenting.id);
                    setBatchName(fermenting.batch_number);
                } else if (batches.length > 0) {
                    setActiveBatchId(batches[0].id);
                    setBatchName(batches[0].batch_number);
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    // Fetch health
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

    // Always fetch the latest reading for the sensor strip (independent of page)
    useEffect(() => {
        if (!activeBatchId) return;
        const fetchLatest = async () => {
            try {
                const res = await fetch(`/api/readings?batch_id=${activeBatchId}&limit=1&offset=0`);
                if (!res.ok) return;
                const json = await res.json();
                const data = json.data ?? [];
                if (data.length > 0) setLatestReading(data[0]);
            } catch {}
        };
        fetchLatest();
        const interval = setInterval(fetchLatest, 10_000);
        return () => clearInterval(interval);
    }, [activeBatchId]);

    // Fetch paginated readings for the table
    const fetchReadings = useCallback(async () => {
        if (!activeBatchId) return;
        try {
            const offset = page * PAGE_SIZE;
            const res = await fetch(
                `/api/readings?batch_id=${activeBatchId}&limit=${PAGE_SIZE}&offset=${offset}`,
            );
            if (!res.ok) return;
            const json = await res.json();
            setReadings(json.data ?? []);
            setTotal(json.total ?? 0);
        } catch {}
    }, [activeBatchId, page]);

    useEffect(() => {
        fetchReadings();
    }, [fetchReadings]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const fsmState = health?.fsm_state || latestReading?.fermentation_state || "IDLE";
    const stateConfig = STATE_CONFIG[fsmState] || STATE_CONFIG.IDLE;

    const gradient =
        latestReading?.t_core != null && latestReading?.t_left != null && latestReading?.t_right != null
            ? (latestReading.t_core - (latestReading.t_left + latestReading.t_right) / 2).toFixed(1)
            : null;

    if (loading) {
        return (
            <div className="min-h-screen bg-invisi-light flex items-center justify-center">
                <Loader2 className="animate-spin text-invisi-green" size={40} />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-invisi-light pb-32 font-sans text-gray-900">
            <Header />

            <motion.main
                initial="hidden"
                animate="visible"
                variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } }}
                className="mx-auto max-w-7xl px-6 py-8 md:px-10"
            >
                {/* Title Row */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="flex items-center justify-between mb-8"
                >
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Live Monitor</h1>
                        <p className="text-sm text-gray-500 mt-0.5">
                            {batchName ? `Viewing ${batchName}` : "No active batch"}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {health ? (
                            <div className="flex items-center gap-2 px-4 py-2 bg-green-50 rounded-xl border border-green-100">
                                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                                <span className="text-xs font-bold text-green-700">Pipeline Online</span>
                                <span className="text-xs text-green-600">· {formatUptime(health.uptime)}</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 px-4 py-2 bg-red-50 rounded-xl border border-red-100">
                                <span className="h-2 w-2 rounded-full bg-red-500" />
                                <span className="text-xs font-bold text-red-700">Pipeline Offline</span>
                            </div>
                        )}
                    </div>
                </motion.div>

                {/* FSM + Sensor strip */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8"
                >
                    {/* FSM State */}
                    <div className={`col-span-2 md:col-span-1 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm`}>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Phase</p>
                        <div className="flex items-center gap-2">
                            <span className={`h-3 w-3 rounded-full ${stateConfig.dot}`} />
                            <span className={`text-sm font-bold ${stateConfig.color}`}>{stateConfig.label}</span>
                        </div>
                    </div>
                    {/* Sensor cards */}
                    {[
                        { label: "Core", value: latestReading?.t_core, unit: "°C", color: "text-red-600" },
                        { label: "Left", value: latestReading?.t_left, unit: "°C", color: "text-orange-600" },
                        { label: "Right", value: latestReading?.t_right, unit: "°C", color: "text-yellow-600" },
                        { label: "Gradient", value: gradient ? parseFloat(gradient) : null, unit: "°C", color: "text-purple-600" },
                        { label: "Gas L", value: latestReading?.gas_left, unit: "", color: "text-teal-600" },
                        { label: "Gas R", value: latestReading?.gas_right, unit: "", color: "text-cyan-600" },
                    ].map((s) => (
                        <div key={s.label} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{s.label}</p>
                            <p className={`text-xl font-bold ${s.value != null ? s.color : "text-gray-300"}`}>
                                {s.value != null ? `${typeof s.value === "number" ? s.value.toFixed(1) : s.value}${s.unit}` : "—"}
                            </p>
                        </div>
                    ))}
                </motion.div>

                {/* Readings Table */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden"
                >
                    {/* Table Header */}
                    <div className="px-6 py-5 border-b border-gray-50 flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Telemetry Log</h2>
                            <p className="text-xs text-gray-400 mt-0.5">{total.toLocaleString()} readings total</p>
                        </div>
                        {/* Pagination Controls */}
                        <div className="flex items-center gap-2">
                            <button
                                disabled={page === 0}
                                onClick={() => setPage((p) => Math.max(0, p - 1))}
                                className="h-9 w-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <span className="text-xs font-bold text-gray-600 min-w-[80px] text-center">
                                Page {page + 1} of {totalPages}
                            </span>
                            <button
                                disabled={page >= totalPages - 1}
                                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                                className="h-9 w-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-xs text-gray-400 uppercase tracking-wider border-b border-gray-50">
                                    <th className="text-left px-6 py-3 font-medium">#</th>
                                    <th className="text-left px-4 py-3 font-medium">Time</th>
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
                                        <td colSpan={8} className="text-center py-16 text-gray-300 text-sm">
                                            No readings recorded yet
                                        </td>
                                    </tr>
                                )}
                                {readings.map((r, i) => {
                                    const rowNum = total - (page * PAGE_SIZE + i);
                                    return (
                                        <tr key={i} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                                            <td className="px-6 py-3 text-xs text-gray-300 font-mono">{rowNum}</td>
                                            <td className="px-4 py-3 text-gray-600 text-xs">
                                                <div className="font-medium">{new Date(r.recorded_at).toLocaleTimeString()}</div>
                                                <div className="text-gray-300">{new Date(r.recorded_at).toLocaleDateString()}</div>
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
                                                {r.fermentation_state ? (
                                                    <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">
                                                        {r.fermentation_state.replace(/_/g, " ")}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-200">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Bottom Pagination */}
                    {total > PAGE_SIZE && (
                        <div className="px-6 py-4 border-t border-gray-50 flex items-center justify-between text-xs text-gray-400">
                            <span>
                                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
                            </span>
                            <div className="flex items-center gap-1">
                                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                    let pageNum: number;
                                    if (totalPages <= 5) {
                                        pageNum = i;
                                    } else if (page < 3) {
                                        pageNum = i;
                                    } else if (page > totalPages - 4) {
                                        pageNum = totalPages - 5 + i;
                                    } else {
                                        pageNum = page - 2 + i;
                                    }
                                    return (
                                        <button
                                            key={pageNum}
                                            onClick={() => setPage(pageNum)}
                                            className={`h-8 w-8 rounded-lg flex items-center justify-center font-bold transition-colors ${
                                                page === pageNum
                                                    ? "bg-gray-900 text-white"
                                                    : "text-gray-500 hover:bg-gray-100"
                                            }`}
                                        >
                                            {pageNum + 1}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </motion.div>
            </motion.main>

            <BottomNav />
        </div>
    );
}
