"use client";

import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X, RotateCw } from "lucide-react";

interface TurnAlertProps {
    gradient: number;
    onDismiss: () => void;
}

export function TurnAlert({ gradient, onDismiss }: TurnAlertProps) {
    return (
        <AnimatePresence>
            <motion.div
                initial={{ y: -80, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -80, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="fixed top-0 left-0 right-0 z-50"
            >
                <div className="mx-auto max-w-7xl px-4 pt-4">
                    <div
                        className="relative overflow-hidden rounded-2xl shadow-2xl"
                        style={{
                            background: gradient > 8
                                ? "linear-gradient(135deg, #dc2626 0%, #f97316 100%)"
                                : "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)",
                        }}
                    >
                        {/* Pulse overlay */}
                        <div className="absolute inset-0 animate-pulse opacity-20 bg-white rounded-2xl" />

                        <div className="relative flex items-center justify-between px-6 py-4">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center justify-center h-12 w-12 rounded-full bg-white/20 backdrop-blur-sm">
                                    <RotateCw className="text-white animate-spin" size={24} style={{ animationDuration: "3s" }} />
                                </div>
                                <div>
                                    <p className="text-white font-bold text-lg tracking-tight">
                                        Turning Recommended
                                    </p>
                                    <p className="text-white/80 text-sm">
                                        Thermal gradient is <span className="font-bold text-white">Δ {gradient.toFixed(1)}°C</span> — beans need mixing for even fermentation
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={onDismiss}
                                className="flex items-center justify-center h-8 w-8 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                            >
                                <X className="text-white" size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
