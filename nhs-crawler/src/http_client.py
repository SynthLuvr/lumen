"""HTTP session management with retry logic."""

from __future__ import annotations

from requests import Session
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from src.constants import SITE_ORIGIN


def make_session() -> Session:
    """Create a requests Session configured with retries and NHS-friendly headers."""
    retry = Retry(
        total=4,
        backoff_factor=1.2,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET", "HEAD"],
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=20)

    session = Session()
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.update(
        {
            "User-Agent": f"Mozilla/5.0 (compatible; NHSConditionsScraper/1.0; +{SITE_ORIGIN})",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
    )
    return session
