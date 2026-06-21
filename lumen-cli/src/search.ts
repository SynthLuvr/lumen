import ky from "ky";
import { apiPrefix, COLLECTION_NAME, findCollection } from "./chroma.js";
import { embedOne } from "./embeddings.js";
import { CountSchema, QueryResponseSchema, type SearchRow } from "./schemas.js";

type FilterOptions = {
  // Maximum L2 distance threshold (inclusive). Lower distance = more similar.
  maxDistance: number;
  limit: number;
};

const localSearch = async (
  collectionId: string,
  queryText: string,
  nResults: number,
): Promise<SearchRow[]> => {
  const queryVector = await embedOne(queryText);

  const resp = await ky(`${apiPrefix()}/collections/${collectionId}/query`, {
    method: "POST",
    json: {
      query_embeddings: [queryVector],
      n_results: nResults,
      include: ["documents", "metadatas", "distances"],
    },
  });

  const data = QueryResponseSchema.assert(await resp.json());
  const ids = data.ids[0] ?? [];
  const docs = data.documents?.[0] ?? [];
  const metas = data.metadatas?.[0] ?? [];
  const dists = data.distances?.[0] ?? [];

  return ids.map((id, i) => ({
    id,
    document: docs[i] ?? null,
    metadata: metas[i] ?? null,
    score: dists[i] ?? null,
  }));
};

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const printResult = (row: SearchRow, index: number): void => {
  const text = row.document ?? "";
  const meta = row.metadata ?? {};
  const preview = truncate(text, 300).replace(/\n/g, " ");

  console.log(`  [${index + 1}] (distance: ${row.score?.toFixed(4) ?? "n/a"})`);
  console.log(`      ID:        ${row.id}`);
  console.log(`      File:      ${meta.filename ?? "n/a"}`);
  console.log(`      Preview:   ${truncate(preview, 200)}`);
  console.log();
};

const printResults = (rows: SearchRow[]): void => {
  console.log(`✅ Showing ${rows.length} results:\n`);
  rows.forEach((row, i) => printResult(row, i));
  console.log(`\n✅ Done.`);
};

const filterByDistance = (
  rows: SearchRow[],
  maxDistance: number,
): SearchRow[] =>
  rows.filter((row) => row.score != null && row.score <= maxDistance);

const requireCollection = (
  collectionName: string,
  collection: { id: string } | null,
): { id: string } => {
  if (!collection) {
    console.error(
      `❌ Collection "${collectionName}" not found. Run \`pnpm cli ingest\` first.`,
    );
    process.exit(1);
  }
  return collection;
};

const requireNonEmptyCount = (collectionName: string, count: number): void => {
  if (count === 0) {
    console.error(
      `❌ Collection "${collectionName}" is empty. Run \`pnpm cli ingest\` first.`,
    );
    process.exit(1);
  }
};

const formatDistanceList = (rows: SearchRow[]): string =>
  rows.map((r) => r.score?.toFixed(4) ?? "n/a").join(", ");

type SearchOptions = FilterOptions & {
  collectionName?: string;
};

const searchMain = async (
  query: string,
  opts: SearchOptions,
): Promise<void> => {
  const collectionName = opts.collectionName ?? COLLECTION_NAME;
  console.log("Connecting to local Chroma...");

  const collection = requireCollection(
    collectionName,
    await findCollection(collectionName),
  );

  const total = CountSchema.assert(
    await ky(`${apiPrefix()}/collections/${collection.id}/count`).json(),
  );

  console.log(
    `Collection "${collectionName}" has ${total.toLocaleString()} records.\n`,
  );

  requireNonEmptyCount(collectionName, total);

  console.log("Loading embedding model (all-MiniLM-L6-v2)...");
  console.log(`${"=".repeat(60)}`);
  console.log(`Searching for: "${query}"`);
  console.log(`${"=".repeat(60)}`);

  const rawRows = await localSearch(collection.id, query, opts.limit);
  const filtered = filterByDistance(rawRows, opts.maxDistance);

  console.log(
    `  Fetched ${rawRows.length} results, ${filtered.length} after filtering (maxDistance ≤ ${opts.maxDistance})\n`,
  );

  if (filtered.length === 0) {
    console.error(`❌ No results within max distance ${opts.maxDistance}.`);
    console.error(`   Raw distances: ${formatDistanceList(rawRows)}`);
    process.exit(1);
  }

  printResults(filtered);
};

export {
  type FilterOptions,
  localSearch,
  type SearchOptions,
  type SearchRow,
  searchMain,
};
