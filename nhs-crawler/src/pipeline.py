"""Pipeline orchestration for the NHS Conditions scraper.

Flow: discover conditions → discover subpages → fetch & convert → save → report.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from src.constants import DATA_DIR, MAX_WORKERS, REPORT_DIR, SUMMARY_FILE
from src.crawler import discover_condition_urls, discover_subpage_urls, parse_page_to_markdown
from src.logging_config import get_logger
from src.utils import condition_name_from_url, now_iso, slug_from_url

logger = get_logger()


def run_pipeline() -> dict[str, Any]:
    """Execute the full crawl-and-save pipeline and return the summary dict."""
    logger.info("=" * 70)
    logger.info("NHS Conditions Scraper — Pipeline started")
    logger.info("=" * 70)

    condition_urls = discover_condition_urls()
    if not condition_urls:
        logger.error("No condition URLs found. Aborting.")
        return {"error": "no conditions discovered"}

    (REPORT_DIR / "condition_urls.json").write_text(
        json.dumps(condition_urls, indent=2), encoding="utf-8"
    )

    all_pages: list[str] = []
    for i, hub_url in enumerate(condition_urls, 1):
        slug = condition_name_from_url(hub_url)
        logger.info(f"[{i}/{len(condition_urls)}] Discovering subpages for {slug}")
        all_pages.extend(discover_subpage_urls(hub_url))

    logger.info(f"Total pages to fetch: {len(all_pages)}")

    results: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    def process_page(url: str) -> dict[str, Any]:
        try:
            return parse_page_to_markdown(url)
        except Exception:
            logger.exception(f"FAILED: {url}")
            return {
                "url": url,
                "title": "",
                "markdown": "",
                "status": None,
                "errors": ["exception"],
            }

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(process_page, url): url for url in all_pages}
        done_count = 0
        for future in as_completed(futures):
            result = future.result()
            done_count += 1
            url = result["url"]

            if result["errors"]:
                logger.warning(f"  [{done_count}/{len(all_pages)}] ERROR: {url}")
                errors.append(result)
                results.append(result)
                continue

            save_markdown(result)
            results.append(result)
            logger.info(
                f"  [{done_count}/{len(all_pages)}] Saved: "
                f"{slug_from_url(url)} ({len(result['markdown'])} chars)"
            )

    summary = _build_summary(condition_urls, all_pages, results, errors)
    SUMMARY_FILE.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    logger.info(f"Summary written to {SUMMARY_FILE}")
    logger.info(
        f"Pages scraped: {summary['pages_scraped']}, "
        f"Errors: {summary['error_count']}, "
        f"Total markdown: {summary['total_markdown_chars']} chars"
    )
    return summary


def save_markdown(result: dict[str, Any]) -> None:
    """Save a parsed page's Markdown to ``data/<condition>/<subpage>.md``."""
    url = result["url"]
    condition_slug = condition_name_from_url(url)
    page_slug = slug_from_url(url)

    if page_slug.startswith(f"{condition_slug}__"):
        filename = page_slug.removeprefix(f"{condition_slug}__")
    elif page_slug == condition_slug:
        filename = "index"
    else:
        filename = page_slug

    out_dir = DATA_DIR / condition_slug
    out_dir.mkdir(parents=True, exist_ok=True)

    header = f"# {result.get('title', '')}\n\n> Source: {url}\n\n"
    (out_dir / f"{filename}.md").write_text(header + result["markdown"], encoding="utf-8")


def _build_summary(
    condition_urls: list[str],
    all_pages: list[str],
    results: list[dict[str, Any]],
    errors: list[dict[str, Any]],
) -> dict[str, Any]:
    """Aggregate results into a summary report."""
    total_chars = sum(len(r.get("markdown", "")) for r in results)
    empty_pages = [r["url"] for r in results if not r.get("markdown", "").strip()]

    return {
        "run_at": now_iso(),
        "index_url": "https://www.nhs.uk/health-a-to-z/conditions/",
        "conditions_discovered": len(condition_urls),
        "pages_discovered": len(all_pages),
        "pages_scraped": len(results) - len(errors),
        "error_count": len(errors),
        "total_markdown_chars": total_chars,
        "empty_pages": empty_pages,
        "errors": [{"url": e["url"], "errors": e["errors"]} for e in errors],
    }
