"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import {
    Store,
    Award,
    BarChart3,
    FileText,
    ExternalLink,
    TrendingUp,
    Package,
    ShieldCheck,
    Leaf,
    CheckCircle2,
} from "lucide-react";

interface Batch {
    id: string;
    batch_number: string;
    variety: string;
    weight_kg: number | null;
    status: string;
    fermentation_start_date: string;
    created_at: string;
}

interface SortingSummary {
    total_sorted: number;
    good_count: number;
    poor_count: number;
    good_pct: number;
    avg_inference_ms: number;
}

const QUALITY_TIERS = [
    {
        grade: "Premium",
        minPct: 85,
        color: "text-green-700",
        bg: "bg-green-50",
        border: "border-green-200",
        badge: "bg-green-600",
    },
    {
        grade: "Standard",
        minPct: 60,
        color: "text-amber-700",
        bg: "bg-amber-50",
        border: "border-amber-200",
        badge: "bg-amber-500",
    },
    {
        grade: "Below Grade",
        minPct: 0,
        color: "text-red-700",
        bg: "bg-red-50",
        border: "border-red-200",
        badge: "bg-red-500",
    },
];

function getGrade(goodPct: number) {
    return QUALITY_TIERS.find((t) => goodPct >= t.minPct) || QUALITY_TIERS[2];
}

