import { Link } from "react-router-dom";

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-purple-500/10 bg-[#0a0b14]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="group flex items-center space-x-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 shadow-lg shadow-purple-900/50 transition-all group-hover:scale-110 group-hover:shadow-xl group-hover:shadow-purple-900/60">
            <span className="text-xl font-bold text-white">I</span>
            {/* Glow effect */}
            <div className="absolute inset-0 -z-10 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 opacity-0 blur transition-opacity group-hover:opacity-50"></div>
          </div>
          <span className="bg-gradient-to-r from-white to-purple-200 bg-clip-text text-xl font-bold text-transparent transition-all group-hover:from-purple-300 group-hover:to-indigo-300">
            Inventory Intelligence
          </span>
        </Link>
        
        <div className="flex items-center gap-4">
          <Link
            to="/login"
            className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-purple-600 via-purple-500 to-indigo-600 px-6 py-2.5 font-bold text-white shadow-lg shadow-purple-900/40 transition-all hover:scale-105 hover:shadow-xl hover:shadow-purple-900/60"
          >
            <span className="relative z-10 flex items-center gap-2">
              Login
              <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-pink-500 to-indigo-500 opacity-0 transition-opacity group-hover:opacity-100"></div>
          </Link>
        </div>
      </div>
    </nav>
  );
}