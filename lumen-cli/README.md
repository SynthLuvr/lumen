# Lumen

Lumen is a command-line wellness assistant for
[Healf](https://healf.com) that answers customer health questions using
NHS clinical information, Healf product data, and the customer’s own
health profile (blood tests, wearable metrics).

It ingests markdown documents into a [local
Chroma](https://docs.trychroma.com/) vector database, then uses OpenAI
function-calling to search that database and compose grounded,
personalised responses — with input safety guardrails that classify and
rewrite every user prompt before it reaches the model.

Built with TypeScript, [`tsx`](https://github.com/privatenumber/tsx),
and [`pnpm`](https://pnpm.io/).

## How It Works

                             ┌──────────────────────────────────────────────────┐
                             │                  lumen ingest                    │
                             │                                                  │
       data/**/*.md  ──▶  embed (all-MiniLM-L6-v2)  ──▶  POST /api/v2/.../add  │
                             │         (client-side via Transformers.js)        │
                             └─────────────────────┬────────────────────────────┘
                                                   │
                                                   ▼
                                            ┌──────────────┐
                                            │    Chroma    │  (port 8000)
                                            │  collections │
                                            └──────┬───────┘
                                                   │
                             ┌─────────────────────┼──────────────────────┐
                             │                  lumen question            │
                             │                     │                      │
      User input ──▶  Input classifier (GREEN/AMBER/RED)                  │
                             │             │                               │
                        rewritten,    RED = blocked                        │
                        safe prompt       │                                │
                             │            ▼                                │
                             ▼        "I can't help                        │
                       OpenAI (gpt-4.1-nano)   with that."                 │
                        with tool calls ───┐                               │
                             │             ├──▶ search_nhs_condition       │
                             │             ├──▶ search_healf               │
                             │             └──▶ get_customer_info          │
                             │                    │                         │
                             │              tool results fed back           │
                             ▼                    │                         │
                       Streamed response ◀────────┘                        │
                             └──────────────────────────────────────────────┘

## Architecture Overview

| Component | Technology | Purpose |
|----|----|----|
| CLI framework | [Commander.js](https://github.com/tj/commander.js) | Subcommands: `question`, `ingest`, `search` |
| Vector database | [Chroma](https://docs.trychroma.com/) (v2 REST API) | Stores and retrieves document embeddings |
| Embeddings | [Transformers.js](https://huggingface.co/docs/transformers.js) (`all-MiniLM-L6-v2`) | Client-side embedding generation — no separate embedding API needed |
| LLM | [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) (`gpt-4.1-nano`) | Function-calling agent that searches Chroma and composes answers |
| Input safety | [OpenAI structured output](https://platform.openai.com/docs/guides/structured-outputs) | Classifies every prompt as GREEN / AMBER / RED and rewrites it before it reaches the main model |
| Runtime validation | [ArkType](https://arktype.io/) | Runtime schemas for Chroma API responses and tool arguments |
| Profile data | [TOON format](https://github.com/toon-format/toon) | Customer blood tests, wearable data, and profile |
| Test runner | [Vitest](https://vitest.dev/) | Unit tests + integration tests |

## Prerequisites

| Requirement | Version | Notes |
|----|----|----|
| Node.js | ≥ 20 |  |
| pnpm | ≥ 10 | [Install](https://pnpm.io/installation) |
| Docker | ≥ 24 | Recommended for running Chroma (see [Chroma setup](#3-chroma-vector-database)) |
| OpenAI API key | — | Required for `lumen question` (see [Environment Variables](#2-environment-variables)) |

## Setup

### 1. Install Dependencies

``` bash
cd lumen-cli
pnpm install
```

### 2. Environment Variables

Lumen requires the following environment variables:

| Variable | Required for | Default | Description |
|----|----|----|----|
| `OPENAI_API_KEY` | `lumen question`, integration tests | — | Your OpenAI API key. Must be set or `lumen question` will exit with an error. |
| `CHROMA_URL` | All commands | `http://localhost:8000` | URL of your running Chroma server |
| `CHROMA_TENANT` | All commands | `default_tenant` | Chroma tenant name |
| `CHROMA_DATABASE` | All commands | `default_database` | Chroma database name |

Set them in your shell (or in `.env` if your environment manager loads
it):

``` bash
export OPENAI_API_KEY="sk-..."
```

> **Note:** `OPENAI_API_KEY` is **not** needed for `lumen ingest` or
> `lumen search` — those commands only use local embeddings and Chroma.
> It is only required for `lumen question` (which calls the OpenAI API)
> and the integration test suite.

### 3. Chroma Vector Database

Chroma must be running before you can ingest documents or ask questions.
The recommended way to run it is via **Docker**, but you can also use
the Chroma CLI.

#### Option A: Docker (Recommended)

``` bash
docker run --name chroma-dev \
  -p 8000:8000 \
  -v /path/to/chroma_data:/chroma/chroma \
  chromadb/chroma:latest
```

Adjust the host path of the volume mount to wherever you want Chroma to
persist its data (e.g. `$(pwd)/chroma_data`). The data will survive
container restarts.

Manage the container:

``` bash
docker stop chroma-dev      # stop
docker start chroma-dev     # restart
docker rm -f chroma-dev     # remove (data persists in the volume)
```

#### Option B: Chroma CLI

If you prefer not to use Docker, you can run Chroma via its CLI. See the
official documentation at <https://docs.trychroma.com/docs/cli/run> for
full details.

Install the Chroma CLI (requires Python):

``` bash
pip install chromadb
```

Start the server:

``` bash
chroma run --path ./chroma_data --host 0.0.0.0 --port 8000
```

#### Verify Chroma is running

``` bash
curl http://localhost:8000/api/v2/heartbeat
# {"nanosecond heartbeat": ...}
```

### 4. Ingest Documents

> **Important:** `lumen ingest` must be run **after** Chroma is running
> and **before** you use `lumen question`. Without ingested documents,
> the search tools will return empty results and `lumen question` will
> have no knowledge base to draw from.

``` bash
# Ingest both NHS conditions and Healf products (default)
lumen ingest

# Or ingest a single source
lumen ingest nhs
lumen ingest healf

# Re-ingest everything, skipping the dedup check
lumen ingest --force
```

This reads every `*.md` file from the data directories (see [Data
Directories](#data-directories)), generates embeddings client-side, and
adds them to the target Chroma collection. The script is idempotent —
already-uploaded files are skipped unless `--force` is passed.

Verify ingestion succeeded:

``` bash
lumen search condition "diabetes"
```

If you see results, the pipeline is working end-to-end.

### 5. Make `lumen` Global (Optional)

The project ships `bin/lumen` — a launcher script that resolves the
project root automatically. Symlink it into a directory on your `PATH`
so you can invoke `lumen` from anywhere:

``` bash
ln -s "$(pwd)/bin/lumen" ~/.local/bin/lumen
```

Verify:

``` bash
lumen --help
```

## Usage

### `lumen question`

Ask a one-off question and stream the response.

``` bash
# Pass a question directly
lumen question "What supplements might help with vitamin D deficiency?"

# Enter interactive mode (prompts for input)
lumen question
```

This is the primary command. It:

1.  Classifies the input through the **input safety guardrail** (GREEN /
    AMBER / RED).
2.  If RED: returns a safe refusal and exits.
3.  If GREEN or AMBER: rewrites the prompt to remove any injection
    attempts and reframe medical requests as general information.
4.  Sends the rewritten prompt to OpenAI (`gpt-4.1-nano`) with three
    available tools:
    - `search_nhs_condition` — searches the NHS conditions Chroma
      collection
    - `search_healf` — searches the Healf products Chroma collection
    - `get_customer_info` — retrieves the customer’s health profile
      (blood tests, wearable data)
5.  Streams the response to the terminal.

> **Requires:** `OPENAI_API_KEY` environment variable must be set.
> **Requires:** Documents must be ingested first (run `lumen ingest`).

### `lumen ingest`

Ingest markdown documents into Chroma. See [Ingest
Documents](#4-ingest-documents).

``` bash
lumen ingest [source] [--force]
```

| Argument / Option | Description                                |
|-------------------|--------------------------------------------|
| `source`          | `nhs`, `healf`, or omit for both (default) |
| `-f, --force`     | Skip dedup check and re-add all files      |

### `lumen search`

Search the Chroma collections directly (bypasses OpenAI). Useful for
verifying ingestion or debugging.

``` bash
# Search NHS conditions
lumen search condition "shortness of breath"
lumen search condition "diabetes symptoms" -n 10 --max-distance 1.2

# Search Healf products
lumen search product "vitamin d" -n 5
```

| Option | Default | Description |
|----|----|----|
| `-n, --limit` | `5` | Number of results to fetch |
| `-d, --max-distance` | `1.5` | Maximum L2 distance (inclusive). Lower = more similar. |

## Data Directories

Lumen reads markdown files from sibling directories relative to the
project root. The directory structure is expected to be:

    nhs/
    ├── lumen-cli/          # this project
    ├── nhs-crawler/        # NHS condition scraper
    │   └── data/           # → ingested into "nhs-conditions" collection
    │       ├── asthma/
    │       │   └── index.md
    │       ├── diabetes/
    │       │   └── index.md
    │       └── ...         # ~198 conditions
    ├── healf-crawler/      # Healf product scraper
    │   └── data/           # → ingested into "healf-products" collection
    │       ├── life-extension-vitamin-d3.md
    │       └── ...         # ~175 products
    └── my-profile/         # customer health profile (TOON format)
        ├── profile.toon
        ├── blood_tests.toon
        └── wearable_data.toon

| Source         | Data directory           | Chroma collection |
|----------------|--------------------------|-------------------|
| NHS conditions | `../nhs-crawler/data/`   | `nhs-conditions`  |
| Healf products | `../healf-crawler/data/` | `healf-products`  |

## Customer Profile

The `lumen question` command loads the customer’s profile from
`../my-profile/` and includes it as system context. The
`get_customer_info` tool can also retrieve blood test results and
wearable data on demand.

| File | Tool `type` parameter | Content |
|----|----|----|
| `profile.toon` | `profile` | General health profile (always included in context) |
| `blood_tests.toon` | `blood-tests` | Recent blood test markers |
| `wearable_data.toon` | `wearable-data` | Wearable device metrics |

Files are in [TOON format](https://github.com/toon-format/toon).

## Embedding Model

Embeddings are generated **client-side** using
[Transformers.js](https://huggingface.co/docs/transformers.js) with the
`all-MiniLM-L6-v2` model — the same default model Chroma uses. This
means:

- No separate embedding API or server is needed.
- The model is downloaded automatically on first run (~25 MB) and cached
  locally.
- Both ingest and search use the same embedding function, ensuring
  consistency.

The first run may take a few seconds to download and initialise the
model. Subsequent runs use the cached model.

## Input Safety Guardrails

Every user input to `lumen question` passes through a safety classifier
before reaching the main LLM. The classifier uses OpenAI structured
output to classify input as:

| Classification | Behaviour |
|----|----|
| **GREEN** | Safe, general wellness question — passed through with minor rewriting |
| **AMBER** | Medical/symptom question — rewritten to request general information only, with an explicit instruction not to diagnose or prescribe |
| **RED** | Off-topic, malicious, or prompt injection — blocked with a safe refusal message |

The raw user input is **never** passed directly to the main model. Only
the classifier’s rewritten prompt is used. If the classifier API call
fails, the system fails closed with an AMBER fallback (safe rewrite with
strict guardrails).

To see classification decisions in development:

``` bash
DEBUG=1 lumen question "what is diabetes?"
# [guardrails] GREEN — General wellness question about a health condition
```

## Testing

``` bash
# Unit tests (no OpenAI or Chroma required)
pnpm test

# Integration tests (requires OPENAI_API_KEY + Chroma running)
pnpm test:integration

# Watch mode for unit tests
pnpm test:watch
```

The integration test suite (`test:integration`) sends real questions
through the full `lumen question` pipeline — guardrails, tool calls, and
streaming — using live OpenAI and a running Chroma instance. Ensure you
have:

1.  Chroma running (`docker start chroma-dev` or `chroma run`)
2.  Documents ingested (`lumen ingest`)
3.  `OPENAI_API_KEY` set

## Linting & Formatting

``` bash
# Type-check
pnpm typecheck

# Run all linters
pnpm lint

# Run all formatters
pnpm format
```

Linters: [Biome](https://biomejs.dev/),
[oxlint](https://oxc.rs/docs/guide/usage/linter), and
[ast-grep](https://ast-grep.github.io/) rules (no inline exports, no
function declarations, strip braces).

## Troubleshooting

### “Collection not found” or “Collection is empty”

Run `lumen ingest` to populate Chroma. Ensure Chroma is running first
(`curl http://localhost:8000/api/v2/heartbeat`).

### “OPENAI_API_KEY environment variable is required”

Set the variable: `export OPENAI_API_KEY="sk-..."`. This is only needed
for `lumen question` and integration tests.

### Embedding model download is slow on first run

The `all-MiniLM-L6-v2` model (~25 MB) is downloaded from Hugging Face on
first use and cached under your system’s Transformers.js cache
directory. Subsequent runs are instant.

### Chroma connection refused

Verify Chroma is running:

``` bash
curl http://localhost:8000/api/v2/heartbeat
```

If using Docker, check the container:

``` bash
docker ps | grep chroma
docker logs chroma-dev
```

If using a non-default port, set `CHROMA_URL`:

``` bash
export CHROMA_URL="http://localhost:9000"
```

### Data directory not found during ingest

Lumen expects sibling directories `../nhs-crawler/data/` and
`../healf-crawler/data/`. Ensure the crawlers have been run and their
output directories exist.
