import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const navigate = useNavigate();

  const persistUser = (user) => {
    localStorage.setItem("inventory_user", JSON.stringify(user));
    navigate("/dashboard");
  };

  const handleEmailSubmit = (e) => {
    e.preventDefault();
    if (!email.trim()) return;

    const user = {
      name: mode === "signup" ? name || "User" : "User",
      email,
      provider: "email",
    };
    persistUser(user);
  };

  const handleGoogle = () => {
    persistUser({
      name: "Google User",
      email: "google.user@example.com",
      provider: "google",
    });
  };

  return (
    <div className="page-shell flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
        <h1 className="text-2xl font-bold text-slate-900">
          {mode === "login" ? "Welcome Back" : "Create Account"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Continue with Google or Email. Authentication is mocked via localStorage.
        </p>

        <div className="mt-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm">
          <button
            onClick={() => setMode("login")}
            className={`rounded-md py-2 ${mode === "login" ? "bg-white font-semibold" : ""}`}
          >
            Login
          </button>
          <button
            onClick={() => setMode("signup")}
            className={`rounded-md py-2 ${mode === "signup" ? "bg-white font-semibold" : ""}`}
          >
            Signup
          </button>
        </div>

        <button
          onClick={handleGoogle}
          className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50"
        >
          Continue with Google
        </button>

        <form onSubmit={handleEmailSubmit} className="mt-4 space-y-3">
          {mode === "signup" && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full Name"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-700"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email Address"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-700"
          />
          <input
            type="password"
            placeholder="Password"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-700"
          />

          <button className="w-full rounded-lg bg-teal-700 px-4 py-2.5 font-semibold text-white hover:bg-teal-800">
            Continue with Email
          </button>
        </form>
      </div>
    </div>
  );
}