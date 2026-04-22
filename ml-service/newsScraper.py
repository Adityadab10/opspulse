"""Fast Google News headline scraping utilities using BeautifulSoup."""

from __future__ import annotations

import re
from typing import List
from urllib.parse import quote_plus
from urllib.request import Request, urlopen

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover
    BeautifulSoup = None

GOOGLE_NEWS_SEARCH_URL = "https://news.google.com/search?q={query}"
MAX_HEADLINES = 5
REQUEST_TIMEOUT_SECONDS = 5


def _clean_text(text: str) -> str:
    lowered = (text or "").strip().lower()
    without_symbols = re.sub(r"[^a-z0-9\s]", " ", lowered)
    normalized = re.sub(r"\s+", " ", without_symbols).strip()
    return normalized


def scrape_google_news_headlines(product_name: str) -> List[str]:
    """
    Search Google News and return top cleaned headlines.

    Args:
        product_name: Product keyword for news search.

    Returns:
        A list of up to 5 cleaned headline strings.
        Returns [] on any error.
    """
    if BeautifulSoup is None:
        return []

    normalized_product = (product_name or "").strip()
    if not normalized_product:
        return []

    query = quote_plus(f"{normalized_product} demand india")
    url = GOOGLE_NEWS_SEARCH_URL.format(query=query)

    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
    )

    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            html = response.read()
    except Exception:
        return []

    try:
        soup = BeautifulSoup(html, "html.parser")

        # Primary selector used by Google News cards.
        headline_nodes = soup.select("a.DY5T1d")

        # Fallback selector for markup variations.
        if not headline_nodes:
            headline_nodes = soup.select("article h3 a, article h4 a")

        headlines: List[str] = []
        seen = set()

        for node in headline_nodes:
            raw_text = node.get_text(" ", strip=True)
            cleaned = _clean_text(raw_text)
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                headlines.append(cleaned)
            if len(headlines) >= MAX_HEADLINES:
                break

        return headlines
    except Exception:
        return []
