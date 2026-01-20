import { Search, Bell, ChevronDown, Leaf } from "lucide-react";

export function Header() {
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

                <div className="flex items-center gap-3 cursor-pointer">
                    <div className="h-10 w-10 overflow-hidden rounded-full border-2 border-green-100 bg-gray-100">
                        <img
                            src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?fit=crop&w=100&h=100"
                            alt="Kwame A."
                            className="h-full w-full object-cover"
                        />
                    </div>
                    <div className="hidden text-sm md:block">
                        <p className="font-semibold text-gray-900">Stanley.</p>
                        <p className="text-xs text-gray-500">Farmer</p>
                    </div>
                    <ChevronDown size={16} className="text-gray-400" />
                </div>
            </div>
        </header>
    );
}
