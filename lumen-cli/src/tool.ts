import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type } from "arktype";
import { COLLECTION_NAME, findCollection } from "./chroma.js";
import { localSearch, type SearchRow } from "./search.js";

const HEALF_COLLECTION = "healf-products";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = join(__dirname, "..", "..", "my-profile");

const PROFILE_FILES: Record<string, string> = {
  "blood-tests": "blood_tests.toon",
  "wearable-data": "wearable_data.toon",
  profile: "profile.toon",
};

const DEFAULT_LIMIT = 5;
const DEFAULT_MAX_DISTANCE = 1.5;

const JsonArguments = type("string").pipe((v) => JSON.parse(v));
const SearchArguments = JsonArguments.pipe(type({ query: "string" }));
const CustomerInfoArguments = JsonArguments.pipe(
  type({ type: "'blood-tests' | 'wearable-data' | 'profile'" }),
);

type ToolName = "search_nhs_condition" | "search_healf" | "get_customer_info";

type ToolCall = {
  name: ToolName;
  arguments: string;
};

const formatRow = (row: SearchRow): string => {
  const name = row.metadata?.filename ?? row.id;
  const content = row.document ?? "";
  return `${name}\n\`\`\`md\n${content}\n\`\`\``;
};

const formatResults = (rows: SearchRow[]): string => {
  if (rows.length === 0) return "No results found.";
  return `${rows.map((row) => formatRow(row)).join("\n\n")}\n\n---`;
};

// NHS results are prepended with a safety annotation so the model treats them
// as reference material, not as a diagnosis or prescription.
const NHS_SAFETY_HEADER =
  "The following is factual NHS reference information. Summarise it as general wellness guidance only. Do not interpret it as a diagnosis, prescription, dosage instruction, or urgency assessment for this specific user.";

const formatNhsResults = (rows: SearchRow[]): string => {
  if (rows.length === 0) return "No results found.";
  return `${NHS_SAFETY_HEADER}\n\n${formatResults(rows)}`;
};

const filterByDistance = (
  rows: SearchRow[],
  maxDistance: number,
): SearchRow[] =>
  rows.filter((row) => row.score != null && row.score <= maxDistance);

const runSearch = async (
  collectionName: string,
  query: string,
  limit = DEFAULT_LIMIT,
  maxDistance = DEFAULT_MAX_DISTANCE,
  formatter: (rows: SearchRow[]) => string = formatResults,
): Promise<string> => {
  const collection = await findCollection(collectionName);
  if (!collection) return `Collection "${collectionName}" not found.`;

  const rows = await localSearch(collection.id, query, limit);
  return formatter(filterByDistance(rows, maxDistance));
};

const describeProfileTypes = (): string =>
  Object.keys(PROFILE_FILES).join(", ");

const runCustomerInfo = async (infoType: string): Promise<string> => {
  const filename = PROFILE_FILES[infoType];
  if (!filename)
    return `Unknown profile type "${infoType}". Available: ${describeProfileTypes()}`;

  try {
    return await readFile(join(PROFILE_DIR, filename), "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return `Could not read profile file "${filename}": ${message}`;
  }
};

const handleNhsSearch = (call: ToolCall): Promise<string> => {
  const { query } = SearchArguments.assert(call.arguments);
  return runSearch(
    COLLECTION_NAME,
    query,
    DEFAULT_LIMIT,
    DEFAULT_MAX_DISTANCE,
    formatNhsResults,
  );
};

const handleHealfSearch = (call: ToolCall): Promise<string> => {
  const { query } = SearchArguments.assert(call.arguments);
  return runSearch(HEALF_COLLECTION, query);
};

const handleCustomerInfo = (call: ToolCall): Promise<string> => {
  const { type: infoType } = CustomerInfoArguments.assert(call.arguments);
  return runCustomerInfo(infoType);
};

const toolHandlers: Record<ToolName, (call: ToolCall) => Promise<string>> = {
  search_nhs_condition: handleNhsSearch,
  search_healf: handleHealfSearch,
  get_customer_info: handleCustomerInfo,
};

const runTool = async (call: ToolCall): Promise<string> =>
  toolHandlers[call.name](call);

export {
  formatNhsResults,
  formatResults,
  formatRow,
  runCustomerInfo,
  runSearch,
  runTool,
  type ToolCall,
  type ToolName,
};
