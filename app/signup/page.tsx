"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, email, phone, password }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Signup failed");

      router.push(data.role === "ADMIN" ? "/admin" : "/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Signup failed");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
      
      <div className="absolute w-96 h-96 bg-blue-400/10 rounded-full blur-3xl pointer-events-none -top-20 -right-20"></div>
      <div className="absolute w-96 h-96 bg-indigo-400/10 rounded-full blur-3xl pointer-events-none -bottom-20 -left-20"></div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <span className="text-4xl">🚀</span>
          <h1 className="text-3xl font-black text-slate-900 mt-2 tracking-tight">Create Account</h1>
          <p className="text-slate-500 text-sm mt-1">Get started with your E-Card Portal</p>
        </div>

        {/* iOS Frosted Glass Card */}
        <div className="backdrop-blur-2xl bg-white/80 border border-white/90 p-8 rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.08)] transition-all duration-300">
          
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 p-3.5 rounded-2xl mb-6 text-xs font-semibold animate-in fade-in">
              {error}
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block mb-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="John Doe"
                className="w-full px-4 py-3 bg-slate-100/70 border border-slate-200/80 rounded-2xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 shadow-inner"
              />
            </div>

            <div>
              <label className="block mb-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="johndoe"
                className="w-full px-4 py-3 bg-slate-100/70 border border-slate-200/80 rounded-2xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 shadow-inner"
              />
            </div>

            <div>
              <label className="block mb-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="john@example.com"
                className="w-full px-4 py-3 bg-slate-100/70 border border-slate-200/80 rounded-2xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 shadow-inner"
              />
            </div>

            <div>
              <label className="block mb-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase">Phone Number</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1234567890"
                className="w-full px-4 py-3 bg-slate-100/70 border border-slate-200/80 rounded-2xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 shadow-inner"
              />
            </div>

            <div>
              <label className="block mb-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-slate-100/70 border border-slate-200/80 rounded-2xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 shadow-inner"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl text-sm shadow-xl shadow-blue-600/25 transition-all duration-300 transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 mt-3"
            >
              {loading ? "Creating account..." : "Sign Up ✨"}
            </button>
          </form>

          <div className="text-center mt-6">
            <p className="text-xs text-slate-500">
              Already have an account?{" "}
              <Link href="/login" className="text-blue-600 font-bold hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}