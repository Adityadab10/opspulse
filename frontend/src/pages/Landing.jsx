import React from 'react';
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";

const features = [
  "Sales Analytics",
  "Demand Forecasting",
  "Smart Alerts",
  "Inventory Recommendations",
];

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="page-shell">
      <Navbar />
      <main>
        <section className="relative overflow-hidden px-6 py-24">
          <div className="mx-auto max-w-6xl rounded-3xl border border-white/40 bg-white/70 p-10 shadow-xl backdrop-blur md:p-16">
            <h1 className="max-w-3xl text-4xl font-bold leading-tight text-slate-900 md:text-6xl">
              AI-Powered Inventory Intelligence
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-slate-600">
              Predict demand, track trends, and manage inventory smarter.
            </p>
            <button
              onClick={() => navigate("/login")}
              className="mt-8 rounded-xl bg-teal-700 px-6 py-3 font-semibold text-white transition hover:bg-teal-800"
            >
              Get Started
            </button>
          </div>
        </section>

        <section className="px-6 pb-20">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-8 text-2xl font-bold text-slate-900 md:text-3xl">Features</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {features.map((item) => (
                <div
                  key={item}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <p className="font-semibold text-slate-800">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white/70 px-6 py-6 text-center text-sm text-slate-500">
        © 2026 Inventory Intelligence
        <span className="mx-2">|</span>
        <Link to="/login" className="font-medium text-teal-700 hover:underline">
          Login
        </Link>
      </footer>
    </div>
  );
}