# Healf Product Crawler

A Python crawler for a limited set of [Healf](https://healf.com)
products from three brands — **Terranova**, **Life Extension**, and
**NOW Foods**. It discovers every matching product from the collection
listing (~175 products), fetches structured data and rendered page
content, and saves each product as clean Markdown to `data/`.

## Prerequisites

- **[uv](https://docs.astral.sh/uv/)** — install with:

  ``` bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

- **Python ≥ 3.11** — uv manages this automatically.

## Quick Start

``` bash
cd healf-crawler
uv sync

# Crawl ALL target products (~175 products)
uv run healf-crawler

# Scrape a single product by handle or URL
uv run healf-crawler --url terranova-magnesium-complex-50s
uv run healf-crawler --url https://healf.com/products/terranova-magnesium-complex-50s

# List discovered product handles without scraping
uv run healf-crawler --list-only

# Show all options
uv run healf-crawler --help
```

## Dependencies

| Package          | Purpose                               |
|------------------|---------------------------------------|
| `requests`       | HTTP fetching with retry/backoff      |
| `beautifulsoup4` | HTML parsing and DOM manipulation     |
| `lxml`           | Fast parser backend for BeautifulSoup |
| `markdownify`    | HTML → Markdown conversion            |

Dev dependencies (optional, install with `uv sync --all-extras`):

| Package                | Purpose                            |
|------------------------|------------------------------------|
| `ruff`                 | Linting and formatting             |
| `pyright`              | Static type checking (strict mode) |
| `types-requests`       | Type stubs for requests            |
| `types-beautifulsoup4` | Type stubs for BeautifulSoup       |

## Output

Markdown files are saved to `data/<product-handle>.md`:

    data/
    ├── terranova-magnesium-complex-50s.md
    ├── life-extension-neuro-mag-magnesium-l-threonate.md
    ├── now-foods-magnesium-glycinate.md
    └── ...                       # ~175 Markdown files

Each file contains the product name, source URL, brand, price,
description, ingredients, and suggested use:

``` markdown
# Magnesium Complex

> Source: https://healf.com/products/terranova-magnesium-complex-50s

**Brand:** Terranova | **Price:** £13.00

## Description

**Key benefits**
...
```

### Reports

After a full crawl, two files are written to `reports/`:

- **`product_handles.json`** — all discovered product handles with
  vendor and product type.
- **`summary.json`** — aggregate statistics for the run:

``` json
{
  "run_at": "2026-06-20T18:38:08.937007+00:00",
  "target_vendors": ["Life Extension", "NOW Foods", "Terranova"],
  "products_discovered": 175,
  "products_by_vendor": {
    "Terranova": 60,
    "Life Extension": 75,
    "NOW Foods": 40
  },
  "products_scraped": 175,
  "error_count": 0,
  "total_markdown_chars": 980432,
  "empty_pages": [],
  "errors": []
}
```

### Logs

A detailed crawl log is appended to `logs/crawl.log` on every run.

> **Note:** The `data/`, `logs/`, and `reports/` directories are created
> automatically at runtime by `src/constants.py`. They do not need to
> exist beforehand. Consider adding `logs/` and `reports/` to
> `.gitignore` if you don’t want to track generated output.

## How It Works

1.  **Discover products** — queries the Shopify Storefront API for the
    `all-products-1` collection, paginating through all results and
    filtering by vendor (Terranova, Life Extension, NOW Foods).
2.  **Fetch structured data** — for each product, the Storefront API
    returns structured fields: title, vendor, price, and
    `descriptionHtml`.
3.  **Extract metafields from RSC** — the product detail page embeds
    private metafields (`ingredients`, `suggested_use`) inside
    `self.__next_f.push(...)` chunks in the React Server Components
    payload. These are not exposed via the Storefront API, so they are
    parsed from the rendered page’s HTML.
4.  **Convert** — all HTML content fragments (description, ingredients,
    suggested use) are converted to clean Markdown. Clutter tags
    (buttons, forms, inputs, SVGs, scripts, styles, iframes) are
    stripped and blank lines are collapsed.
5.  **Save** — Markdown is written to `data/<product-handle>.md` with a
    title, source URL, and structured metadata header.
6.  **Report** — `reports/summary.json` with aggregate statistics and
    `reports/product_handles.json` with the full product handle list.

### HTTP Strategy

All requests go through a shared `requests.Session` with:

- **Retry**: up to 4 retries with exponential backoff (factor 1.2) on
  HTTP 429, 500, 502, 503, 504.
- **Connection pooling**: 10 connections, 20 max pool size.
- **User-Agent**: identifies the crawler with a reference to healf.com.
- **Concurrency**: products are fetched in parallel using a thread pool
  (4 workers by default).

## CLI Reference

    usage: healf-crawler [-h] [--url URL] [--list-only]

    Healf product crawler

    options:
      -h, --help     show this help message and exit
      --url URL      Scrape a single product by its Healf product page URL or
                     Shopify handle. If omitted, crawls all target products from
                     the collection listing.
      --list-only    Only discover and list target product handles, then exit.

## Configuration

Key settings in `src/constants.py`:

| Constant | Default | Description |
|----|----|----|
| `MAX_WORKERS` | `4` | Parallel threads for product fetching |
| `PAGE_SIZE` | `250` | Products per Storefront API page |
| `TARGET_VENDORS` | `Terranova, Life Extension, NOW Foods` | Vendors to filter from the collection |
| `START_URL` | `.../collections/all-products-1` | Healf collection page URL |

## Development

``` bash
uv sync --all-extras
uv run ruff format src/
uv run ruff check src/
uv run pyright src/
```
