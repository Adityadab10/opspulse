"""Multi-source web scraping for product-related news headlines."""

from __future__ import annotations

import re
from typing import Dict, List
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup

GOOGLE_RSS_ENDPOINT = "https://news.google.com/rss/search?q={query}"
BING_NEWS_ENDPOINT = "https://www.bing.com/news/search?q={query}"
REQUEST_TIMEOUT_SECONDS = 10
MAX_HEADLINES = 5


def _clean_headline(value: str) -> str:
    lowered = (value or "").strip().lower()
    without_symbols = re.sub(r"[^a-z0-9\s]", " ", lowered)
    return re.sub(r"\s+", " ", without_symbols).strip()


def _dedupe_keep_order(items: List[str]) -> List[str]:
    seen = set()
    output = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            output.append(item)
    return output


def _fill_to_minimum(headlines: List[str], product_name: str) -> List[str]:
    normalized_product = (product_name or "product").strip().lower() or "product"
    fallback_headline = _clean_headline(f"{normalized_product} market demand stable")

    filled = list(headlines)
    while len(filled) < MAX_HEADLINES:
        filled.append(fallback_headline)
    return filled[:MAX_HEADLINES]


def _fetch_google_rss(product_name: str) -> List[str]:
    query = quote_plus(f"{product_name} india")
    url = GOOGLE_RSS_ENDPOINT.format(query=query)

    response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "xml")
    item_titles = []
    for item in soup.find_all("item"):
        title_node = item.find("title")
        if title_node:
            item_titles.append(title_node.get_text(" ", strip=True))

    cleaned = [_clean_headline(title) for title in item_titles if title]

    return _dedupe_keep_order(cleaned)[:MAX_HEADLINES]


def _fetch_bing_news(product_name: str) -> List[str]:
    query = quote_plus(f"{product_name} india")
    url = BING_NEWS_ENDPOINT.format(query=query)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS, headers=headers)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    cleaned = [_clean_headline(node.get_text(" ", strip=True)) for node in soup.select("a.title")]

    return _dedupe_keep_order([item for item in cleaned if item])[:MAX_HEADLINES]


def fetch_product_news(product_name: str) -> Dict[str, List[str] | str]:
    """
    Fetch product-related headlines using multi-source fallback scraping.

    Args:
        product_name: Product name used to build the search query.

    Returns:
        {
            "headlines": [..5 items..],
            "source": "google"|"bing"|"fallback"
        }
    """
    normalized_name = (product_name or "").strip()
    if not normalized_name:
        headlines = _fill_to_minimum([], "product")
        print("Fetched headlines:", headlines)
        return {
            "headlines": headlines,
            "source": "fallback",
        }

    source = "fallback"
    headlines: List[str] = []

    try:
        headlines = _fetch_google_rss(normalized_name)
        if headlines:
            source = "google"
    except Exception:
        headlines = []

    if len(headlines) < MAX_HEADLINES:
        try:
            bing_headlines = _fetch_bing_news(normalized_name)
            merged = _dedupe_keep_order(headlines + bing_headlines)
            headlines = merged[:MAX_HEADLINES]
            if bing_headlines and source != "google":
                source = "bing"
        except Exception:
            pass

    if len(headlines) < MAX_HEADLINES:
        headlines = _fill_to_minimum(headlines, normalized_name)
        if source not in {"google", "bing"}:
            source = "fallback"

    print("Fetched headlines:", headlines)
    return {
        "headlines": headlines,
        "source": source,
    }
