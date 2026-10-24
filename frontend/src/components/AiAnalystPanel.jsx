import { useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { auth } from "../../firebase.config";
import { aiAnalystApi } from "../services/api";

export default function AiAnalystPanel() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const ask = async (event) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setLoading(true);
    setError("");
    try {
      const token = await auth.currentUser?.getIdToken?.();
      const response = await aiAnalystApi.ask(
        trimmed,
        token ? `Bearer ${token}` : "",
      );
      if (currentRequestId !== requestId.current) return;
      setAnswer(response.data);
      setQuestion("");
    } catch (requestError) {
      if (currentRequestId !== requestId.current) return;
      setAnswer(null);
      setError(
        requestError.response?.data?.error ||
          requestError.response?.data?.message ||
          "AI Analyst is unavailable. Try again later.",
      );
    } finally {
      if (currentRequestId === requestId.current) {
        setLoading(false);
      }
    }
  };

  return (
    <section className="glass rounded-2xl p-6">
      <div className="mb-4 flex items-center gap-3">
        <MessageCircle className="h-5 w-5 text-cyan-300" />
        <div>
          <h3 className="text-xl font-bold text-cyan-100">AI Analyst</h3>
          <p className="text-sm text-slate-400">
            Ask about live inventory data or OpsPulse methodology.
          </p>
        </div>
      </div>
      <form onSubmit={ask} className="flex gap-2">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={1000}
          placeholder="Which products have active alerts?"
          className="min-w-0 flex-1 rounded-xl border border-slate-500/30 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/50"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {loading ? "Thinking..." : "Ask"}
        </button>
      </form>
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
      {answer ? (
        <div className="mt-4 rounded-xl border border-cyan-400/20 bg-slate-950/30 p-4">
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{answer.answer}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
            <span>Mode: {answer.category}</span>
            {answer.provenance?.liveData ? <span>Live PostgreSQL data</span> : null}
            {answer.provenance?.documentation ? <span>OpsPulse documentation</span> : null}
          </div>
          {answer.sources?.length ? (
            <ul className="mt-3 space-y-1 text-xs text-slate-400">
              {answer.sources.map((source, index) => (
                <li key={`${source.label}-${index}`}>Source: {source.label}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
