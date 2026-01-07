import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
    label: string;
    value: string;
    subtext: string;
    icon: LucideIcon;
    iconColorClass?: string;
    iconBgClass?: string;
    trend?: {
        value: string;
        isPositive: boolean;
    };
}

export function StatsCard({
    label,
    value,
    subtext,
    icon: Icon,
    iconColorClass = "text-gray-600",
    iconBgClass = "bg-gray-100",
    trend
}: StatsCardProps) {
    return (
        <motion.div
            whileHover={{ scale: 1.02 }}
            transition={{ type: "spring", stiffness: 300 }}
            className="flex flex-col justify-between rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        >
            <div className="flex items-start justify-between">
                <span className="text-sm font-medium text-gray-500">{label}</span>
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${iconBgClass}`}>
                    <Icon size={20} className={iconColorClass} />
                </div>
            </div>

            <div className="mt-6">
                <div className="flex items-end gap-3">
                    <h3 className="text-3xl font-bold text-gray-900">{value}</h3>
                    {trend && (
                        <span className={`flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${trend.isPositive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                            {trend.isPositive ? '↗' : '↘'} {trend.value}
                        </span>
                    )}
                </div>
                <p className="mt-1 text-sm text-gray-400">{subtext}</p>
            </div>
        </motion.div>
    );
}
