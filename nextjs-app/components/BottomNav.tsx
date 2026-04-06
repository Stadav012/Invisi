"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, Sprout, Layers, User, Zap } from "lucide-react";

const navItems = [
    { label: "Home", icon: LayoutGrid, href: "/" },
    { label: "Monitor", icon: Sprout, href: "/monitor" },
    { label: "Batches", icon: Layers, href: "/market" },
    { label: "Profile", icon: User, href: "/profile" },
];

export function BottomNav() {
    const pathname = usePathname();

    return (
        <div className="fixed bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#2C211A] p-1.5 shadow-2xl">
            {navItems.map((item) => {
                const active = pathname === item.href;
                return (
                    <Link
                        key={item.label}
                        href={item.href}
                        className={`flex items-center gap-2 rounded-full px-4 py-2.5 transition-all ${
                            active
                                ? "bg-invisi-green text-white shadow-lg"
                                : "text-gray-400 hover:bg-white/10 hover:text-white"
                        }`}
                    >
                        <item.icon size={18} />
                        {active && <span className="text-sm font-medium">{item.label}</span>}
                    </Link>
                );
            })}

            <div className="px-2">
                <div className="h-6 w-[1px] bg-white/20" />
            </div>

            <Link
                href="/monitor"
                className="rounded-full p-2.5 text-orange-400 hover:bg-white/10 hover:text-orange-300 transition-colors"
            >
                <Zap size={20} fill="currentColor" />
            </Link>
        </div>
    );
}
