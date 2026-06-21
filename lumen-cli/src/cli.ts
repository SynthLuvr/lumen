import { join } from "node:path";
import { Command } from "commander";
import { COLLECTION_NAME } from "./chroma.js";
import { type IngestOptions, ingestMain } from "./ingest.js";
import { questionMain } from "./question.js";
import {
  type FilterOptions,
  type SearchOptions,
  searchMain,
} from "./search.js";

type SearchActionOptions = {
  limit: string;
  maxDistance: string;
};

const HEALF_DATA_DIR = join(process.cwd(), "..", "healf-crawler", "data");
const HEALF_COLLECTION = "healf-products";

const NHS_DATA_DIR = join(process.cwd(), "..", "nhs-crawler", "data");

type IngestSource = "nhs" | "healf";

const ingestSources: Record<IngestSource, IngestOptions> = {
  nhs: { force: false, dataDir: NHS_DATA_DIR, collectionName: COLLECTION_NAME },
  healf: {
    force: false,
    dataDir: HEALF_DATA_DIR,
    collectionName: HEALF_COLLECTION,
  },
};

const parseSearchOptions = (raw: SearchActionOptions): FilterOptions => {
  const limit = parseInt(raw.limit, 10);
  const maxDistance = parseFloat(raw.maxDistance);

  if (isNaN(limit) || limit < 1) {
    console.error("❌ --limit must be a positive integer.");
    process.exit(1);
  }
  if (isNaN(maxDistance)) {
    console.error("❌ --max-distance must be a number.");
    process.exit(1);
  }

  return { limit, maxDistance };
};

const runSearch =
  (collectionName?: string) =>
  async (query: string, raw: SearchActionOptions): Promise<void> => {
    const opts: SearchOptions = {
      ...parseSearchOptions(raw),
      ...(collectionName ? { collectionName } : {}),
    };
    await searchMain(query, opts);
  };

const resolveIngestSources = (
  source: IngestSource | undefined,
): IngestSource[] =>
  source ? [source] : (Object.keys(ingestSources) as IngestSource[]);

const runIngest = async (
  source: IngestSource | undefined,
  opts: { force: boolean },
): Promise<void> => {
  const sources = resolveIngestSources(source);

  for (const src of sources) {
    if (sources.length > 1) console.log(`\n--- Ingesting ${src} ---`);
    await ingestMain({ ...ingestSources[src], force: opts.force });
  }
};

const addSearchOptions = (cmd: ReturnType<Command["command"]>) =>
  cmd
    .option("-n, --limit <number>", "Number of results to fetch", "5")
    .option(
      "-d, --max-distance <number>",
      "Maximum distance threshold (inclusive). Lower distance = more similar. Default 1.5",
      "1.5",
    );

const program = new Command();

program
  .name("lumen")
  .description(
    "A command-line wellness assistant for Healf that answers customer health questions using NHS clinical information, Healf product data, and customer health profiles",
  );

const search = program
  .command("search")
  .description("Search the local Chroma collection");

addSearchOptions(
  search
    .command("condition")
    .description("Search the NHS conditions local Chroma collection")
    .argument("<query>", "Search query text"),
).action(runSearch());

addSearchOptions(
  search
    .command("product")
    .description("Search the Healf products local Chroma collection")
    .argument("<query>", "Search query text"),
).action(runSearch("healf-products"));

program
  .command("ingest")
  .description("Ingest source files into the local Chroma collection")
  .argument("[source]", "Source to ingest: 'nhs' or 'healf' (default: both)")
  .option("-f, --force", "Skip dedup check and re-add all files", false)
  .action(
    async (source: IngestSource | undefined, opts: { force: boolean }) => {
      await runIngest(source, opts);
    },
  );

program
  .command("question")
  .description("Ask a one-off question and stream the response")
  .argument("[question]", "The question to ask Lumen")
  .action(async (question?: string) => {
    await questionMain(question);
  });

program.parseAsync().catch((err) => {
  console.error("\n❌ Command failed:", err);
  process.exit(1);
});
