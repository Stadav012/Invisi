import { LayoutGrid, Sprout, Store, User, Zap } from "lucide-react";

export function BottomNav() {
    const navItems = [
        { label: "Home", icon: LayoutGrid, active: true },
        { label: "Monitor", icon: Sprout, active: false },
        { label: "Market", icon: Store, active: false },
        { label: "Profile", icon: User, active: false },
    ];

    return (
        <div className="fixed bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#2C211A] p-1.5 shadow-2xl">
            {navItems.map((item) => (
                <button
                    key={item.label}
                    className={`flex items-center gap-2 rounded-full px-4 py-2.5 transition-all ${item.active
                            ? "bg-invisi-green text-white shadow-lg"
                            : "text-gray-400 hover:bg-white/10 hover:text-white"
                        }`}
                >
                    <item.icon size={18} />
                    {item.active && <span className="text-sm font-medium">{item.label}</span>}
                </button>
            ))}

            <div className="px-2">
                <div className="h-6 w-[1px] bg-white/20" />
            </div>

            <button className="rounded-full p-2.5 text-orange-400 hover:bg-white/10 hover:text-orange-300">
                <Zap size={20} fill="currentColor" />
            </button>
        </div>
    );
}
