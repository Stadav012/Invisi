import { Leaf } from "lucide-react";
import { login, signup } from "./actions";

export default async function LoginPage(props: {
    searchParams: Promise<{ error?: string; message?: string }>;
}) {
    const searchParams = await props.searchParams;
    const error = searchParams?.error;
    const message = searchParams?.message;

    return (
        <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="flex items-center justify-center gap-3 mb-10">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2D6A4F] text-white shadow-lg">
                        <Leaf size={24} fill="currentColor" />
                    </div>
                    <span className="text-3xl font-bold text-gray-900">Invisi</span>
                </div>

                {/* Card */}
                <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
                    <h1 className="text-2xl font-bold text-gray-900 text-center mb-1">
                        Welcome Back
                    </h1>
                    <p className="text-sm text-gray-500 text-center mb-8">
                        Sign in to monitor your cocoa fermentation
                    </p>

                    {error && (
                        <div className="mb-6 p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700 text-center">
                            {error}
                        </div>
                    )}

                    {message && (
                        <div className="mb-6 p-3 rounded-xl bg-green-50 border border-green-100 text-sm text-green-700 text-center">
                            {message}
                        </div>
                    )}

                    <form className="space-y-5">
                        <div>
                            <label htmlFor="full_name" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                Full Name
                            </label>
                            <input
                                id="full_name"
                                name="full_name"
                                type="text"
                                placeholder="Kwame Asante"
                                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent transition-all"
                            />
                        </div>

                        <div>
                            <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                Email
                            </label>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                placeholder="farmer@invisi.co"
                                required
                                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent transition-all"
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                Password
                            </label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                placeholder="••••••••"
                                required
                                minLength={6}
                                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent transition-all"
                            />
                        </div>

                        <div className="space-y-3 pt-2">
                            <button
                                formAction={login}
                                className="w-full py-3 rounded-xl bg-[#2D6A4F] text-white font-bold text-sm hover:bg-[#245A42] transition-colors shadow-lg shadow-green-200"
                            >
                                Sign In
                            </button>

                            <button
                                formAction={signup}
                                className="w-full py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-bold text-sm hover:bg-gray-50 transition-colors"
                            >
                                Create Account
                            </button>
                        </div>
                    </form>
                </div>

                <p className="text-center text-xs text-gray-400 mt-6">
                    Invisi — Smart Cocoa Fermentation Monitoring
                </p>
            </div>
        </div>
    );
}