export default function MarketPage() {
    const [batches, setBatches] = useState<Batch[]>([]);
    const [sortingMap, setSortingMap] = useState<Record<string, SortingSummary>>({});

    useEffect(() => {
        fetch("/api/batches")
            .then((r) => r.json())
            .then(async (data: Batch[]) => {
                setBatches(data);
                const map: Record<string, SortingSummary> = {};
                await Promise.all(
                    data.map(async (b) => {
                        try {
                            const res = await fetch(`/api/sorting?batch_id=${b.id}`);
                            if (res.ok) {
                                const { summary } = await res.json();
                                map[b.id] = summary;
                            }
                        } catch {}
                    }),
                );
                setSortingMap(map);
            })
            .catch(() => {});
    }, []);

    const completedBatches = batches.filter((b) => b.status === "completed" || b.status === "drying");
    const activeBatches = batches.filter((b) => b.status === "fermenting");

    const totalWeight = batches.reduce((acc, b) => acc + (b.weight_kg || 0), 0);
    const avgQuality =
        Object.values(sortingMap).length > 0
            ? Object.values(sortingMap).reduce((a, s) => a + s.good_pct, 0) / Object.values(sortingMap).length
            : 0;

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
                    <h1 className="text-3xl font-bold text-gray-900">Market & Traceability</h1>
                    <p className="text-gray-500 mt-1">Quality grading, certifications, and batch traceability</p>
                </motion.div>

                {/* Overview Stats */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
                >
                    {[
                        {
                            label: "Total Batches",
                            value: batches.length,
                            icon: Package,
                            color: "bg-[#2D6A4F]",
                        },
                        {
                            label: "Total Weight",
                            value: `${totalWeight.toFixed(0)} kg`,
                            icon: BarChart3,
                            color: "bg-amber-600",
                        },
                        {
                            label: "Avg Quality",
                            value: avgQuality > 0 ? `${avgQuality.toFixed(0)}%` : "—",
                            icon: TrendingUp,
                            color: "bg-purple-600",
                        },
                        {
                            label: "Certifiable",
                            value: Object.values(sortingMap).filter((s) => s.good_pct >= 85).length,
                            icon: ShieldCheck,
                            color: "bg-blue-600",
                        },
                    ].map((stat) => (
                        <div
                            key={stat.label}
                            className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow"
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <div className={`h-9 w-9 rounded-xl ${stat.color} flex items-center justify-center`}>
                                    <stat.icon size={18} className="text-white" />
                                </div>
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                    {stat.label}
                                </span>
                            </div>
                            <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
                        </div>
                    ))}
                </motion.div>

                {/* Active Fermentations */}
                {activeBatches.length > 0 && (
                    <motion.div
                        variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                        className="mb-8"
                    >
                        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">
                            Active Fermentations
                        </h2>
                        <div className="grid md:grid-cols-2 gap-4">
                            {activeBatches.map((batch) => (
                                <div
                                    key={batch.id}
                                    className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-100 p-5"
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-3">
                                            <div className="h-10 w-10 rounded-xl bg-[#2D6A4F] flex items-center justify-center">
                                                <Leaf size={18} className="text-white" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-900">{batch.batch_number}</p>
                                                <p className="text-xs text-gray-500">{batch.variety}</p>
                                            </div>
                                        </div>
                                        <span className="text-xs font-bold text-green-700 bg-green-100 px-3 py-1 rounded-full">
                                            Fermenting
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm text-gray-600">
                                        <span>{batch.weight_kg ?? "—"} kg</span>
                                        <span>Started {new Date(batch.fermentation_start_date).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}

                {/* Batch Quality Cards */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                >
                    <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">
                        Batch Quality Reports
                    </h2>
                    {batches.length === 0 && (
                        <div className="bg-white rounded-3xl border border-gray-100 p-12 text-center">
                            <Store size={40} className="mx-auto text-gray-200 mb-4" />
                            <p className="text-gray-400 font-medium">No batches yet</p>
                            <p className="text-xs text-gray-300 mt-1">Create your first batch from the Home tab</p>
                        </div>
                    )}
                    <div className="space-y-4">
                        {batches.map((batch) => {
                            const sorting = sortingMap[batch.id];
                            const grade = sorting ? getGrade(sorting.good_pct) : null;

                            return (
                                <div
                                    key={batch.id}
                                    className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-all"
                                >
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="h-10 w-10 rounded-xl bg-gray-900 flex items-center justify-center">
                                                <FileText size={18} className="text-white" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-900">{batch.batch_number}</p>
                                                <p className="text-xs text-gray-400">
                                                    {batch.variety} · {batch.weight_kg ?? "—"} kg
                                                </p>
                                            </div>
                                        </div>
                                        {grade && (
                                            <span
                                                className={`text-xs font-bold text-white px-3 py-1 rounded-full ${grade.badge}`}
                                            >
                                                {grade.grade}
                                            </span>
                                        )}
                                    </div>

                                    {sorting && sorting.total_sorted > 0 ? (
                                        <div className="grid grid-cols-4 gap-4">
                                            <div>
                                                <p className="text-xs text-gray-400 mb-0.5">Total Sorted</p>
                                                <p className="text-lg font-bold text-gray-900">{sorting.total_sorted}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-400 mb-0.5">Good Beans</p>
                                                <p className="text-lg font-bold text-green-700">{sorting.good_count}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-400 mb-0.5">Quality</p>
                                                <p className="text-lg font-bold text-gray-900">{sorting.good_pct.toFixed(0)}%</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-400 mb-0.5">Avg Speed</p>
                                                <p className="text-lg font-bold text-gray-900">{sorting.avg_inference_ms.toFixed(0)}ms</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 text-sm text-gray-300">
                                            <Award size={14} />
                                            <span>No sorting data — awaiting optical sorter results</span>
                                        </div>
                                    )}

                                    {/* Quality bar */}
                                    {sorting && sorting.total_sorted > 0 && (
                                        <div className="mt-4">
                                            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all"
                                                    style={{ width: `${sorting.good_pct}%` }}
                                                />
                                            </div>
                                            <div className="flex justify-between text-xs text-gray-400 mt-1">
                                                <span>Quality Score</span>
                                                <span>{sorting.good_pct.toFixed(1)}%</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </motion.div>

                {/* Traceability Info */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="mt-8 bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-8 text-white"
                >
                    <div className="flex items-center gap-4 mb-6">
                        <div className="h-12 w-12 rounded-2xl bg-white/10 flex items-center justify-center">
                            <ShieldCheck size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold">Traceability & Certification</h3>
                            <p className="text-sm text-gray-400">Each batch is tracked from pod to market</p>
                        </div>
                    </div>
                    <div className="grid md:grid-cols-3 gap-4">
                        {[
                            {
                                icon: CheckCircle2,
                                title: "IoT Verified",
                                desc: "Sensor data cryptographically signed at the edge",
                            },
                            {
                                icon: Award,
                                title: "AI Graded",
                                desc: "ResNet50-based optical sorting with confidence scores",
                            },
                            {
                                icon: ExternalLink,
                                title: "Export Ready",
                                desc: "Generate PDF traceability reports per batch",
                            },
                        ].map((item) => (
                            <div key={item.title} className="bg-white/5 rounded-2xl p-4 border border-white/10">
                                <item.icon size={20} className="text-green-400 mb-3" />
                                <p className="font-bold text-sm mb-1">{item.title}</p>
                                <p className="text-xs text-gray-400">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </motion.div>
            </motion.main>

            <BottomNav />
        </div>
    );
}
