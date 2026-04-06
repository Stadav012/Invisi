"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import {
    User as UserIcon,
    Mail,
    MapPin,
    Calendar,
    Package,
    Leaf,
    LogOut,
    Shield,
    Bell,
    Moon,
    Wifi,
    HardDrive,
    ChevronRight,
    Pencil,
} from "lucide-react";

interface Batch {
    id: string;
    status: string;
    weight_kg: number | null;
    created_at: string;
}

function SettingRow({
    icon: Icon,
    label,
    value,
    action,
}: {
    icon: typeof Shield;
    label: string;
    value?: string;
    action?: () => void;
}) {
    return (
        <button
            onClick={action}
            className="w-full flex items-center justify-between py-4 px-1 hover:bg-gray-50 rounded-xl transition-colors -mx-1 px-3"
        >
            <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500">
                    <Icon size={18} />
                </div>
                <span className="text-sm font-medium text-gray-900">{label}</span>
            </div>
            <div className="flex items-center gap-2">
                {value && <span className="text-sm text-gray-400">{value}</span>}
                <ChevronRight size={16} className="text-gray-300" />
            </div>
        </button>
    );
}

export default function ProfilePage() {
    const [user, setUser] = useState<User | null>(null);
    const [batches, setBatches] = useState<Batch[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUser(user);
            setLoading(false);
        });

        fetch("/api/batches")
            .then((r) => r.json())
            .then(setBatches)
            .catch(() => {});
    }, []);

    const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Farmer";
    const initials = displayName
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

    const totalBatches = batches.length;
    const activeBatches = batches.filter((b) => b.status === "fermenting").length;
    const totalWeight = batches.reduce((acc, b) => acc + (b.weight_kg || 0), 0);
    const memberSince = user?.created_at
        ? new Date(user.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })
        : "—";

    if (loading) {
        return (
            <div className="min-h-screen bg-[#F8F7F4] flex items-center justify-center">
                <div className="h-8 w-8 border-2 border-[#2D6A4F] border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F8F7F4]">
            <Header />

            <motion.main
                initial="hidden"
                animate="visible"
                variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
                className="max-w-3xl mx-auto px-6 md:px-10 py-8 pb-32"
            >
                {/* Profile Header */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="bg-gradient-to-br from-[#2D6A4F] to-[#1B4D3A] rounded-3xl p-8 text-white mb-8 relative overflow-hidden"
                >
                    {/* Decorative pattern */}
                    <div className="absolute inset-0 opacity-5">
                        <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-white" />
                        <div className="absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-white" />
                    </div>

                    <div className="relative flex items-center gap-6">
                        <div className="h-20 w-20 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/20">
                            <span className="text-3xl font-bold">{initials}</span>
                        </div>
                        <div className="flex-1">
                            <h1 className="text-2xl font-bold">{displayName}</h1>
                            <div className="flex items-center gap-2 mt-1 text-white/70">
                                <Mail size={14} />
                                <span className="text-sm">{user?.email}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-white/60">
                                <Calendar size={14} />
                                <span className="text-xs">Member since {memberSince}</span>
                            </div>
                        </div>
                        <button className="h-10 w-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors border border-white/10">
                            <Pencil size={16} />
                        </button>
                    </div>

                    {/* Quick Stats */}
                    <div className="relative grid grid-cols-3 gap-4 mt-8 pt-6 border-t border-white/10">
                        {[
                            { label: "Batches", value: totalBatches, icon: Package },
                            { label: "Active", value: activeBatches, icon: Leaf },
                            { label: "Total (kg)", value: totalWeight.toFixed(0), icon: MapPin },
                        ].map((stat) => (
                            <div key={stat.label} className="text-center">
                                <p className="text-2xl font-bold">{stat.value}</p>
                                <p className="text-xs text-white/60 mt-0.5">{stat.label}</p>
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* Account Settings */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-6"
                >
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">
                        Account
                    </h3>
                    <div className="divide-y divide-gray-50">
                        <SettingRow icon={UserIcon} label="Full Name" value={displayName} />
                        <SettingRow icon={Mail} label="Email" value={user?.email} />
                        <SettingRow icon={Shield} label="Password" value="••••••••" />
                        <SettingRow icon={MapPin} label="Farm Location" value="Set location" />
                    </div>
                </motion.div>

                {/* System Settings */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-6"
                >
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">
                        System
                    </h3>
                    <div className="divide-y divide-gray-50">
                        <SettingRow icon={Wifi} label="Edge Pipeline" value="localhost:10000" />
                        <SettingRow icon={HardDrive} label="Redis Cache" value="localhost:6379" />
                        <SettingRow icon={Bell} label="Notifications" value="Enabled" />
                        <SettingRow icon={Moon} label="Appearance" value="Light" />
                    </div>
                </motion.div>

                {/* Recent Batches */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                    className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-6"
                >
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">
                        Recent Batches
                    </h3>
                    {batches.length === 0 ? (
                        <p className="text-center text-gray-300 text-sm py-8">No batches yet</p>
                    ) : (
                        <div className="space-y-3">
                            {batches.slice(0, 5).map((batch) => (
                                <div
                                    key={batch.id}
                                    className="flex items-center justify-between py-2"
                                >
                                    <div className="flex items-center gap-3">
                                        <div
                                            className={`h-2 w-2 rounded-full ${
                                                batch.status === "fermenting"
                                                    ? "bg-green-500"
                                                    : batch.status === "drying"
                                                    ? "bg-amber-500"
                                                    : "bg-gray-300"
                                            }`}
                                        />
                                        <span className="text-sm font-medium text-gray-900">
                                            Batch #{batch.id.slice(0, 8)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-gray-400">
                                        <span>{batch.weight_kg ?? "—"} kg</span>
                                        <span className="capitalize">{batch.status}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </motion.div>

                {/* Sign Out */}
                <motion.div
                    variants={{ hidden: { y: 20, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
                >
                    <form action="/auth/signout" method="post">
                        <button
                            type="submit"
                            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl border-2 border-red-100 text-red-600 font-bold text-sm hover:bg-red-50 transition-colors"
                        >
                            <LogOut size={18} />
                            Sign Out
                        </button>
                    </form>
                </motion.div>
            </motion.main>

            <BottomNav />
        </div>
    );
}
