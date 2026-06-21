# NHS Conditions Scraper

A Python scraper for all [NHS Health A to Z condition
pages](https://www.nhs.uk/health-a-to-z/conditions/). It discovers every
condition listed on the index (198 conditions), crawls all subpages for
each condition (254 pages total), and saves the content as clean
Markdown to `data/`.

## Prerequisites

- **[uv](https://docs.astral.sh/uv/)** — install with:

  ``` bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

- **Python ≥ 3.11** — uv manages this automatically.

## Quick Start

``` bash
cd nhs-crawler
uv sync

# Scrape ALL conditions (198 conditions, 254 pages)
uv run nhs-crawler

# Scrape a single condition (discovers subpages automatically)
uv run nhs-crawler --url https://www.nhs.uk/conditions/type-2-diabetes/

# Scrape a single specific page
uv run nhs-crawler --page https://www.nhs.uk/conditions/type-2-diabetes/treatment/

# Show all options
uv run nhs-crawler --help
```

## Output

Markdown files are saved to `data/<condition-slug>/<subpage>.md`:

    data/
    ├── asthma/
    │   └── index.md              # Inline hub page — no subpages
    ├── type-2-diabetes/
    │   ├── what-is-type-2-diabetes.md
    │   ├── symptoms.md
    │   ├── treatment.md
    │   ├── complications.md
    │   └── support.md
    ├── covid-19/
    │   ├── covid-19-symptoms-and-what-to-do.md
    │   ├── how-to-avoid-catching-and-spreading-covid-19.md
    │   └── treatments-for-covid-19.md
    └── ...                       # 198 conditions, 254 Markdown files

Each file starts with a title and source URL header:

``` markdown
# Asthma

> Source: https://www.nhs.uk/conditions/asthma/

Asthma is a common condition that affects your breathing...
```

### Reports

After a full crawl, two files are written to `reports/`:

- **`condition_urls.json`** — ordered list of all discovered condition
  hub URLs.
- **`summary.json`** — aggregate statistics for the run:

``` json
{
  "run_at": "2026-06-20T18:38:08.937007+00:00",
  "index_url": "https://www.nhs.uk/health-a-to-z/conditions/",
  "conditions_discovered": 198,
  "pages_discovered": 254,
  "pages_scraped": 254,
  "error_count": 0,
  "total_markdown_chars": 1136966,
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

1.  **Discover conditions** — fetches the A-to-Z index page and extracts
    all `/conditions/<slug>/` links using a regex filter.
2.  **Discover subpages** — for each condition hub page, looks for a
    `<ul class="nhsuk-hub-key-links">` navigation element to find
    subpages. Some conditions (like asthma) are single-page with inline
    content — the hub page itself is saved as `index.md`. Others (like
    type-2-diabetes) have dedicated subpages for Symptoms, Treatment,
    etc. — in this case only the subpages are saved (the hub is excluded
    since the subpages contain all the content).
3.  **Fetch & convert** — each page is fetched and its main content
    element (`<div class="nhsuk-grid-column-two-thirds">` inside
    `<article>`) is converted to clean Markdown using a custom NHS-aware
    converter that handles:
    - **Care cards** → blockquotes with emoji prefixes (🚨 ⚠️ 📋)
    - **Do/don’t lists** → bullet lists with ✅/❌ markers
    - **Inset text** → blockquotes with 💡 prefix
    - **Clutter removal** — nav, breadcrumbs, feedback banners, SVGs,
      etc.
4.  **Save** — Markdown is written to `data/<condition>/<subpage>.md`
    with a title and source URL header.
5.  **Report** — `reports/summary.json` with aggregate statistics and
    `reports/condition_urls.json` with the full condition URL list.

### HTTP Strategy

All requests go through a shared `requests.Session` with:

- **Retry**: up to 4 retries with exponential backoff (factor 1.2) on
  HTTP 429, 500, 502, 503, 504.
- **Rate limiting**: 0.5s delay before each request (politeness).
- **Connection pooling**: 10 connections, 20 max pool size.
- **User-Agent**: identifies the scraper with a reference to nhs.uk.
- **Concurrency**: pages are fetched in parallel using a thread pool (4
  workers by default).

## CLI Reference

    usage: nhs-crawler [-h] [--url URL] [--page PAGE]

    NHS Conditions scraper

    options:
      -h, --help   show this help message and exit
      --url URL    Scrape a single condition URL (including subpages).
                   If omitted, scrapes all conditions from the A-to-Z index.
      --page PAGE  Scrape a single specific page URL (no subpage discovery).

## Configuration

Key settings in `src/constants.py`:

| Constant      | Default | Description                           |
|---------------|---------|---------------------------------------|
| `DELAY`       | `0.5`   | Seconds between requests (politeness) |
| `TIMEOUT`     | `30`    | HTTP request timeout (seconds)        |
| `MAX_WORKERS` | `4`     | Parallel threads for page fetching    |

## Development

``` bash
uv sync --all-extras
uv run ruff format src/
uv run ruff check src/
uv run pyright src/
```
