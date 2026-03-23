import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../../firebase.config";
import { ChevronLeft, Mail, Lock, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const persistUser = (user) => {
    localStorage.setItem("inventory_user", JSON.stringify({
      uid: user.uid,
      name: user.displayName || "User",
      email: user.email,
      provider: user.providerData?.[0]?.providerId || "email",
    }));
    navigate("/dashboard");
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    setSubmitting(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      toast.success("Login successful!");
      persistUser(userCredential.user);
    } catch (error) {
      console.error("Login error:", error);
      const errorMessages = {
        "auth/user-not-found": "No account found with this email",
        "auth/wrong-password": "Incorrect password",
        "auth/invalid-email": "Invalid email address",
        "auth/too-many-requests": "Too many login attempts. Please try again later.",
      };
      toast.error(errorMessages[error.code] || error.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setSubmitting(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      toast.success("Google login successful!");
      persistUser(result.user);
    } catch (error) {
      console.error("Google login error:", error);
      if (error.code !== "auth/popup-closed-by-user") {
        toast.error(error.message || "Google login failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell flex min-h-screen items-center justify-center px-4 py-10 bg-gradient-to-br from-black via-gray-900 to-black">
      {/* Back Button */}
      <button
        onClick={() => navigate("/")}
        className="absolute left-6 top-6 rounded-xl bg-purple-500/10 p-2 text-purple-400 transition hover:bg-purple-500/20 hover:text-purple-300"
        title="Back to Landing"
      >
        <ChevronLeft size={24} />
      </button>

      <div className="glass w-full max-w-md rounded-3xl p-8 shadow-2xl bg-black/60 backdrop-blur-xl border border-gray-800/50">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 shadow-lg shadow-purple-900/50">
            <span className="text-3xl font-bold text-white">I</span>
          </div>
        </div>

        <h1 className="bg-gradient-to-r from-white to-purple-200 bg-clip-text text-center text-3xl font-bold text-transparent">
          Welcome Back
        </h1>
        <p className="mt-2 text-center text-sm text-slate-400">
          Access your inventory dashboard
        </p>

        {/* Google Login */}
        <button
          onClick={handleGoogleLogin}
          disabled={submitting}
          className="mt-6 w-full rounded-xl border border-purple-500/20 bg-purple-500/5 px-4 py-3 font-medium text-white transition hover:border-purple-500/40 hover:bg-purple-500/10 disabled:opacity-60"
        >
          {submitting ? <span>⏳ Signing in...</span> : <span>🔐 Continue with Google</span>}
        </button>

        <div className="my-6 flex items-center gap-3">
          <div className="flex-1 border-t border-gray-700"></div>
          <span className="text-xs text-gray-500">OR</span>
          <div className="flex-1 border-t border-gray-700"></div>
        </div>

        {/* Email Login Form */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">
              Email Address
            </label>
            <div className="relative group">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 transition-colors group-focus-within:text-purple-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-purple-500/20 bg-purple-500/5 text-white placeholder-slate-500 outline-none transition focus:border-purple-500/40 focus:bg-purple-500/10 focus:ring-2 focus:ring-purple-500/20"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">
              Password
            </label>
            <div className="relative group">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 transition-colors group-focus-within:text-purple-400" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-10 pr-12 py-3 rounded-xl border border-purple-500/20 bg-purple-500/5 text-white placeholder-slate-500 outline-none transition focus:border-purple-500/40 focus:bg-purple-500/10 focus:ring-2 focus:ring-purple-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 transition hover:text-purple-400"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={!email || !password || submitting}
            className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-3 font-semibold text-white shadow-lg shadow-purple-900/40 transition-all hover:scale-105 hover:shadow-xl hover:shadow-purple-900/50 disabled:opacity-60 disabled:hover:scale-100"
          >
            {submitting ? "⏳ Signing in..." : "📧 Login"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Don't have an account?{" "}
          <Link to="/register" className="text-purple-400 hover:text-purple-300 font-semibold transition">
            Sign up here
          </Link>
        </p>
      </div>
    </div>
  );
}