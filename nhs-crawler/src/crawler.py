"""Crawling and parsing of NHS Health A to Z condition pages.

The NHS conditions site has two page types:

1. **Hub pages** — the top-level landing page for a condition (e.g.
   ``/conditions/type-2-diabetes/``).  Some hub pages consolidate all
   content inline (like asthma); others provide a sidebar of subpage
   links (like type-2-diabetes with Symptoms, Treatment, etc.).

2. **Subpages** — individual topic pages under a condition
   (e.g. ``/conditions/type-2-diabetes/treatment/``).
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Tag

from src.constants import CONDITIONS_INDEX_URL
from src.logging_config import get_logger
from src.utils import build_absolute_url, is_nhs_conditions, safe_request, slug_from_url

logger = get_logger()

_CONDITION_RE = re.compile(r"^/conditions/([a-z0-9][a-z0-9-]*[a-z0-9])/?$", re.IGNORECASE)

_CLUTTER_SELECTORS = [
    "nav",
    ".nhsuk-breadcrumb",
    ".nhsuk-feedback-banner",
    ".nhsuk-page-banner",
    ".nhsuk-u-visually-hidden",
    ".nhsuk-card__link-container",
    ".nhsuk-back-to-top",
    "script",
    "style",
    "svg",
    ".nhsuk-skip-link",
    ".nhsuk-header",
    ".nhsuk-footer",
]


def discover_condition_urls() -> list[str]:
    """Fetch the A-to-Z index and return an ordered list of unique condition URLs."""
    logger.info(f"Fetching conditions index: {CONDITIONS_INDEX_URL}")
    response = safe_request(CONDITIONS_INDEX_URL)
    if response is None or response.status_code != 200:
        status = response.status_code if response else "None"
        logger.error(f"Failed to fetch index page (status={status})")
        return []

    soup = BeautifulSoup(response.content, "lxml")
    urls: list[str] = []
    seen: set[str] = set()

    for a in soup.find_all("a", href=True):
        href = a["href"].split("?")[0].split("#")[0]
        abs_url = build_absolute_url(href)
        if not _CONDITION_RE.match(urlparse(abs_url).path):
            continue
        clean_url = abs_url.rstrip("/") + "/"
        if clean_url not in seen:
            seen.add(clean_url)
            urls.append(clean_url)

    logger.info(f"Discovered {len(urls)} condition URLs from index")
    return urls


def discover_subpage_urls(hub_url: str) -> list[str]:
    """Fetch a condition hub page and discover all subpage URLs.

    NHS hub pages list subpages in a ``<ul class="nhsuk-hub-key-links">``
    element.  Hub pages without subpages return ``[hub_url]``.

    Returns:
        List of absolute URLs. If the hub has subpages, the hub itself is
        excluded (subpages contain all the content).
    """
    response = safe_request(hub_url)
    if response is None or response.status_code != 200:
        status = response.status_code if response else "None"
        logger.warning(f"  Failed to fetch hub page {hub_url} (status={status})")
        return [hub_url]

    soup = BeautifulSoup(response.content, "lxml")
    hub_links = soup.find("ul", class_="nhsuk-hub-key-links")
    if hub_links and isinstance(hub_links, Tag):
        subpages: list[str] = []
        for a in hub_links.find_all("a", href=True):
            abs_url = build_absolute_url(a["href"]).split("?")[0].split("#")[0].rstrip("/") + "/"
            if (
                is_nhs_conditions(abs_url)
                and abs_url.startswith(hub_url.rstrip("/") + "/")
                and abs_url != hub_url
            ):
                subpages.append(abs_url)

        if subpages:
            logger.info(f"  [{slug_from_url(hub_url)}] Found {len(subpages)} subpages")
            return subpages

    return [hub_url]


def parse_page_to_markdown(url: str) -> dict[str, Any]:
    """Fetch a single condition page and convert it to clean Markdown."""
    from src.converter import html_to_markdown

    result: dict[str, Any] = {
        "url": url,
        "title": "",
        "markdown": "",
        "status": None,
        "errors": [],
    }

    response = safe_request(url)
    if response is None:
        result["errors"].append("request failed (no response)")
        return result
    result["status"] = response.status_code
    if response.status_code != 200:
        result["errors"].append(f"HTTP {response.status_code}")
        return result

    soup = BeautifulSoup(response.content, "lxml")
    result["title"] = _extract_title(soup)

    content_element = _find_main_content(soup)
    if content_element is None:
        result["errors"].append("could not locate main content element")
        return result

    _remove_clutter(content_element)
    result["markdown"] = html_to_markdown(content_element).strip()

    return result


def _extract_title(soup: BeautifulSoup) -> str:
    """Extract the page title from ``<h1>`` or ``<title>``."""
    h1 = soup.find("h1")
    if h1:
        return h1.get_text(strip=True)
    title_tag = soup.find("title")
    if title_tag:
        return title_tag.get_text(strip=True).split("|")[0].strip()
    return ""


def _find_main_content(soup: BeautifulSoup) -> Tag | None:
    """Locate the main content element on an NHS conditions page.

    Strategy (ordered by specificity):
    1. ``<div class="nhsuk-grid-column-two-thirds">`` inside ``<article>``
    2. ``<article>`` tag
    3. ``<main>`` tag
    4. ``<body>`` as fallback
    """
    article = soup.find("article")
    if article and isinstance(article, Tag):
        content = article.find("div", class_="nhsuk-grid-column-two-thirds")
        if content and isinstance(content, Tag):
            return content
        return article

    main = soup.find("main")
    if main and isinstance(main, Tag):
        return main

    body = soup.find("body")
    return body if isinstance(body, Tag) else None


def _remove_clutter(element: Tag) -> None:
    """Remove navigation, breadcrumbs, feedback forms, and other non-content elements."""
    for selector in _CLUTTER_SELECTORS:
        for tag in element.select(selector):  # pyright: ignore[reportUnknownMemberType]
            tag.decompose()
