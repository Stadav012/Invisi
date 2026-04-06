"use client";

import { useState, useEffect } from "react";
import { Eye, CheckCircle, XCircle, Zap, Clock } from "lucide-react";

interface SortingSummary {
    total_sorted: number;
    good_count: number;
    poor_count: number;
    good_pct: number;
    avg_inference_ms: number;
    last_sorted_at: string | null;
}

interface RecentResult {
    prediction: number;
    label: string;
    confidence: number;
    inference_ms: number;
    sorted_at: string;
}

interface SortingStatsProps {
    batchId: string;
}

export function SortingStats({ batchId }: SortingStatsProps) {
    const [summary, setSummary] = useState<SortingSummary | null>(null);
    const [recent, setRecent] = useState<RecentResult[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await fetch(`/api/sorting?batch_id=${batchId}`);
                if (!res.ok) return;
                const data = await res.json();
                setSummary(data.summary);
                setRecent(data.recent);
            } catch { /* silent */ }
            finally { setLoading(false); }
        };

        fetchData();
        const interval = setInterval(fetchData, 30_000);
        return () => clearInterval(interval);
    }, [batchId]);

    if (loading || !summary || summary.total_sorted === 0) {
        return (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 text-center">
                <Eye className="mx-auto text-gray-300 mb-3" size={40} />
                <p className="text-gray-400 font-medium">No sorting data yet</p>
                <p className="text-gray-300 text-sm mt-1">
                    Results will appear here when the optical sorter processes beans
                </p>
            </div>
        );
    }

    const goodPct = summary.good_pct || 0;
    const poorPct = 100 - goodPct;

    return (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-6 pt-6 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-purple-50 flex items-center justify-center">
                        <Eye className="text-purple-500" size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900">Optical Sorting</h3>
                        <p className="text-xs text-gray-400">
                            {summary.total_sorted} beans classified
                        </p>
                    </div>
                </div>
                {summary.last_sorted_at && (
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                        <Clock size={12} />
                        <span>
                            {new Date(summary.last_sorted_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                            })}
                        </span>
                    </div>
                )}
            </div>

            {/* Stats Grid */}
            <div className="px-6 pb-4 grid grid-cols-3 gap-3">
                <div className="bg-green-50 rounded-xl p-3 text-center">
                    <CheckCircle className="mx-auto text-green-500 mb-1" size={18} />
                    <p className="text-2xl font-bold text-green-700">{summary.good_count}</p>
                    <p className="text-xs text-green-600 font-medium">Good</p>
                </div>
                <div className="bg-red-50 rounded-xl p-3 text-center">
                    <XCircle className="mx-auto text-red-500 mb-1" size={18} />
                    <p className="text-2xl font-bold text-red-700">{summary.poor_count}</p>
                    <p className="text-xs text-red-600 font-medium">Poor</p>
                </div>
                <div className="bg-blue-50 rounded-xl p-3 text-center">
                    <Zap className="mx-auto text-blue-500 mb-1" size={18} />
                    <p className="text-2xl font-bold text-blue-700">{summary.avg_inference_ms}ms</p>
                    <p className="text-xs text-blue-600 font-medium">Avg Speed</p>
                </div>
            </div>

            {/* Quality Bar */}
            <div className="px-6 pb-4">
                <div className="flex justify-between text-xs font-bold mb-1">
                    <span className="text-green-600">Good {goodPct}%</span>
                    <span className="text-red-600">Poor {poorPct}%</span>
                </div>
                <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden flex">
                    <div
                        className="bg-green-500 h-full transition-all duration-500"
                        style={{ width: `${goodPct}%` }}
                    />
                    <div
                        className="bg-red-400 h-full transition-all duration-500"
                        style={{ width: `${poorPct}%` }}
                    />
                </div>
            </div>

            {/* Recent Results */}
            {recent.length > 0 && (
                <div className="px-6 pb-6">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                        Recent Classifications
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {recent.map((r, i) => (
                            <div
                                key={i}
                                className={`h-6 w-6 rounded-md flex items-center justify-center text-xs font-bold transition-transform hover:scale-125 cursor-default ${
                                    r.prediction === 1
                                        ? "bg-green-100 text-green-700"
                                        : "bg-red-100 text-red-700"
                                }`}
                                title={`${r.label} (${(r.confidence * 100).toFixed(0)}% conf, ${r.inference_ms.toFixed(0)}ms)`}
                            >
                                {r.prediction === 1 ? "G" : "P"}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
