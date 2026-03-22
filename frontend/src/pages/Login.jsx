import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

export default function Login() {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const persistUser = (user) => {
    localStorage.setItem("inventory_user", JSON.stringify(user));
    navigate("/dashboard");
  };

  const handleEmailSubmit = (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    setSubmitting(true);
    setTimeout(() => {
      const user = {
        name: mode === "signup" ? name || "User" : "User",
        email,
        provider: "email",
      };
      persistUser(user);
    }, 600);
  };

  const handleGoogle = () => {
    setSubmitting(true);
    // In production, this should verify the account exists on backend
    setTimeout(() => {
      persistUser({
        name: "Google User",
        email: "google.user@example.com",
        provider: "google",
      });
    }, 600);
  };

  return (
    <div className="page-shell flex min-h-screen items-center justify-center px-4 py-10">
      {/* Back Button */}
      <button
        onClick={() => navigate("/")}
        className="absolute left-6 top-6 rounded-xl bg-purple-500/10 p-2 text-purple-400 transition hover:bg-purple-500/20 hover:text-purple-300"
        title="Back to Landing"
      >
        <ChevronLeft size={24} />
      </button>

      <div className="glass w-full max-w-md rounded-3xl p-8 shadow-2xl">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 shadow-lg shadow-purple-900/50">
            <span className="text-3xl font-bold text-white">I</span>
          </div>
        </div>

        <h1 className="bg-gradient-to-r from-white to-purple-200 bg-clip-text text-center text-3xl font-bold text-transparent">
          {mode === "login" ? "Welcome Back" : "Create Account"}
        </h1>
        <p className="mt-2 text-center text-sm text-slate-400">
          {mode === "login" 
            ? "Access your inventory dashboard"
            : "Register to get started"}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-2 rounded-xl bg-purple-500/5 p-1">
          <button
            onClick={() => {setMode("login"); setPassword("");}}
            className={`rounded-lg py-2.5 font-medium transition ${
              mode === "login" 
                ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-900/40" 
                : "text-slate-400 hover:text-white"
            }`}
          >
            Login
          </button>
          <button
            onClick={() => {setMode("signup"); setPassword("");}}
            className={`rounded-lg py-2.5 font-medium transition ${
              mode === "signup" 
                ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-900/40" 
                : "text-slate-400 hover:text-white"
            }`}
          >
            Signup
          </button>
        </div>

        <button
          onClick={handleGoogle}
          disabled={submitting}
          className="mt-6 w-full rounded-xl border border-purple-500/20 bg-purple-500/5 px-4 py-3 font-medium text-white transition hover:border-purple-500/40 hover:bg-purple-500/10 disabled:opacity-60"
        >
          {submitting ? <span>⏳ Signing in...</span> : <span>🔐 Continue with Google</span>}
        </button>

        <form onSubmit={handleEmailSubmit} className="mt-6 space-y-4">
          {mode === "signup" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Full Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                className="w-full rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 text-white placeholder-slate-500 outline-none transition focus:border-purple-500/40 focus:bg-purple-500/10"
              />
            </div>
          )}
          
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 text-white placeholder-slate-500 outline-none transition focus:border-purple-500/40 focus:bg-purple-500/10"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 text-white placeholder-slate-500 outline-none transition focus:border-purple-500/40 focus:bg-purple-500/10"
            />
          </div>

          <button
            type="submit"
            disabled={!email || !password || submitting}
            className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-3 font-semibold text-white shadow-lg shadow-purple-900/40 transition-all hover:scale-105 hover:shadow-xl hover:shadow-purple-900/50 disabled:opacity-60 disabled:hover:scale-100"
          >
            {submitting ? "⏳ Signing in..." : "📧 " + (mode === "login" ? "Login" : "Create Account")}
          </button>
        </form>
      </div>
    </div>
  );
}