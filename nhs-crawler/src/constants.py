"""Path and URL constants for the NHS Conditions scraper."""

from __future__ import annotations

from pathlib import Path

BASE_DIR: Path = Path(__file__).resolve().parent.parent
DATA_DIR: Path = BASE_DIR / "data"
LOG_DIR: Path = BASE_DIR / "logs"
REPORT_DIR: Path = BASE_DIR / "reports"

for _directory in (DATA_DIR, LOG_DIR, REPORT_DIR):
    _directory.mkdir(parents=True, exist_ok=True)

LOG_FILE: Path = LOG_DIR / "crawl.log"
SUMMARY_FILE: Path = REPORT_DIR / "summary.json"

SITE_ORIGIN: str = "https://www.nhs.uk"
CONDITIONS_INDEX_URL: str = "https://www.nhs.uk/health-a-to-z/conditions/"

DELAY: float = 0.5
TIMEOUT: int = 30
MAX_WORKERS: int = 4
