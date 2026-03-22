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
    <div className="page-shell flex items-center justify-center px-4 py-10 min-h-screen relative">
      {/* Back Button */}
      <button
        onClick={() => navigate("/")}
        className="absolute top-6 left-6 p-2 rounded-lg transition hover:bg-opacity-80"
        style={{
          background: 'rgba(197, 148, 75, 0.1)',
          color: 'var(--accent-primary)',
        }}
        title="Back to Landing"
      >
        <ChevronLeft size={24} />
      </button>

      <div className="w-full max-w-md rounded-2xl p-8" style={{
        background: 'linear-gradient(135deg, var(--bg-2) 0%, rgba(61, 54, 49, 0.5) 100%)',
        border: '1px solid var(--border-color)',
      }}>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'DM Serif Display' }}>
          {mode === "login" ? "Welcome Back" : "Create Account"}
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {mode === "login" 
            ? "Access your inventory dashboard"
            : "Register to get started"}
        </p>

        <div className="mt-6 grid grid-cols-2 rounded-lg p-1" style={{ background: 'rgba(75, 70, 65, 0.3)' }}>
          <button
            onClick={() => {setMode("login"); setPassword("");}}
            className={`rounded-md py-2 font-medium transition ${mode === "login" ? "font-bold" : ""}`}
            style={{
              background: mode === "login" ? 'var(--accent-primary)' : 'transparent',
              color: mode === "login" ? 'var(--bg-1)' : 'var(--text-secondary)',
            }}
          >
            Login
          </button>
          <button
            onClick={() => {setMode("signup"); setPassword("");}}
            className={`rounded-md py-2 font-medium transition ${mode === "signup" ? "font-bold" : ""}`}
            style={{
              background: mode === "signup" ? 'var(--accent-primary)' : 'transparent',
              color: mode === "signup" ? 'var(--bg-1)' : 'var(--text-secondary)',
            }}
          >
            Signup
          </button>
        </div>

        <button
          onClick={handleGoogle}
          disabled={submitting}
          className="mt-6 w-full rounded-lg border px-4 py-3 font-medium text-center transition hover:opacity-80"
          style={{
            borderColor: 'var(--border-light)',
            color: 'var(--text-primary)',
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? <span>⏳ Signing in...</span> : <span>🔐 Continue with Google</span>}
        </button>

        <form onSubmit={handleEmailSubmit} className="mt-6 space-y-4">
          {mode === "signup" && (
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                Full Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                className="w-full rounded-lg p-3"
                style={{
                  background: 'rgba(75, 70, 65, 0.3)',
                  border: '1px solid var(--border-light)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="You@example.com"
              required
              className="w-full rounded-lg p-3"
              style={{
                background: 'rgba(75, 70, 65, 0.3)',
                border: '1px solid var(--border-light)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full rounded-lg p-3"
              style={{
                background: 'rgba(75, 70, 65, 0.3)',
                border: '1px solid var(--border-light)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={!email || !password || submitting}
            className="w-full rounded-lg px-4 py-3 font-semibold text-lg transition hover:shadow-lg"
            style={{
              background: !email || !password || submitting ? 'var(--text-muted)' : 'var(--accent-primary)',
              color: 'var(--bg-1)',
              opacity: !email || !password || submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "⏳ Signing in..." : "📧 " + (mode === "login" ? "Login" : "Create Account")}
          </button>
        </form>
      </div>
    </div>
  );
}