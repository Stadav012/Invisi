"use client";

import { useState } from "react";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { StatsCard } from "@/components/StatsCard";
import { BatchCard, BatchStatus } from "@/components/BatchCard";
import { NewBatchModal, NewBatchData } from "@/components/NewBatchModal";
import { Layers, Verified, Wallet, Plus, Thermometer, Droplets, Scale, Sun, Wind, CheckCircle2, Bean } from "lucide-react";

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("All");

  const [stats] = useState([
    {
      label: "Total Batches",
      value: "12",
      subtext: "Active in processing",
      icon: Layers,
      iconBgClass: "bg-orange-100",
      iconColorClass: "text-orange-600"
    },
    {
      label: "Avg Quality",
      value: "94%",
      subtext: "Above regional average",
      icon: Verified,
      iconBgClass: "bg-green-100",
      iconColorClass: "text-green-600",
      trend: { value: "2.4%", isPositive: true }
    },
    {
      label: "Total Income",
      value: "₵15,400",
      subtext: "Gross revenue YTD",
      icon: Wallet,
      iconBgClass: "bg-orange-100",
      iconColorClass: "text-orange-600"
    }
  ]);

  interface Batch {
    id: string;
    batchNumber: string;
    dateLabel: string;
    dateValue: string;
    status: BatchStatus;
    icon: any;
    metrics: {
      label: string;
      value: string;
      target?: string;
      progress?: number;
      subIcon?: any;
      subLabel?: string;
    };
  }

  const [batches, setBatches] = useState<Batch[]>([
    {
      id: "204",
      batchNumber: "Batch #204",
      dateLabel: "Started",
      dateValue: "Oct 12, 2023",
      status: "fermenting",
      icon: Bean,
      metrics: {
        label: "Progress",
        value: "Day 3 of 6",
        progress: 50,
        subIcon: Thermometer,
        subLabel: "45°C Temp"
      }
    },
    {
      id: "203",
      batchNumber: "Batch #203",
      dateLabel: "Started",
      dateValue: "Oct 08, 2023",
      status: "drying",
      icon: Sun,
      metrics: {
        label: "Moisture",
        value: "12%",
        target: "Target: 7%",
        progress: 60,
        subIcon: Droplets,
        subLabel: "Humidity Control"
      }
    },
    {
      id: "202",
      batchNumber: "Batch #202",
      dateLabel: "Started",
      dateValue: "Oct 01, 2023",
      status: "sorting",
      icon: Wind,
      metrics: {
        label: "Quality Check",
        value: "Pending",
        progress: 85,
        subIcon: Scale,
        subLabel: "Est. 52 kg"
      }
    },
    {
      id: "201",
      batchNumber: "Batch #201",
      dateLabel: "Completed",
      dateValue: "Oct 14, 2023",
      status: "ready",
      icon: CheckCircle2,
      metrics: {
        label: "Total Weight",
        value: "50 kg"
      }
    }
  ]);

  const handleAddNewBatch = (data: NewBatchData) => {
    const newBatch: Batch = {
      id: Math.random().toString(36).substr(2, 9),
      batchNumber: `Batch #${205 + batches.length}`, // Simple increment logic for demo
      dateLabel: "Started",
      dateValue: new Date(data.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      status: "fermenting",
      icon: Bean,
      metrics: {
        label: "Progress",
        value: "Day 1 of 6",
        progress: 0,
        subIcon: Thermometer,
        subLabel: "Ambient Temp"
      }
    };

    setBatches([newBatch, ...batches]);
    setIsModalOpen(false);
  };

  const filteredBatches = activeTab === "All"
    ? batches
    : batches.filter(b => b.status.toLowerCase() === activeTab.toLowerCase());

  return (
    <div className="min-h-screen bg-invisi-light pb-32 font-sans text-gray-900">
      <Header />

      <main className="mx-auto max-w-7xl px-6 py-8 md:px-10">
        {/* Greeting Section */}
        <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-green-700">
              <Sun size={16} />
              <span>GOOD MORNING</span>
            </div>
            <h1 className="mt-2 text-4xl font-bold tracking-tight text-gray-900">Hello, Kwame</h1>
            <p className="mt-2 text-gray-500">Here's what's happening on your farm today.</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-invisi-green px-6 py-3 font-semibold text-white shadow-lg shadow-green-900/10 transition-transform hover:scale-105 active:scale-95"
          >
            <Plus size={20} />
            Add New Batch
          </button>
        </div>

        {/* Stats Grid */}
        <div className="mb-12 grid gap-6 md:grid-cols-3">
          {stats.map((stat, idx) => (
            <StatsCard key={idx} {...stat} />
          ))}
        </div>

        {/* Batch Status Section */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-gray-900">Batch Status</h2>

          {/* Tabs */}
          <div className="flex items-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-gray-100">
            {['All', 'Fermenting', 'Drying', 'Ready'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${activeTab === tab
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                  }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Batch Grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {filteredBatches.map(batch => (
            <BatchCard key={batch.id} {...batch} />
          ))}

          {/* 'Start New' Dashed Card */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-gray-200 bg-white/50 p-6 text-gray-400 transition-all hover:border-invisi-green hover:bg-green-50/50 hover:text-invisi-green"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm">
              <Plus size={24} />
            </div>
            <span className="font-semibold text-gray-900">Start New Batch</span>
          </button>
        </div>
      </main>

      <BottomNav />

      <NewBatchModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddNewBatch}
      />
    </div>
  );
}
