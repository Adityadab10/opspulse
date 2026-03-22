import React from 'react';
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";

const features = [
  {
    icon: "📊",
    title: "Sales Analytics",
    description: "Real-time insights into your sales performance with beautiful, interactive dashboards"
  },
  {
    icon: "🔮",
    title: "AI Forecasting",
    description: "Machine learning algorithms predict demand with 99% accuracy"
  },
  {
    icon: "🔔",
    title: "Smart Alerts",
    description: "Instant notifications for low stock, overstock, and demand spikes"
  },
  {
    icon: "💡",
    title: "Auto Recommendations",
    description: "AI-powered suggestions to optimize your inventory in real-time"
  },
];

const stats = [
  { value: "99%", label: "Prediction Accuracy" },
  { value: "24/7", label: "Real-time Monitoring" },
  { value: "50%", label: "Cost Reduction" },
];

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="page-shell">
      <Navbar />
      <main className="relative">
        {/* Hero Section - Reimagined */}
        <section className="relative min-h-[85vh] overflow-hidden px-6 py-20">
          {/* Dynamic Background */}
          <div className="pointer-events-none absolute inset-0">
            {/* Large gradient orbs */}
            <div className="absolute -left-40 top-0 h-[600px] w-[600px] animate-pulse rounded-full bg-purple-600/30 blur-3xl"></div>
            <div className="absolute -right-40 top-40 h-[700px] w-[700px] animate-pulse rounded-full bg-indigo-600/25 blur-3xl" style={{ animationDelay: '1s' }}></div>
            <div className="absolute bottom-0 left-1/2 h-[500px] w-[500px] -translate-x-1/2 animate-pulse rounded-full bg-pink-600/20 blur-3xl" style={{ animationDelay: '2s' }}></div>
          </div>

          <div className="relative mx-auto max-w-7xl">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              {/* Left: Content */}
              <div className="animate-fade-in-up space-y-8">
                {/* Badge */}
                <div className="inline-flex items-center gap-2 rounded-full border border-purple-400/30 bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-4 py-2 backdrop-blur-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-500"></span>
                  </span>
                  <span className="text-sm font-semibold text-purple-300">Inventory Intelligence Platform</span>
                </div>

                {/* Main Heading */}
                <h1 className="text-5xl font-black leading-tight tracking-tight md:text-6xl lg:text-7xl">
                  <span className="block bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                    Smart Inventory
                  </span>
                  <span className="block bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 bg-clip-text text-transparent">
                    Made Simple
                  </span>
                </h1>

                {/* Subheading */}
                <p className="max-w-xl text-xl leading-relaxed text-slate-300">
                  Stop guessing. Start knowing. AI-powered demand forecasting that helps small businesses optimize inventory and maximize profits.
                </p>

                {/* CTA Buttons */}
                <div className="flex flex-wrap gap-4">
                  <button
                    onClick={() => navigate("/login")}
                    className="group relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-600 via-purple-500 to-pink-500 px-8 py-4 font-bold text-white shadow-2xl shadow-purple-900/50 transition-all hover:scale-105 hover:shadow-purple-900/70"
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      Get Started
                      <svg className="h-5 w-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </span>
                  </button>
                  <a
                    href="#features"
                    className="group flex items-center gap-2 rounded-2xl border-2 border-purple-400/30 bg-purple-500/10 px-8 py-4 font-bold text-purple-200 backdrop-blur-sm transition-all hover:border-purple-400/60 hover:bg-purple-500/20"
                  >
                    See How It Works
                    <svg className="h-5 w-5 transition-transform group-hover:translate-y-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </a>
                </div>

                {/* Social Proof */}
                <div className="flex flex-wrap items-center gap-6 pt-4">
                  {["✓ No credit card", "✓ Free forever", "✓ Cancel anytime"].map((text) => (
                    <div key={text} className="flex items-center gap-2 text-sm text-slate-400">
                      <span className="text-green-400">{text.split(" ")[0]}</span>
                      <span>{text.split(" ").slice(1).join(" ")}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: Visual Element */}
              <div className="animate-fade-in relative hidden lg:block" style={{ animationDelay: '0.2s' }}>
                <div className="group relative">
                  {/* Floating Card */}
                  <div className="relative overflow-hidden rounded-3xl border border-purple-500/20 bg-gradient-to-br from-slate-900/60 to-purple-900/20 p-8 shadow-2xl backdrop-blur-xl">
                    {/* Mock Dashboard Preview */}
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="h-3 w-32 rounded-full bg-gradient-to-r from-purple-500 to-pink-500"></div>
                        <div className="h-3 w-3 rounded-full bg-green-400"></div>
                      </div>
                      
                      {/* Chart bars */}
                      <div className="flex items-end gap-2">
                        {[60, 80, 65, 90, 75, 85, 70].map((height, i) => (
                          <div
                            key={i}
                            className="w-full rounded-t-lg bg-gradient-to-t from-purple-600 to-pink-500 transition-all hover:scale-105"
                            style={{ height: `${height}px` }}
                          ></div>
                        ))}
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-4">
                        {stats.map((stat) => (
                          <div key={stat.label} className="rounded-xl border border-purple-500/20 bg-purple-500/10 p-4 text-center backdrop-blur-sm">
                            <div className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-2xl font-bold text-transparent">
                              {stat.value}
                            </div>
                            <div className="mt-1 text-xs text-slate-400">{stat.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Glow effect */}
                    <div className="absolute -inset-1 -z-10 rounded-3xl bg-gradient-to-r from-purple-600 to-pink-600 opacity-20 blur-2xl transition-opacity group-hover:opacity-40"></div>
                  </div>

                  {/* Floating badge */}
                  <div className="animate-float absolute -right-6 -top-6 rounded-2xl border border-green-500/30 bg-gradient-to-br from-green-500/20 to-emerald-500/10 px-6 py-3 backdrop-blur-xl">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-green-400"></div>
                      <span className="text-sm font-bold text-green-300">99% Accurate</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section - Redesigned */}
        <section id="features" className="relative px-6 py-24">
          <div className="mx-auto max-w-7xl">
            {/* Section Header */}
            <div className="mb-16 text-center">
              <div className="mb-4 inline-block rounded-full border border-purple-400/20 bg-purple-500/10 px-4 py-2">
                <span className="text-sm font-semibold text-purple-400">Features</span>
              </div>
              <h2 className="mb-6 bg-gradient-to-r from-white via-purple-200 to-white bg-clip-text text-4xl font-black text-transparent md:text-5xl">
                Everything You Need to Succeed
              </h2>
              <p className="mx-auto max-w-2xl text-lg text-slate-400">
                Powerful tools designed specifically for small retail businesses
              </p>
            </div>

            {/* Feature Grid */}
            <div className="grid gap-8 md:grid-cols-2">
              {features.map((feature, index) => (
                <div
                  key={feature.title}
                  className="group relative overflow-hidden rounded-3xl border border-purple-500/10 bg-gradient-to-br from-slate-900/50 to-purple-900/10 p-8 backdrop-blur-sm transition-all hover:scale-[1.02] hover:border-purple-500/30 hover:shadow-2xl hover:shadow-purple-900/20"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  {/* Icon */}
                  <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500/30 to-pink-500/30 text-4xl shadow-lg backdrop-blur-sm transition-transform group-hover:scale-110">
                    {feature.icon}
                  </div>

                  {/* Content */}
                  <h3 className="mb-3 bg-gradient-to-r from-white to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
                    {feature.title}
                  </h3>
                  <p className="leading-relaxed text-slate-400">
                    {feature.description}
                  </p>

                  {/* Animated border */}
                  <div className="absolute bottom-0 left-0 h-1 w-0 bg-gradient-to-r from-purple-500 to-pink-500 transition-all group-hover:w-full"></div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="glass border-t border-purple-500/10 px-6 py-8 text-center">
        <p className="text-sm text-slate-400">
          © 2026 Inventory Intelligence
          <span className="mx-3 text-purple-500/50">|</span>
          <Link to="/login" className="font-medium text-purple-400 transition-colors hover:text-purple-300">
            Login
          </Link>
        </p>
      </footer>
    </div>
  );
}