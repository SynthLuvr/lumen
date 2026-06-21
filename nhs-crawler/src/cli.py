"""Command-line entry point for the NHS Conditions scraper."""

from __future__ import annotations

import argparse
import sys

from src.constants import CONDITIONS_INDEX_URL
from src.crawler import discover_subpage_urls, parse_page_to_markdown
from src.pipeline import run_pipeline, save_markdown
from src.utils import slug_from_url


def main() -> int:
    """Run the NHS Conditions scraper from the command line."""
    parser = argparse.ArgumentParser(description="NHS Conditions scraper")
    parser.add_argument(
        "--url",
        type=str,
        default=None,
        help="Scrape a single condition URL (including subpages). "
        "If omitted, scrapes all conditions from the A-to-Z index.",
    )
    parser.add_argument(
        "--page",
        type=str,
        default=None,
        help="Scrape a single specific page URL (no subpage discovery).",
    )
    args = parser.parse_args()

    if args.page:
        print(f"Scraping single page: {args.page}")
        result = parse_page_to_markdown(args.page)
        if result["errors"]:
            print(f"Errors: {result['errors']}")
        else:
            save_markdown(result)
            print(f"Saved: {slug_from_url(args.page)} ({len(result['markdown'])} chars)")
        return 0

    if args.url:
        print(f"Scraping condition: {args.url}")
        subpages = discover_subpage_urls(args.url)
        print(f"Found {len(subpages)} page(s)")
        for url in subpages:
            result = parse_page_to_markdown(url)
            if result["errors"]:
                print(f"  ERROR: {url} — {result['errors']}")
            else:
                save_markdown(result)
                print(f"  Saved: {slug_from_url(url)} ({len(result['markdown'])} chars)")
        return 0

    print(f"Starting NHS Conditions scraper\nIndex: {CONDITIONS_INDEX_URL}\n")
    summary = run_pipeline()
    if "error" in summary:
        print(f"\nPipeline failed: {summary['error']}")
        return 1
    print(
        f"\nPipeline complete: {summary['pages_scraped']} pages scraped, "
        f"{summary['error_count']} errors."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
