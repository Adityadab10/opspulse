"""Simple rule-based demand signal extraction from news text."""

KEYWORD_SIGNALS = {
    "heat": "increase",
    "rain": "increase",
    "festival": "increase",
    "inflation": "decrease",
    "winter": "increase",
}


def analyze_news(text):
    """Return a demand signal based on the first matching keyword in text."""
    lowered_text = str(text or "").lower()

    for keyword, impact in KEYWORD_SIGNALS.items():
        if keyword in lowered_text:
            return {
                "keyword": keyword,
                "impact": impact,
            }

    return "neutral"
