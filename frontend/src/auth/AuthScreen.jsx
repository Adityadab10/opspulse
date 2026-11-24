import { Link } from "react-router-dom";

export default function AuthScreen({ children }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black px-4 py-8 text-slate-100">
      <Link to="/" className="text-2xl font-bold text-cyan-200">OpsPulse</Link>
      {children}
    </main>
  );
}
