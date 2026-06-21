"""Path and URL constants for the Healf product crawler."""

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

SITE_ORIGIN: str = "https://healf.com"
START_URL: str = (
    "https://healf.com/collections/all-products-1?brand=Terranova,Life+Extension,NOW+Foods"
)
PRODUCT_URL_TEMPLATE: str = "https://healf.com/products/{handle}"

# Discovered from the site's client bundle.
SHOPIFY_STOREFRONT_URL: str = "https://how2go.myshopify.com/api/2026-01/graphql.json"
SHOPIFY_STOREFRONT_TOKEN: str = "67845e61e61fb1cf26199378112390b3"
ALL_PRODUCTS_COLLECTION_HANDLE: str = "all-products-1"

TARGET_VENDORS: frozenset[str] = frozenset({"Terranova", "Life Extension", "NOW Foods"})

MAX_WORKERS: int = 4
PAGE_SIZE: int = 250
