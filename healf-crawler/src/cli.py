"""Command-line entry point for the Healf product crawler."""

from __future__ import annotations

import argparse
import sys

from src.constants import START_URL
from src.crawler import discover_product_handles, parse_product, render_markdown
from src.pipeline import run_pipeline, save_markdown
from src.utils import product_slug_from_handle


def main() -> int:
    """Run the Healf product crawler from the command line."""
    parser = argparse.ArgumentParser(description="Healf product crawler")
    parser.add_argument(
        "--url",
        type=str,
        default=None,
        help="Scrape a single product by its Healf product page URL or Shopify handle.",
    )
    parser.add_argument(
        "--list-only",
        action="store_true",
        help="Only discover and list target product handles, then exit.",
    )
    args = parser.parse_args()

    if args.list_only:
        products = discover_product_handles()
        for p in products:
            print(f"  {p['vendor']:20s}  {p['handle']}")
        print(f"\nTotal: {len(products)} products")
        return 0

    if args.url:
        handle = args.url.rstrip("/").split("/")[-1]
        print(f"Scraping single product: {handle}")
        result = parse_product(handle)
        if result.get("errors"):
            print(f"Errors: {result['errors']}")
        else:
            save_markdown(result)
            markdown = render_markdown(result)
            print(f"Saved: {product_slug_from_handle(handle)} ({len(markdown)} chars)")
            print("\n" + "-" * 60 + "\n")
            print(markdown[:1500])
        return 0

    print(f"Starting Healf Product Crawler\nSource: {START_URL}\n")
    summary = run_pipeline()
    if "error" in summary:
        print(f"\nPipeline failed: {summary['error']}")
        return 1
    print(
        f"\nPipeline complete: {summary['products_scraped']} products scraped, "
        f"{summary['error_count']} errors."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
