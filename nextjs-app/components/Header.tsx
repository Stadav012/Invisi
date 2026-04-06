"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Bell, ChevronDown, Leaf, LogOut, User as UserIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export function Header() {
    const [user, setUser] = useState<User | null>(null);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data: { user } }) => setUser(user));

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, []);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Farmer";
    const initials = displayName
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

    return (
        <header className="sticky top-0 z-50 flex h-20 w-full items-center justify-between border-b border-gray-100 bg-white px-6 md:px-10">
            {/* Logo */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-invisi-green text-white">
                    <Leaf size={20} fill="currentColor" />
                </div>
                <span className="text-xl font-bold text-gray-900">Invisi</span>
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-6">
                <button className="text-gray-400 hover:text-gray-600">
                    <Search size={22} />
                </button>
                <button className="relative text-gray-400 hover:text-gray-600">
                    <Bell size={22} />
                    <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
                </button>

                <div className="h-8 w-[1px] bg-gray-200" />

                {/* User dropdown */}
                <div className="relative" ref={dropdownRef}>
                    <div
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                    >
                        <div className="h-10 w-10 overflow-hidden rounded-full border-2 border-green-100 bg-[#2D6A4F] flex items-center justify-center">
                            <span className="text-white font-bold text-sm">{initials}</span>
                        </div>
                        <div className="hidden text-sm md:block">
                            <p className="font-semibold text-gray-900">{displayName}</p>
                            <p className="text-xs text-gray-500">Farmer</p>
                        </div>
                        <ChevronDown
                            size={16}
                            className={`text-gray-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                        />
                    </div>

                    {dropdownOpen && (
                        <div className="absolute right-0 top-14 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50">
                            <div className="px-4 py-3 border-b border-gray-50">
                                <p className="text-sm font-bold text-gray-900 truncate">{displayName}</p>
                                <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                            </div>
                            <div className="p-2">
                                <form action="/auth/signout" method="post">
                                    <button
                                        type="submit"
                                        className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                                    >
                                        <LogOut size={16} />
                                        Sign Out
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}
