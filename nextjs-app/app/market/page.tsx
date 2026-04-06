"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import {
    Package,
    Loader2,
    ArrowRight,
    Scale,
    Calendar,
    Layers,
    Leaf,
    Sun,
    Eye,
    Award,
    CheckCircle2,
    Trash2,
} from "lucide-react";

interface Batch {
    id: string;
    batch_number: string;
    status: string;
    weight_kg: number | null;
    variety: string;
    notes: string | null;
    fermentation_start_date: string;
    created_at: string;
}

interface SortingSummary {
    total_sorted: number;
    good_count: number;
    poor_count: number;
    good_pct: number;
}

const STATUS_FLOW = ["fermenting", "drying", "sorting", "ready", "completed"] as const;

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Leaf; color: string; bg: string; border: string; dot: string }> = {
    fermenting: { label: "Fermenting", icon: Leaf, color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-100", dot: "bg-orange-500" },
    drying: { label: "Drying", icon: Sun, color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-100", dot: "bg-blue-500" },
    sorting: { label: "Sorting", icon: Eye, color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-100", dot: "bg-purple-500" },
    ready: { label: "Ready", icon: Award, color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-100", dot: "bg-emerald-500" },
    completed: { label: "Completed", icon: CheckCircle2, color: "text-green-700", bg: "bg-green-50", border: "border-green-100", dot: "bg-green-500" },
};

function daysSince(dateStr: string): number {
    return Math.max(1, Math.ceil((Date.now() - new Date(dateStr).getTime()) / 86_400_000));
}

export default function MarketPage() {
    const [batches, setBatches] = useState<Batch[]>([]);
    const [sortingMap, setSortingMap] = useState<Record<string, SortingSummary>>({});
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<string>("all");
    const [transitioning, setTransitioning] = useState<string | null>(null);

    const fetchBatches = useCallback(async () => {
        try {
            const res = await fetch("/api/batches");
            if (!res.ok) return;
            const data = await res.json();
            setBatches(data);

            // Fetch sorting data for each
            const map: Record<string, SortingSummary> = {};
            await Promise.all(
                data.map(async (b: Batch) => {
                    try {
                        const r = await fetch(`/api/sorting?batch_id=${b.id}`);
                        if (r.ok) {
                            const { summary } = await r.json();
                            if (summary) map[b.id] = summary;
                        }
                    } catch {}
                }),
            );
            setSortingMap(map);
        } catch {} finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchBatches();
    }, [fetchBatches]);

    const transitionBatch = async (batchId: string, newStatus: string) => {
        setTransitioning(batchId);
        try {
            const res = await fetch(`/api/batches/${batchId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus }),
            });
            if (!res.ok) {
                const err = await res.json();
                console.error("Transition failed:", err);
            }
            await fetchBatches();
        } catch (e) {
            console.error("Transition error:", e);
        } finally {
            setTransitioning(null);
        }
    };

    const deleteBatch = async (batchId: string) => {
        try {
            await fetch(`/api/batches/${batchId}`, { method: "DELETE" });
            await fetchBatches();
        } catch {}
    };

    const filteredBatches = filter === "all" ? batches : batches.filter((b) => b.status === filter);
    const counts: Record<string, number> = {
        all: batches.length,
        fermenting: batches.filter((b) => b.status === "fermenting").length,
        drying: batches.filter((b) => b.status === "drying").length,
        sorting: batches.filter((b) => b.status === "sorting").length,
        ready: batches.filter((b) => b.status === "ready").length,
        completed: batches.filter((b) => b.status === "completed").length,
    };

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
                {/* Header */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="mb-8"
                >
                    <h1 className="text-2xl font-bold text-gray-900">Batch Manager</h1>
                    <p className="text-sm text-gray-500 mt-0.5">Track, transition, and manage your cocoa batches</p>
                </motion.div>

                {/* Summary Cards */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
                >
                    {[
                        { label: "Total", value: counts.all, icon: Package, color: "bg-gray-900" },
                        { label: "Fermenting", value: counts.fermenting, icon: Leaf, color: "bg-orange-500" },
                        { label: "Drying", value: counts.drying, icon: Sun, color: "bg-blue-500" },
                        { label: "Ready", value: counts.ready, icon: Award, color: "bg-emerald-600" },
                    ].map((s) => (
                        <div key={s.label} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                            <div className="flex items-center gap-3 mb-3">
                                <div className={`h-9 w-9 rounded-xl ${s.color} flex items-center justify-center`}>
                                    <s.icon size={18} className="text-white" />
                                </div>
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{s.label}</span>
                            </div>
                            <p className="text-3xl font-bold text-gray-900">{s.value}</p>
                        </div>
                    ))}
                </motion.div>

                {/* Filter Tabs */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="flex items-center justify-between mb-6"
                >
                    <div className="flex gap-2">
                        {(["all", "fermenting", "drying", "sorting", "ready", "completed"] as const).map((f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors capitalize ${
                                    filter === f
                                        ? "bg-gray-900 text-white"
                                        : "text-gray-500 hover:bg-gray-100"
                                }`}
                            >
                                {f} ({counts[f]})
                            </button>
                        ))}
                    </div>
                </motion.div>

                {/* Batch List */}
                {filteredBatches.length === 0 ? (
                    <motion.div
                        variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                        className="rounded-2xl border border-gray-100 bg-white p-16 text-center shadow-sm"
                    >
                        <Package size={40} className="mx-auto text-gray-200 mb-4" />
                        <p className="text-gray-400 font-medium">No batches in this category</p>
                    </motion.div>
                ) : (
                    <motion.div
                        variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                        className="space-y-4"
                    >
                        {filteredBatches.map((batch) => {
                            const cfg = STATUS_CONFIG[batch.status] || STATUS_CONFIG.fermenting;
                            const StatusIcon = cfg.icon;
                            const sorting = sortingMap[batch.id];
                            const days = daysSince(batch.fermentation_start_date);

                            // Determine next status
                            const currentIdx = STATUS_FLOW.indexOf(batch.status as any);
                            const nextStatus = currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1
                                ? STATUS_FLOW[currentIdx + 1]
                                : null;
                            const nextCfg = nextStatus ? STATUS_CONFIG[nextStatus] : null;

                            return (
                                <div
                                    key={batch.id}
                                    className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
                                >
                                    {/* Top row */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-4">
                                            <div className={`h-12 w-12 rounded-2xl ${cfg.bg} ${cfg.border} border flex items-center justify-center`}>
                                                <StatusIcon size={22} className={cfg.color} />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-bold text-gray-900">{batch.batch_number}</h3>
                                                <p className="text-xs text-gray-400">{batch.variety} · {batch.weight_kg ?? "—"} kg</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`px-3 py-1 text-xs font-bold rounded-full ${cfg.bg} ${cfg.color} ${cfg.border} border capitalize`}>
                                                {cfg.label}
                                            </span>
                                            <button
                                                onClick={() => deleteBatch(batch.id)}
                                                className="p-2 rounded-xl text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                                title="Delete batch"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Info Strip */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 py-4 border-y border-gray-50">
                                        <div className="flex items-center gap-2">
                                            <Calendar size={14} className="text-gray-300" />
                                            <div>
                                                <p className="text-xs text-gray-400">Started</p>
                                                <p className="text-sm font-bold text-gray-900">
                                                    {new Date(batch.fermentation_start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Layers size={14} className="text-gray-300" />
                                            <div>
                                                <p className="text-xs text-gray-400">Duration</p>
                                                <p className="text-sm font-bold text-gray-900">{days} day{days !== 1 ? "s" : ""}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Scale size={14} className="text-gray-300" />
                                            <div>
                                                <p className="text-xs text-gray-400">Weight</p>
                                                <p className="text-sm font-bold text-gray-900">{batch.weight_kg ?? "—"} kg</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Package size={14} className="text-gray-300" />
                                            <div>
                                                <p className="text-xs text-gray-400">Quality</p>
                                                <p className="text-sm font-bold text-gray-900">
                                                    {sorting ? `${sorting.good_pct.toFixed(0)}% Good` : "Pending"}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Sorting progress (if data exists) */}
                                    {sorting && sorting.total_sorted > 0 && (
                                        <div className="mb-4">
                                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                                                <span>{sorting.good_count} good · {sorting.poor_count} poor</span>
                                                <span>{sorting.total_sorted} sorted</span>
                                            </div>
                                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-gray-900 transition-all"
                                                    style={{ width: `${sorting.good_pct}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Notes */}
                                    {batch.notes && (
                                        <p className="text-xs text-gray-400 mb-4 italic">"{batch.notes}"</p>
                                    )}

                                    {/* Action: Transition to next state */}
                                    {nextStatus && nextCfg && (
                                        <button
                                            onClick={() => transitionBatch(batch.id, nextStatus)}
                                            disabled={transitioning === batch.id}
                                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-bold text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
                                        >
                                            {transitioning === batch.id ? (
                                                <Loader2 size={16} className="animate-spin" />
                                            ) : (
                                                <>
                                                    Move to {nextCfg.label}
                                                    <ArrowRight size={16} />
                                                </>
                                            )}
                                        </button>
                                    )}

                                    {/* Timeline - status flow */}
                                    <div className="flex items-center justify-center gap-2 mt-4">
                                        {STATUS_FLOW.map((s, i) => {
                                            const sCfg = STATUS_CONFIG[s];
                                            const reached = STATUS_FLOW.indexOf(batch.status as any) >= i;
                                            return (
                                                <div key={s} className="flex items-center gap-2">
                                                    <div className={`h-2 w-2 rounded-full ${reached ? sCfg.dot : "bg-gray-200"}`} />
                                                    <span className={`text-xs font-medium ${reached ? sCfg.color : "text-gray-300"}`}>
                                                        {sCfg.label}
                                                    </span>
                                                    {i < STATUS_FLOW.length - 1 && (
                                                        <div className={`w-6 h-[1px] ${reached ? "bg-gray-300" : "bg-gray-200"}`} />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </motion.div>
                )}
            </motion.main>

            <BottomNav />
        </div>
    );
}
