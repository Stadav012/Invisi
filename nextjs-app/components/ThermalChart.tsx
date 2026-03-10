"use client";

import {
    ResponsiveContainer,
    AreaChart,
    Area,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from "recharts";
import { Thermometer, Wind, TrendingUp } from "lucide-react";

interface HourlyReading {
    hour: string;
    avg_temp_center: number | null;
    avg_temp_left: number | null;
    avg_temp_right: number | null;
    avg_gas_left: number | null;
    avg_gas_right: number | null;
    max_gradient: number | null;
    reading_count: number;
}

interface ThermalChartProps {
    data: HourlyReading[];
}

function formatHour(iso: string) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDay(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatLabel(iso: string) {
    const d = new Date(iso);
    const day = d.toLocaleDateString([], { month: "short", day: "numeric" });
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
    return `${day} ${time}`;
}

function CustomTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;

    return (
        <div className="bg-gray-900/95 backdrop-blur-sm rounded-xl px-4 py-3 shadow-2xl border border-white/10">
            <p className="text-white/60 text-xs font-medium mb-2">{formatLabel(label)}</p>
            {payload.map((entry: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                    <span className="text-white/70">{entry.name}:</span>
                    <span className="text-white font-bold">
                        {entry.value != null ? (
                            entry.name.includes("Gas") ? entry.value : `${entry.value}°C`
                        ) : "—"}
                    </span>
                </div>
            ))}
        </div>
    );
}

export function ThermalChart({ data }: ThermalChartProps) {
    if (!data || data.length === 0) {
        return (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 text-center">
                <Thermometer className="mx-auto text-gray-300 mb-3" size={40} />
                <p className="text-gray-400 font-medium">No thermal data yet</p>
                <p className="text-gray-300 text-sm mt-1">Readings will appear here as your pod reports</p>
            </div>
        );
    }

    // Compute current gradient for the header badge
    const latest = data[data.length - 1];
    let currentGradient: number | null = null;
    if (latest.avg_temp_center != null) {
        const edges: number[] = [];
        if (latest.avg_temp_left != null) edges.push(latest.avg_temp_left);
        if (latest.avg_temp_right != null) edges.push(latest.avg_temp_right);
        if (edges.length > 0) {
            const edgeAvg = edges.reduce((a, b) => a + b, 0) / edges.length;
            currentGradient = parseFloat((latest.avg_temp_center - edgeAvg).toFixed(1));
        }
    }

    const chartData = data.map(d => ({
        hour: d.hour,
        "Center": d.avg_temp_center,
        "Left Edge": d.avg_temp_left,
        "Right Edge": d.avg_temp_right,
        "Gas Left": d.avg_gas_left,
        "Gas Right": d.avg_gas_right,
        gradient: d.max_gradient != null ? parseFloat(Number(d.max_gradient).toFixed(1)) : null,
    }));

    const needsTurning = currentGradient != null && currentGradient > 5;

    return (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-6 pt-6 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-orange-50 flex items-center justify-center">
                        <TrendingUp className="text-orange-500" size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900">Thermal Analysis</h3>
                        <p className="text-xs text-gray-400">{data.length} hourly readings</p>
                    </div>
                </div>
                {currentGradient != null && (
                    <div className={`px-4 py-2 rounded-xl text-sm font-bold ${needsTurning
                            ? "bg-red-50 text-red-600 border border-red-200"
                            : "bg-green-50 text-green-600 border border-green-200"
                        }`}>
                        Δ {currentGradient}°C {needsTurning ? "⚠ Turn" : "✓ Uniform"}
                    </div>
                )}
            </div>

            {/* Temperature Chart */}
            <div className="px-4 pb-2">
                <div className="flex items-center gap-2 px-2 mb-2">
                    <Thermometer className="text-orange-400" size={14} />
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Temperature Map</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <defs>
                            <linearGradient id="gradCenter" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="gradEdge" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis
                            dataKey="hour"
                            tickFormatter={formatHour}
                            tick={{ fontSize: 10, fill: "#94a3b8" }}
                            axisLine={{ stroke: "#e2e8f0" }}
                            tickLine={false}
                        />
                        <YAxis
                            tick={{ fontSize: 10, fill: "#94a3b8" }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => `${v}°`}
                            domain={["dataMin - 2", "dataMax + 2"]}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend
                            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                            iconType="circle"
                            iconSize={8}
                        />
                        <Area
                            type="monotone"
                            dataKey="Center"
                            stroke="#f97316"
                            strokeWidth={2.5}
                            fill="url(#gradCenter)"
                            dot={false}
                            activeDot={{ r: 4, strokeWidth: 0, fill: "#f97316" }}
                        />
                        <Area
                            type="monotone"
                            dataKey="Left Edge"
                            stroke="#3b82f6"
                            strokeWidth={1.5}
                            fill="url(#gradEdge)"
                            dot={false}
                            activeDot={{ r: 3, strokeWidth: 0, fill: "#3b82f6" }}
                        />
                        <Area
                            type="monotone"
                            dataKey="Right Edge"
                            stroke="#60a5fa"
                            strokeWidth={1.5}
                            strokeDasharray="4 3"
                            fill="none"
                            dot={false}
                            activeDot={{ r: 3, strokeWidth: 0, fill: "#60a5fa" }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Gas Activity Chart */}
            <div className="px-4 pb-6">
                <div className="flex items-center gap-2 px-2 mb-2">
                    <Wind className="text-green-400" size={14} />
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Gas Activity</span>
                </div>
                <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis
                            dataKey="hour"
                            tickFormatter={formatHour}
                            tick={{ fontSize: 10, fill: "#94a3b8" }}
                            axisLine={{ stroke: "#e2e8f0" }}
                            tickLine={false}
                        />
                        <YAxis
                            tick={{ fontSize: 10, fill: "#94a3b8" }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend
                            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                            iconType="circle"
                            iconSize={8}
                        />
                        <Bar dataKey="Gas Left" fill="#22c55e" radius={[3, 3, 0, 0]} opacity={0.8} />
                        <Bar dataKey="Gas Right" fill="#86efac" radius={[3, 3, 0, 0]} opacity={0.8} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
