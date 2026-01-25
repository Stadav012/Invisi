"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { PodView } from "@/components/PodView"; // Imported PodView
import { BatchStatus } from "@/components/BatchCard";
import { NewBatchModal, NewBatchData } from "@/components/NewBatchModal";
import { Plus, Thermometer, LucideIcon } from "lucide-react";

interface Batch {
  id: string;
  batchNumber: string;
  dateLabel: string;
  dateValue: string;
  status: BatchStatus;
  metrics: {
    label: string;
    value: string;
    target?: string;
    progress: number;
    subIcon?: LucideIcon;
    subLabel?: string;
  };
}

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Single active batch state (Mock data for demo)
  const [activeBatch, setActiveBatch] = useState<Batch | null>({
    id: "204",
    batchNumber: "Batch #204",
    dateLabel: "Started",
    dateValue: "Oct 12, 2023",
    status: "fermenting",
    metrics: {
      label: "Progress",
      value: "Day 3 of 6",
      progress: 50,
      subIcon: Thermometer,
      subLabel: "45°C Temp"
    }
  });

  // Mock List of recent batches
  const recentBatches: Batch[] = [
    activeBatch as Batch,
    {
      id: "203",
      batchNumber: "Batch #203",
      dateLabel: "Started",
      dateValue: "Oct 08, 2023",
      status: "drying",
      metrics: { label: "Moisture", value: "12%", target: "7%", progress: 80, subLabel: "Humidity Control" }
    },
    {
      id: "202",
      batchNumber: "Batch #202",
      dateLabel: "Started",
      dateValue: "Oct 01, 2023",
      status: "sorting",
      metrics: { label: "Quality Check", value: "Pending", progress: 95, subLabel: "Est. 52 kg" }
    },
    {
      id: "201",
      batchNumber: "Batch #201",
      dateLabel: "Completed",
      dateValue: "Oct 14, 2023",
      status: "ready",
      metrics: { label: "Total Weight", value: "50 kg", progress: 100 }
    }
  ];

  const handleAddNewBatch = (data: NewBatchData) => {
    const newBatch = {
      id: Math.random().toString(36).substr(2, 9),
      batchNumber: `Batch #${Math.floor(Math.random() * 1000)}`,
      dateLabel: "Started",
      dateValue: new Date(data.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      status: "fermenting" as BatchStatus,
      metrics: {
        label: "Initial Stage",
        value: "Day 1 of 5",
        progress: 10,
        subIcon: Thermometer,
        subLabel: "Ambient Temp"
      }
    };
    setActiveBatch(newBatch);
    setIsModalOpen(false);
  };

  return (
    <div className="min-h-screen bg-invisi-light pb-32 font-sans text-gray-900">
      <Header />

      <motion.main
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
        }}
        className="mx-auto max-w-7xl px-6 py-8 md:px-10"
      >
        {/* Main Hub Visualization (Diamond + Stats) */}
        <motion.div
          variants={{ hidden: { scale: 0.95, opacity: 0 }, visible: { scale: 1, opacity: 1 } }}
          className="w-full mb-12 relative z-10"
        >
          {activeBatch ? (
            <PodView batch={activeBatch} />
          ) : (
            <div className="h-[500px] w-full flex items-center justify-center bg-gray-100 rounded-3xl">
              <button onClick={() => setIsModalOpen(true)} className="px-6 py-3 bg-invisi-green text-white rounded-xl font-bold shadow-lg">Start New Batch</button>
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
            {recentBatches.map((batch, i) => (
              <div key={i} className="h-[280px]">
                {batch && (
                  <div className="h-full rounded-2xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
                    {/* Simply mocking the internal BatchCard structure here for speed/demo consistency or reuse component if props match exactly */}
                    <div className="flex items-center justify-between mb-4">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${batch.status === 'fermenting' ? 'bg-orange-100 text-orange-600' : batch.status === 'drying' ? 'bg-blue-100 text-blue-600' : batch.status === 'ready' ? 'bg-green-100 text-green-600' : 'bg-purple-100 text-purple-600'}`}>
                        {/* Icons would ideally be dynamic */}
                        <div className="h-4 w-4 bg-current rounded-full opacity-50" />
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-bold capitalize ${batch.status === 'fermenting' ? 'bg-orange-50 text-orange-700' : batch.status === 'drying' ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-700'}`}>
                        {batch.status}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900">{batch.batchNumber}</h3>
                    <p className="text-xs text-gray-500 mb-6">{batch.dateLabel}: {batch.dateValue}</p>

                    <div className="flex justify-between text-xs font-bold text-gray-700 mb-1">
                      <span>{batch.metrics.label}</span>
                      <span>{batch.metrics.value}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mb-2 overflow-hidden">
                      <div className="bg-gray-900 h-full rounded-full" style={{ width: `${batch.metrics.progress}%` }}></div>
                    </div>
                    <div className="text-xs text-gray-400 flex items-center gap-1">
                      {batch.metrics.subLabel}
                    </div>
                    {batch.status === 'ready' && (
                      <button className="mt-4 w-full py-2 border border-green-600 text-green-700 font-bold text-xs rounded-lg hover:bg-green-50">
                        List on Market
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {/* New Batch Card Placeholder */}
            <div onClick={() => setIsModalOpen(true)} className="h-[280px] border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 transition-colors group">
              <div className="h-12 w-12 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 group-hover:bg-gray-100 transition-colors">
                <Plus size={24} />
              </div>
              <span className="mt-3 text-sm font-bold text-gray-500">Start New Batch</span>
            </div>
          </div>
        </div>

      </motion.main>

      <BottomNav />

      <NewBatchModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddNewBatch}
      />
    </div>
  );
}
