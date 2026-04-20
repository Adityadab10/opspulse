"""Rule-based external news analysis for demand signals."""

KEYWORD_IMPACT = {
    "heat": "increase",
    "heatwave": "increase",
    "summer": "increase",
    "rain": "increase",
    "monsoon": "increase",
    "festival": "increase",
    "diwali": "increase",
    "inflation": "decrease",
    "price hike": "decrease",
    "recession": "decrease",
    "winter": "increase",
}

DECREASE_KEYWORDS = [
    keyword for keyword, impact in KEYWORD_IMPACT.items() if impact == "decrease"
]
INCREASE_KEYWORDS = [
    keyword for keyword, impact in KEYWORD_IMPACT.items() if impact == "increase"
]


def analyze_news(text: str) -> dict:
    """Extract a deterministic demand signal from news text.

    Priority rule: if both increase and decrease terms are present,
    return the decrease signal as the stronger impact.
    """
    lowered_text = (text or "").lower()

    for keyword in DECREASE_KEYWORDS:
        if keyword in lowered_text:
            return {
                "keyword": keyword,
                "impact": "decrease",
            }

    for keyword in INCREASE_KEYWORDS:
        if keyword in lowered_text:
            return {
                "keyword": keyword,
                "impact": "increase",
            }

    return {
        "keyword": None,
        "impact": "neutral",
    }
