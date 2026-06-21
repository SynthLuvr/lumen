# Lumen

Lumen is a **command-line wellness assistant** for
[Healf](https://healf.com) that answers customer health questions using
NHS clinical information, Healf product data, and the customer’s own
health profile (blood tests, wearable metrics).

It ingests markdown documents into a local
[Chroma](https://docs.trychroma.com/) vector database, then uses OpenAI
function-calling to search that database and compose grounded,
personalised responses — with input safety guardrails that classify and
rewrite every user prompt before it reaches the model.

## Quick Start

``` bash
# 1. Clone the repo
git clone <repo-url> && cd nhs

# 2. Run the setup script (checks prerequisites, starts Chroma,
#    installs dependencies, creates the `lumen` symlink, and
#    ingests all documents into the vector database)
./setup.sh

# 3. Set your OpenAI API key
export OPENAI_API_KEY="sk-..."

# 4. Ask a question
lumen question "What supplements might help with vitamin D deficiency?"
```

That’s it. The `setup.sh` script handles everything — see
[Setup](#setup) for details.

## How It All Fits Together

    ├── nhs-crawler/      Python — scrapes NHS Health A-to-Z conditions
    ├── healf-crawler/    Python — scrapes Healf product catalogue
    ├── my-profile/       Customer health profile in TOON format (blood tests, wearable data)
    ├── lumen-cli/        TypeScript — the `lumen` CLI: ingests, searches, and answers questions
    └── setup.sh          One-command setup: prerequisites → Chroma → dependencies → ingest

The two crawlers are **data sources**. They fetch web pages and convert
them to clean Markdown files in their respective `data/` directories.
Lumen’s `ingest` command reads those Markdown files, generates vector
embeddings, and loads them into Chroma. When a customer asks a question,
Lumen searches Chroma for relevant documents and uses OpenAI to compose
a grounded, personalised answer.

     NHS website              Healf.com
         │                       │
         ▼                       ▼
     nhs-crawler            healf-crawler        (Python scrapers → Markdown files)
         │                       │
         ▼                       ▼
     nhs-crawler/data/      healf-crawler/data/  (~430 Markdown files)
         │                       │
         └─────────┬─────────────┘
                   ▼
            lumen ingest            (embeds & loads into Chroma vector DB)
                   │
                   ▼
             ┌──────────┐
             │  Chroma  │           (local vector database, Docker)
             └────┬─────┘
                  │
                  ▼
           lumen question           (OpenAI function-calling agent)
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
     search     search    get_customer
      NHS       Healf      info
        │         │         │
        └─────────┼─────────┘
                  ▼
         Streamed response        (grounded, personalised answer)

### Data flow at a glance

| Step | What happens | Output |
|----|----|----|
| **Crawl** | Python scrapers fetch NHS condition pages and Healf product pages | `~430` Markdown files |
| **Ingest** | Lumen embeds each Markdown file (`all-MiniLM-L6-v2`) and loads it into Chroma | Two Chroma collections: `nhs-conditions` and `healf-products` |
| **Question** | Lumen classifies the user’s input, rewrites it for safety, then calls OpenAI with tool access to the Chroma collections and the customer profile | A streamed, grounded response |

## Projects

### `lumen-cli/` — The CLI (TypeScript)

The main application. A command-line tool built with Commander.js that
provides three subcommands:

| Command | Purpose |
|----|----|
| `lumen ingest` | Embeds Markdown files from the crawler data directories and loads them into Chroma |
| `lumen search` | Searches the Chroma collections directly (for debugging and verification) |
| `lumen question` | The primary command — asks a question and streams a grounded, personalised response |

**Key technologies:**

- **[Chroma](https://docs.trychroma.com/)** (v2 REST API) — local vector
  database for storing and retrieving document embeddings
- **[Transformers.js](https://huggingface.co/docs/transformers.js)**
  (`all-MiniLM-L6-v2`) — client-side embedding generation, no separate
  embedding API needed
- **[OpenAI Responses
  API](https://platform.openai.com/docs/api-reference/responses)**
  (`gpt-5.4-nano`) — function-calling agent that searches Chroma and
  composes answers
- **Input safety guardrail** — every prompt is classified as GREEN /
  AMBER / RED and rewritten before it reaches the model
- **[ArkType](https://arktype.io/)** — runtime validation for Chroma API
  responses and tool arguments

See the [`lumen-cli/README.md`](lumen-cli/README.md) for full
architecture details.

### `nhs-crawler/` — NHS Conditions Scraper (Python)

A Python scraper for all [NHS Health A to Z condition
pages](https://www.nhs.uk/health-a-to-z/conditions/). It discovers every
condition listed on the index, crawls all subpages, and saves the
content as clean Markdown to `data/`. The converter handles NHS-specific
elements like care cards, do/don’t lists, and inset text.

**Output:** `nhs-crawler/data/<condition-slug>/<subpage>.md`

``` bash
cd nhs-crawler
uv sync
uv run nhs-crawler          # scrape all conditions
```

### `healf-crawler/` — Healf Product Crawler (Python)

A Python crawler for [Healf](https://healf.com) products from three
brands. It discovers matching products, fetches structured data via the
Shopify Storefront API, extracts metafields (ingredients, suggested use)
from React Server Components payloads, and saves each product as clean
Markdown to `data/`.

**Output:** `healf-crawler/data/<product-handle>.md`

``` bash
cd healf-crawler
uv sync
uv run healf-crawler        # crawl all target products
```

### `my-profile/` — Customer Health Profile

Mock customer data in [TOON
format](https://github.com/toon-format/toon), consumed by
`lumen question` to produce personalised health recommendations. Lumen
always includes the basic profile in its system context, and the
`get_customer_info` tool can retrieve blood test results and wearable
metrics on demand.

| File | Contents |
|----|----|
| `profile.toon` | Basic attributes (name, age, sex, location, occupation) |
| `blood_tests.toon` | Blood panel results with 25 markers including reference ranges and status flags |
| `wearable_data.toon` | 30-day Oura Ring averages (sleep, HRV, resting heart rate, readiness) |

Edit these files to customise the customer profile.

## Setup

### Prerequisites

| Requirement | Version | Purpose |
|----|----|----|
| [uv](https://docs.astral.sh/uv/) | latest | Python package manager for the crawlers |
| [Node.js](https://nodejs.org/) | ≥ 20 | Runs the Lumen CLI |
| [pnpm](https://pnpm.io/) | ≥ 10 | Node.js package manager |
| [Docker](https://www.docker.com/) | ≥ 24 | Runs Chroma (the vector database) |
| OpenAI API key | — | Required for `lumen question` |

### `setup.sh`

The setup script at the repository root automates the entire setup
process. Run it from the repository root:

``` bash
./setup.sh
```

It performs these steps in order:

| Step | What it does |
|----|----|
| **1. Platform check** | Verifies Linux or macOS (Windows is not supported — use WSL2) |
| **2. Prerequisites** | Checks for `uv`, Node.js ≥ 20, pnpm ≥ 10, and Docker — with install instructions if anything is missing |
| **3. Start Chroma** | Starts a Chroma Docker container on port 8000 (creates it if it doesn’t exist, starts it if stopped) |
| **4. Install dependencies** | Runs `pnpm install` in `lumen-cli/` |
| **5. Symlink `lumen`** | Creates a `lumen` symlink in `~/.local/bin/` pointing to `lumen-cli/bin/lumen` |
| **6. Ingest documents** | Runs `lumen ingest` to embed and load all Markdown files into Chroma |

The script is **idempotent** — re-running it is safe. It will detect
what’s already done and skip or update as needed.

> **Note:** If `~/.local/bin` is not on your `PATH`, the script will
> print instructions for adding it. Restart your terminal (or
> `source ~/.bashrc`) after adding it.

### Manual setup

If you prefer to set up manually, see the
[`lumen-cli/README.md`](lumen-cli/README.md) for step-by-step
instructions covering Chroma, dependencies, environment variables, and
ingestion.

## Usage

### Ask a question

``` bash
# Pass a question directly
lumen question "What supplements might help with vitamin D deficiency?"

# Enter interactive mode (prompts for input)
lumen question
```

When you ask a question, Lumen:

1.  **Classifies** the input through the safety guardrail (GREEN / AMBER
    / RED).
2.  **Blocks** RED inputs with a safe refusal.
3.  **Rewrites** GREEN and AMBER inputs to remove injection attempts and
    reframe medical requests as general information.
4.  **Calls OpenAI** (`gpt-5.4-nano`) with three available tools:
    - `search_nhs_condition` — searches the NHS conditions Chroma
      collection
    - `search_healf` — searches the Healf products Chroma collection
    - `get_customer_info` — retrieves the customer’s health profile
5.  **Streams** the response to the terminal.

> **Requires:** `OPENAI_API_KEY` must be set. Documents must be ingested
> first.

### Ingest documents

``` bash
# Ingest both NHS conditions and Healf products (default)
lumen ingest
```

This reads Markdown files from the crawler data directories, generates
embeddings client-side, and adds them to Chroma. It’s idempotent —
already-uploaded files are skipped unless `--force` is passed.

## Environment Variables

| Variable         | Required for     | Default | Description         |
|------------------|------------------|---------|---------------------|
| `OPENAI_API_KEY` | `lumen question` | —       | Your OpenAI API key |

``` bash
export OPENAI_API_KEY="sk-..."
```

## Input Safety Guardrails

Every user input to `lumen question` passes through a safety classifier
before reaching the main LLM:

| Classification | Behaviour |
|----|----|
| **GREEN** | Safe, general wellness question — passed through with minor rewriting |
| **AMBER** | Medical/symptom question — rewritten to request general information only, with explicit instructions not to diagnose or prescribe |
| **RED** | Off-topic, malicious, or prompt injection — blocked with a safe refusal message |

The raw user input is **never** passed directly to the model. Only the
classifier’s rewritten prompt is used.
