import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sprout, Weight, Calendar, FileText, CheckCircle2 } from "lucide-react";

interface NewBatchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: NewBatchData) => void;
}

export interface NewBatchData {
    weight: string;
    variety: string;
    date: string;
    notes: string;
}

export function NewBatchModal({ isOpen, onClose, onSubmit }: NewBatchModalProps) {
    const [formData, setFormData] = useState<NewBatchData>({
        weight: "",
        variety: "Amelonado",
        date: new Date().toISOString().split("T")[0],
        notes: ""
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
        // Reset form after a short delay or controlled by parent, but for now just submit
        setFormData({
            weight: "",
            variety: "Amelonado",
            date: new Date().toISOString().split("T")[0],
            notes: ""
        });
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                    />

                    {/* Modal Content */}
                    <motion.div
                        initial={{ y: 50, opacity: 0, scale: 0.95 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 50, opacity: 0, scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white p-0 shadow-2xl"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                                    <Sprout size={20} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900">New Batch</h3>
                                    <p className="text-xs text-gray-500">Kickoff fermentation</p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleSubmit} className="px-6 py-6">
                            <div className="space-y-5">
                                {/* Weight Input */}
                                <div>
                                    <label className="mb-1.5 block text-sm font-semibold text-gray-700">Total Weight (kg)</label>
                                    <div className="relative">
                                        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                            <Weight size={18} />
                                        </div>
                                        <input
                                            type="number"
                                            required
                                            placeholder="e.g. 150"
                                            value={formData.weight}
                                            onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                                            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-10 pr-4 text-gray-900 outline-none transition-all focus:border-invisi-green focus:bg-white focus:ring-2 focus:ring-green-500/10"
                                        />
                                    </div>
                                </div>

                                {/* Variety & Date Row */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="mb-1.5 block text-sm font-semibold text-gray-700">Variety</label>
                                        <select
                                            value={formData.variety}
                                            onChange={(e) => setFormData({ ...formData, variety: e.target.value })}
                                            className="w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 outline-none transition-all focus:border-invisi-green focus:bg-white focus:ring-2 focus:ring-green-500/10"
                                        >
                                            <option>Amelonado</option>
                                            <option>Amazonia</option>
                                            <option>Trinitario</option>
                                            <option>Criollo</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-sm font-semibold text-gray-700">Start Date</label>
                                        <div className="relative">
                                            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                                <Calendar size={18} />
                                            </div>
                                            <input
                                                type="date"
                                                required
                                                value={formData.date}
                                                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-10 pr-4 text-gray-900 outline-none transition-all focus:border-invisi-green focus:bg-white focus:ring-2 focus:ring-green-500/10"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Notes */}
                                <div>
                                    <label className="mb-1.5 block text-sm font-semibold text-gray-700">Notes (Optional)</label>
                                    <div className="relative">
                                        <div className="pointer-events-none absolute left-3 top-3 text-gray-400">
                                            <FileText size={18} />
                                        </div>
                                        <textarea
                                            rows={3}
                                            placeholder="Any observations about this harvest..."
                                            value={formData.notes}
                                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-10 pr-4 text-gray-900 outline-none transition-all focus:border-invisi-green focus:bg-white focus:ring-2 focus:ring-green-500/10"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Footer Actions */}
                            <div className="mt-8 flex items-center justify-end gap-3 border-t border-gray-100 pt-5">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex items-center gap-2 rounded-xl bg-invisi-green px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-green-900/10 transition-transform hover:scale-105 active:scale-95"
                                >
                                    <CheckCircle2 size={18} />
                                    Start Fermentation
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
