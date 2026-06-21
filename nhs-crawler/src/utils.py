"""URL helpers, slug extraction, and rate-limited HTTP requests."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from urllib.parse import urljoin, urlparse

from src.constants import DELAY, SITE_ORIGIN, TIMEOUT
from src.http_client import make_session
from src.logging_config import get_logger

if TYPE_CHECKING:
    import requests

logger = get_logger()

SESSION = make_session()


def now_iso() -> str:
    """Return the current UTC timestamp as an ISO 8601 string."""
    return datetime.now(UTC).isoformat()


def _path_segments(url: str) -> list[str]:
    """Return non-empty path segments, with any leading 'conditions' prefix removed."""
    segments = urlparse(url).path.strip("/").split("/")
    if segments and segments[0] == "conditions":
        segments = segments[1:]
    return [s for s in segments if s]


def slug_from_url(url: str) -> str:
    """Build a flat slug from a condition (sub)page URL.

    ``https://www.nhs.uk/conditions/asthma/treatment/`` → ``asthma__treatment``
    ``https://www.nhs.uk/conditions/asthma/``           → ``asthma``
    """
    segments = _path_segments(url)
    if len(segments) <= 1:
        return segments[0] if segments else "index"
    return "__".join(segments)


def condition_name_from_url(url: str) -> str:
    """Extract the top-level condition slug from a URL.

    ``https://www.nhs.uk/conditions/asthma/treatment/`` → ``asthma``
    """
    segments = _path_segments(url)
    return segments[0] if segments else "unknown"


def build_absolute_url(href: str, base: str = SITE_ORIGIN) -> str:
    """Resolve a possibly-relative href against the site origin."""
    return urljoin(base, href)


def is_nhs_conditions(url: str) -> bool:
    """Return True if *url* belongs to ``nhs.uk/conditions/``."""
    parsed = urlparse(url)
    return parsed.netloc == "www.nhs.uk" and parsed.path.startswith("/conditions/")


def safe_request(url: str, **kwargs: object) -> requests.Response | None:
    """Rate-limited GET. Returns the Response or None on failure."""
    try:
        time.sleep(DELAY)
        return SESSION.get(url, timeout=TIMEOUT, **kwargs)  # type: ignore[arg-type]
    except Exception as exc:
        logger.warning(f"Request failed {url}: {exc}")
        return None
