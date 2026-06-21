"""Pipeline orchestration: discover products → fetch & convert → save → report."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from src.constants import DATA_DIR, MAX_WORKERS, REPORT_DIR, SUMMARY_FILE, TARGET_VENDORS
from src.crawler import discover_product_handles, parse_product, render_markdown
from src.logging_config import get_logger
from src.utils import now_iso, product_slug_from_handle

logger = get_logger()


def run_pipeline() -> dict[str, Any]:
    """Execute the full crawl-and-save pipeline and return the summary dict."""
    logger.info("=" * 70)
    logger.info("Healf Product Crawler — Pipeline started")
    logger.info(f"Target vendors: {', '.join(sorted(TARGET_VENDORS))}")
    logger.info("=" * 70)

    products = discover_product_handles()
    if not products:
        logger.error("No target products found. Aborting.")
        return {"error": "no products discovered"}

    (REPORT_DIR / "product_handles.json").write_text(
        json.dumps(products, indent=2), encoding="utf-8"
    )

    handles = [p["handle"] for p in products]
    logger.info(f"Total products to fetch: {len(handles)}")

    results: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    def process_product(handle: str) -> dict[str, Any]:
        try:
            return parse_product(handle)
        except Exception:
            logger.exception(f"FAILED: {handle}")
            return {
                "url": f"https://healf.com/products/{handle}",
                "handle": handle,
                "title": "",
                "errors": ["exception"],
            }

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(process_product, h): h for h in handles}
        done_count = 0
        for future in as_completed(futures):
            result = future.result()
            done_count += 1
            handle = result.get("handle", futures[future])

            if result.get("errors"):
                logger.warning(f"  [{done_count}/{len(handles)}] ERROR: {handle}")
                errors.append(result)
                results.append(result)
                continue

            save_markdown(result)
            results.append(result)
            logger.info(
                f"  [{done_count}/{len(handles)}] Saved: "
                f"{product_slug_from_handle(handle)} "
                f"({len(result.get('markdown', ''))} chars)"
            )

    summary = _build_summary(products, results, errors)
    SUMMARY_FILE.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    logger.info(f"Summary written to {SUMMARY_FILE}")
    logger.info(
        f"Products scraped: {summary['products_scraped']}, "
        f"Errors: {summary['error_count']}, "
        f"Total markdown: {summary['total_markdown_chars']} chars"
    )
    return summary


def save_markdown(result: dict[str, Any]) -> None:
    """Render a product result to Markdown and write it to ``data/<slug>.md``."""
    markdown = render_markdown(result)
    result["markdown"] = markdown

    slug = product_slug_from_handle(result["handle"])
    (DATA_DIR / f"{slug}.md").write_text(markdown, encoding="utf-8")


def _build_summary(
    products: list[dict[str, str]],
    results: list[dict[str, Any]],
    errors: list[dict[str, Any]],
) -> dict[str, Any]:
    """Aggregate results into a summary report."""
    total_chars = sum(len(r.get("markdown", "")) for r in results if not r.get("errors"))
    empty_pages = [
        r.get("handle", r.get("url", ""))
        for r in results
        if not r.get("errors") and not r.get("markdown", "").strip()
    ]

    by_vendor: dict[str, int] = {}
    for p in products:
        by_vendor[p["vendor"]] = by_vendor.get(p["vendor"], 0) + 1

    return {
        "run_at": now_iso(),
        "target_vendors": sorted(TARGET_VENDORS),
        "products_discovered": len(products),
        "products_by_vendor": by_vendor,
        "products_scraped": len(results) - len(errors),
        "error_count": len(errors),
        "total_markdown_chars": total_chars,
        "empty_pages": empty_pages,
        "errors": [{"handle": e.get("handle"), "errors": e.get("errors")} for e in errors],
    }
