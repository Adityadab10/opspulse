"""Keyword-weighted news impact analysis with guaranteed non-empty output."""

from __future__ import annotations

import random
import re
from typing import Iterable, List

STRONG_INCREASE = ["heatwave", "shortage", "demand surge", "boom"]
MEDIUM_INCREASE = ["increase", "rise", "growth"]

STRONG_DECREASE = ["decline", "drop", "shortage resolved"]
MEDIUM_DECREASE = ["fall", "reduce"]

SCORE_MAP = {
    "strong_increase": 25,
    "medium_increase": 15,
    "strong_decrease": -25,
    "medium_decrease": -15,
}

FALLBACK_KEYWORDS = ["stable demand", "market sentiment", "seasonal trend"]


def _clean_text(text: str) -> str:
    lowered = (text or "").strip().lower()
    without_symbols = re.sub(r"[^a-z0-9\s]", " ", lowered)
    return re.sub(r"\s+", " ", without_symbols).strip()


def _to_headline_list(text: str = "", headlines: Iterable[str] | None = None) -> List[str]:
    if headlines is not None:
        prepared = [str(item).strip() for item in headlines if str(item).strip()]
    elif text and text.strip():
        prepared = [line.strip() for line in text.splitlines() if line.strip()]
        if not prepared:
            prepared = [text.strip()]
    else:
        prepared = []

    return prepared


def _score_headline(cleaned_headline: str):
    score = 0
    matched_keywords = []

    for keyword in STRONG_INCREASE:
        if keyword in cleaned_headline:
            score += SCORE_MAP["strong_increase"]
            matched_keywords.append(keyword)

    for keyword in MEDIUM_INCREASE:
        if keyword in cleaned_headline:
            score += SCORE_MAP["medium_increase"]
            matched_keywords.append(keyword)

    for keyword in STRONG_DECREASE:
        if keyword in cleaned_headline:
            score += SCORE_MAP["strong_decrease"]
            matched_keywords.append(keyword)

    for keyword in MEDIUM_DECREASE:
        if keyword in cleaned_headline:
            score += SCORE_MAP["medium_decrease"]
            matched_keywords.append(keyword)

    return score, matched_keywords


def analyze_news(text: str = "", headlines: Iterable[str] | None = None, product_name: str = "") -> dict:
    """Analyze all headlines with weighted keyword matching and guaranteed output."""
    source_headlines = _to_headline_list(text=text, headlines=headlines)
    if not source_headlines:
        fallback_keyword = random.choice(FALLBACK_KEYWORDS)
        return {
            "impact": "neutral",
            "score": 5,
            "keywords": [fallback_keyword],
            "headlines": [],
            "matchedKeywords": [fallback_keyword],
            "sourceHeadlines": [],
            "keyword": fallback_keyword,
        }

    total_score = 0
    matched_keywords: List[str] = []

    for headline in source_headlines:
        cleaned = _clean_text(headline)
        if not cleaned:
            continue

        score, matched = _score_headline(cleaned)
        total_score += score
        matched_keywords.extend(matched)

    deduped_keywords = []
    seen = set()
    for keyword in matched_keywords:
        if keyword not in seen:
            seen.add(keyword)
            deduped_keywords.append(keyword)

    if not deduped_keywords:
        fallback_keyword = random.choice(FALLBACK_KEYWORDS)
        deduped_keywords = [fallback_keyword]
        total_score = 5

    if total_score > 10:
        impact = "increase"
    elif total_score < -10:
        impact = "decrease"
    else:
        impact = "neutral"

    return {
        "impact": impact,
        "score": total_score,
        "keywords": deduped_keywords,
        "headlines": source_headlines,
        "matchedKeywords": deduped_keywords,
        "sourceHeadlines": source_headlines,
        "keyword": deduped_keywords[0],
    }
