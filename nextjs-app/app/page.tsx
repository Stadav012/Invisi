"use client";

import { motion } from "framer-motion";
import { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { PodView } from "@/components/PodView";
import { BatchStatus } from "@/components/BatchCard";
import { NewBatchModal, NewBatchData } from "@/components/NewBatchModal";
import { Plus, Thermometer, Loader2, Sprout, Trash2 } from "lucide-react";

interface Batch {
  id: string;
  batch_number: string;
  status: BatchStatus;
  weight_kg: number | null;
  variety: string;
  notes: string | null;
  fermentation_start_date: string;
  recording_interval_mins: number;
  created_at: string;
  updated_at: string;
}

interface SensorReading {
  temp_center: number | null;
  temp_left: number | null;
  temp_right: number | null;
  gas_left: number | null;
  gas_right: number | null;
  // Legacy fields
  temperature: number | null;
  humidity: number | null;
  ph: number | null;
  co2: number | null;
  recorded_at: string;
}

function daysSince(dateStr: string): number {
  const start = new Date(dateStr);
  const now = new Date();
  return Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

function batchToMetrics(batch: Batch, liveReading?: SensorReading | null) {
  const days = daysSince(batch.fermentation_start_date);
  const totalDays = 6;

  switch (batch.status) {
    case "fermenting": {
      const temp = liveReading?.temp_center ?? liveReading?.temperature ?? null;
      const tempLabel = temp !== null ? `${temp}°C Core` : "Awaiting data...";
      return {
        label: "Progress",
        value: `Day ${days} of ${totalDays}`,
        progress: Math.min(100, (days / totalDays) * 100),
        subIcon: Thermometer,
        subLabel: tempLabel,
      };
    }
    case "drying":
      return {
        label: "Moisture",
        value: "12%",
        target: "7%",
        progress: 80,
        subLabel: "Humidity Control",
      };
    case "sorting":
      return {
        label: "Quality Check",
        value: "Pending",
        progress: 95,
        subLabel: batch.weight_kg ? `Est. ${batch.weight_kg} kg` : undefined,
      };
    case "ready":
      return {
        label: "Total Weight",
        value: batch.weight_kg ? `${batch.weight_kg} kg` : "—",
        progress: 100,
      };
    default:
      return { label: "Status", value: batch.status, progress: 0 };
  }
}

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveReading, setLiveReading] = useState<SensorReading | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBatches = useCallback(async () => {
    try {
      const res = await fetch("/api/batches");
      if (!res.ok) throw new Error("Failed to fetch batches");
      const data = await res.json();
      setBatches(data);
    } catch (err) {
      console.error("Error fetching batches:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  const activeBatch = batches.find((b) => b.status === "fermenting") || null;

  // Poll live sensor readings for the active batch
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!activeBatch) {
      setLiveReading(null);
      return;
    }

    const fetchReading = async () => {
      try {
        const res = await fetch(`/api/readings?batch_id=${activeBatch.id}&limit=1`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.length > 0) setLiveReading(data[0]);
      } catch { /* silent */ }
    };

    fetchReading();
    pollRef.current = setInterval(fetchReading, 10_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeBatch?.id]);

  const handleAddNewBatch = async (data: NewBatchData) => {
    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create batch");
      await fetchBatches();
      setIsModalOpen(false);
    } catch (err) {
      console.error("Error creating batch:", err);
    }
  };

  const handleDeleteBatch = async (id: string) => {
    try {
      const res = await fetch(`/api/batches/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete batch");
      await fetchBatches();
    } catch (err) {
      console.error("Error deleting batch:", err);
    }
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
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
        }}
        className="mx-auto max-w-7xl px-6 py-8 md:px-10"
      >
        {/* Main Hub Visualization — only if fermenting */}
        <motion.div
          variants={{ hidden: { scale: 0.95, opacity: 0 }, visible: { scale: 1, opacity: 1 } }}
          className="w-full mb-12 relative z-10"
        >
          {activeBatch ? (
            <PodView
              batch={{
                status: activeBatch.status,
                metrics: batchToMetrics(activeBatch, liveReading),
                liveData: liveReading ? {
                  temp_center: liveReading.temp_center,
                  temp_left: liveReading.temp_left,
                  temp_right: liveReading.temp_right,
                  gas_left: liveReading.gas_left,
                  gas_right: liveReading.gas_right,
                } : null,
              }}
            />
          ) : (
            <div className="h-[320px] w-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 rounded-3xl border-2 border-dashed border-gray-200">
              <div className="h-16 w-16 bg-gray-100 rounded-full flex items-center justify-center text-gray-400 mb-4">
                <Sprout size={32} />
              </div>
              <p className="text-gray-500 font-medium mb-4">No active fermentation</p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="px-6 py-3 bg-invisi-green text-white rounded-xl font-bold shadow-lg hover:scale-105 transition-transform"
              >
                Start New Batch
              </button>
            </div>
          )}
        </motion.div>

        {/* Batch Status List */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Batch Status</h2>
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-gray-900 text-white text-xs font-bold rounded-lg">All</span>
              <span className="px-3 py-1 text-gray-500 text-xs font-medium hover:bg-gray-100 rounded-lg cursor-pointer">Fermenting</span>
              <span className="px-3 py-1 text-gray-500 text-xs font-medium hover:bg-gray-100 rounded-lg cursor-pointer">Drying</span>
              <span className="px-3 py-1 text-gray-500 text-xs font-medium hover:bg-gray-100 rounded-lg cursor-pointer">Ready</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {batches.map((batch) => {
              const metrics = batchToMetrics(batch);
              const dateLabel = batch.status === "ready" ? "Completed" : "Started";
              const dateValue = new Date(batch.fermentation_start_date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              });

              return (
                <div key={batch.id} className="h-[280px]">
                  <div className="h-full rounded-2xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-4">
                      <div
                        className={`h-10 w-10 rounded-full flex items-center justify-center ${batch.status === "fermenting"
                          ? "bg-orange-100 text-orange-600"
                          : batch.status === "drying"
                            ? "bg-blue-100 text-blue-600"
                            : batch.status === "ready"
                              ? "bg-green-100 text-green-600"
                              : "bg-purple-100 text-purple-600"
                          }`}
                      >
                        <div className="h-4 w-4 bg-current rounded-full opacity-50" />
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-1 rounded text-xs font-bold capitalize ${batch.status === "fermenting"
                            ? "bg-orange-50 text-orange-700"
                            : batch.status === "drying"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-gray-50 text-gray-700"
                            }`}
                        >
                          {batch.status}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteBatch(batch.id);
                          }}
                          className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Delete batch"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900">{batch.batch_number}</h3>
                    <p className="text-xs text-gray-500 mb-6">
                      {dateLabel}: {dateValue}
                    </p>

                    <div className="flex justify-between text-xs font-bold text-gray-700 mb-1">
                      <span>{metrics.label}</span>
                      <span>{metrics.value}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mb-2 overflow-hidden">
                      <div className="bg-gray-900 h-full rounded-full" style={{ width: `${metrics.progress}%` }} />
                    </div>
                    <div className="text-xs text-gray-400 flex items-center gap-1">{metrics.subLabel}</div>
                    {batch.status === "ready" && (
                      <button className="mt-4 w-full py-2 border border-green-600 text-green-700 font-bold text-xs rounded-lg hover:bg-green-50">
                        List on Market
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* New Batch Card */}
            <div
              onClick={() => setIsModalOpen(true)}
              className="h-[280px] border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 transition-colors group"
            >
              <div className="h-12 w-12 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 group-hover:bg-gray-100 transition-colors">
                <Plus size={24} />
              </div>
              <span className="mt-3 text-sm font-bold text-gray-500">Start New Batch</span>
            </div>
          </div>
        </div>
      </motion.main>

      <BottomNav />

      <NewBatchModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSubmit={handleAddNewBatch} />
    </div>
  );
}
