import { CircleAlert, LoaderCircle, X } from "lucide-react";

const getImpactStyle = (impact) => {
  const normalized = String(impact || "neutral").toLowerCase();
  if (normalized === "increase") {
    return {
      badgeClass: "bg-emerald-500/20 text-emerald-200 border border-emerald-500/30",
      icon: "🔥",
      label: "Increase",
    };
  }
  if (normalized === "decrease") {
    return {
      badgeClass: "bg-rose-500/20 text-rose-200 border border-rose-500/30",
      icon: "⚠️",
      label: "Decrease",
    };
  }

  return {
    badgeClass: "bg-amber-500/20 text-amber-200 border border-amber-500/30",
    icon: "➖",
    label: "Neutral",
  };
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const renderHeadlineWithKeywords = (headline, keywords) => {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return headline;
  }

  let renderedParts = [String(headline || "")];

  for (const rawKeyword of keywords) {
    const cleanedKeyword = String(rawKeyword || "").trim();
    if (!cleanedKeyword) {
      continue;
    }

    const expression = new RegExp(`(${escapeRegExp(cleanedKeyword)})`, "ig");
    const nextParts = [];

    renderedParts.forEach((part, partIndex) => {
      if (typeof part !== "string") {
        nextParts.push(part);
        return;
      }

      const split = part.split(expression);
      split.forEach((segment, segmentIndex) => {
        const key = `${cleanedKeyword}-${partIndex}-${segmentIndex}`;
        if (segment.toLowerCase() === cleanedKeyword.toLowerCase()) {
          nextParts.push(
            <mark key={key} className="rounded bg-yellow-300/30 px-1 text-yellow-100">
              {segment}
            </mark>
          );
        } else if (segment) {
          nextParts.push(<span key={key}>{segment}</span>);
        }
      });
    });

    renderedParts = nextParts;
  }

  return renderedParts;
};

export default function NewsPanel({
  isOpen,
  isLoading,
  error,
  data,
  onClose,
  onRetry,
}) {
  if (!isOpen) {
    return null;
  }

  const impactStyle = getImpactStyle(data?.impact);
  const headlines = Array.isArray(data?.headlines) ? data.headlines.slice(0, 5) : [];
  const matchedKeywords = Array.isArray(data?.matchedKeywords) ? data.matchedKeywords : [];
  const adjustedPrediction = Number.isFinite(Number(data?.adjustedPrediction))
    ? Number(data.adjustedPrediction)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-2xl rounded-t-2xl border border-purple-500/30 bg-slate-900 p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-white">News Insights</h3>
            <p className="mt-1 text-sm text-slate-400">
              {data?.product?.name || "Selected product"}
              {data?.product?.category ? ` · ${data.product.category}` : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-500/40 bg-slate-500/10 p-2 text-slate-200 transition hover:bg-slate-500/20"
            aria-label="Close news insights"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex h-56 items-center justify-center gap-3 text-slate-300">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            <span>Fetching latest news...</span>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <div className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 h-4 w-4" />
              <div>
                <p>{error || "Failed to fetch news"}</p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 rounded-lg border border-red-300/40 bg-red-300/10 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:bg-red-300/20"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <section>
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Top News</p>
              {headlines.length > 0 ? (
                <ul className="space-y-2">
                  {headlines.map((headline, idx) => (
                    <li key={`${headline}-${idx}`}>
                      <a
                        href={`https://news.google.com/search?q=${encodeURIComponent(headline)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg border border-slate-600/30 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500/40 hover:bg-slate-800"
                      >
                        {renderHeadlineWithKeywords(headline, matchedKeywords)}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">No related headlines found.</p>
              )}
            </section>

            <section>
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">AI Insight</p>
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${impactStyle.badgeClass}`}>
                    {impactStyle.icon} {impactStyle.label}
                  </span>
                  {matchedKeywords.slice(0, 3).map((keyword, idx) => (
                    <span
                      key={`${keyword}-${idx}`}
                      className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-100"
                    >
                      {keyword}
                    </span>
                  ))}
                  {adjustedPrediction !== null ? (
                    <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-100">
                      Adjusted Prediction: {adjustedPrediction}
                    </span>
                  ) : null}
                </div>

                <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-bold text-emerald-100">
                  {data?.suggestion || "Maintain stock"}
                </p>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
