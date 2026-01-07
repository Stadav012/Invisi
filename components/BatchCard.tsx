import { LucideIcon, Thermometer, Droplets, Scale, CircleCheck } from "lucide-react";

export type BatchStatus = 'fermenting' | 'drying' | 'sorting' | 'ready';

interface BatchCardProps {
    id: string;
    batchNumber: string;
    dateLabel: string;
    dateValue: string;
    status: BatchStatus;
    icon: LucideIcon;
    metrics: {
        label: string;
        value: string;
        target?: string;
        progress?: number; // 0-100
        subIcon?: LucideIcon;
        subLabel?: string;
    };
}

export function BatchCard({
    batchNumber,
    dateLabel,
    dateValue,
    status,
    icon: MainIcon,
    metrics
}: BatchCardProps) {

    const statusConfig = {
        fermenting: {
            label: 'Fermenting',
            textClass: 'text-orange-700',
            bgClass: 'bg-orange-50',
            barColor: 'bg-orange-500',
            iconBg: 'bg-orange-100',
            iconColor: 'text-orange-600'
        },
        drying: {
            label: 'Drying',
            textClass: 'text-blue-700',
            bgClass: 'bg-blue-50',
            barColor: 'bg-blue-500',
            iconBg: 'bg-blue-100',
            iconColor: 'text-blue-600'
        },
        sorting: {
            label: 'Sorting',
            textClass: 'text-purple-700',
            bgClass: 'bg-purple-50',
            barColor: 'bg-purple-500',
            iconBg: 'bg-purple-100',
            iconColor: 'text-purple-600'
        },
        ready: {
            label: 'Ready for Sale',
            textClass: 'text-green-700',
            bgClass: 'bg-green-50',
            barColor: 'bg-green-500',
            iconBg: 'bg-green-100',
            iconColor: 'text-green-600'
        }
    };

    const config = statusConfig[status];

    return (
        <div className="flex h-full min-w-[300px] flex-col justify-between rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div className={`flex h-12 w-12 items-center justify-center rounded-full ${config.iconBg}`}>
                    <MainIcon size={24} className={config.iconColor} />
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${config.bgClass} ${config.textClass}`}>
                    {config.label}
                </span>
            </div>

            {/* Info */}
            <div className="mt-6">
                <h3 className="text-xl font-bold text-gray-900">{batchNumber}</h3>
                <p className="text-sm text-gray-500">{dateLabel}: {dateValue}</p>
            </div>

            {/* Metrics / Progress */}
            <div className="mt-8">
                {status === 'ready' ? (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                            <span className="text-sm font-medium text-gray-600">Total Weight</span>
                            <span className="text-lg font-bold text-gray-900">{metrics.value}</span>
                        </div>
                        <button className="w-full rounded-xl border border-green-600 bg-white py-2.5 text-sm font-semibold text-green-700 transition-colors hover:bg-green-50">
                            List on Market
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="mb-2 flex items-center justify-between text-sm">
                            <span className="font-semibold text-gray-700">{metrics.label}</span>
                            <span className="text-gray-500">{metrics.value} {metrics.target && <span className="text-xs">({metrics.target})</span>}</span>
                        </div>

                        {/* Progress Bar */}
                        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                            <div
                                className={`h-full rounded-full ${config.barColor}`}
                                style={{ width: `${metrics.progress}%` }}
                            />
                        </div>

                        {/* Sub Metric */}
                        <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
                            {metrics.subIcon && <metrics.subIcon size={16} />}
                            <span>{metrics.subLabel}</span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
