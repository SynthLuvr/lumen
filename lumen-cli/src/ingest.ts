import { glob, readFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import ky from "ky";
import { apiPrefix, findCollection } from "./chroma.js";
import { embed } from "./embeddings.js";
import {
  type CollectionInfo,
  CollectionInfoSchema,
  IdsResponseSchema,
} from "./schemas.js";

const BATCH_SIZE = 20;

type IngestOptions = {
  force: boolean;
  dataDir: string;
  collectionName: string;
};

type FileEntry = Awaited<ReturnType<typeof collectFiles>>[number];

const buildRecordId = (dirName: string, filename: string): string => {
  const baseName = basename(filename, extname(filename));
  return (dirName ? `${dirName}/` : "") + baseName;
};

const createCollection = async (name: string): Promise<CollectionInfo> =>
  CollectionInfoSchema.assert(
    await ky(`${apiPrefix()}/collections`, {
      method: "POST",
      json: {
        name,
        configuration: {
          embedding_function: { type: "known", name: "default", config: {} },
        },
      },
    }).json(),
  );

const getExistingIds = async (collectionId: string): Promise<Set<string>> => {
  const existing = new Set<string>();
  const url = `${apiPrefix()}/collections/${collectionId}/get`;
  const limit = 200;
  let offset = 0;

  for (;;) {
    const data = IdsResponseSchema.assert(
      await ky(url, { method: "POST", json: { limit, offset } }).json(),
    );
    if (data.ids.length === 0) break;
    for (const id of data.ids) existing.add(id);
    if (data.ids.length < limit) break;
    offset += limit;
  }
  return existing;
};

const collectFiles = async (
  dataDir: string,
): Promise<
  { filename: string; dirName: string; filePath: string; recordId: string }[]
> => {
  const dataGlob = join(dataDir, "**", "*.md");
  const files: FileEntry[] = [];

  for await (const entry of glob(dataGlob)) {
    const filename = basename(entry);
    const relPath = relative(dataDir, entry);
    const parts = relPath.split("/");
    const dirName = parts.length > 1 ? parts[0] : "";

    files.push({
      filename,
      dirName,
      filePath: entry,
      recordId: buildRecordId(dirName, filename),
    });
  }

  return files;
};

const filterUnuploaded = (
  files: FileEntry[],
  existingIds: Set<string>,
): FileEntry[] => files.filter((f) => !existingIds.has(f.recordId));

const addBatch = async (
  collectionId: string,
  files: FileEntry[],
  embeddings: number[][],
): Promise<void> => {
  await ky(`${apiPrefix()}/collections/${collectionId}/add`, {
    method: "POST",
    json: {
      ids: files.map((f) => f.recordId),
      embeddings,
      documents: await Promise.all(
        files.map((f) => readFile(f.filePath, "utf-8")),
      ),
      metadatas: files.map((f) => ({
        filename: f.filename,
        directory: f.dirName,
      })),
    },
  });
};

const embedAndUpload = async (
  collectionId: string,
  batch: FileEntry[],
): Promise<void> => {
  const documents = await Promise.all(
    batch.map((f) => readFile(f.filePath, "utf-8")),
  );
  const embeddings = await embed(documents);
  await addBatch(collectionId, batch, embeddings);
};

const batchKey = (files: FileEntry[]): string =>
  files.map((f) => `${f.dirName}/${f.filename}`).join(", ");

const ingestBatches = async (
  collectionId: string,
  toUpload: FileEntry[],
): Promise<{ uploaded: number; errors: string[] }> => {
  let uploaded = 0;
  const errors: string[] = [];

  for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
    const batch = toUpload.slice(i, i + BATCH_SIZE);

    try {
      await embedAndUpload(collectionId, batch);
      uploaded += batch.length;
      process.stdout.write(`\r  Ingested ${uploaded}/${toUpload.length} files`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${batchKey(batch)}: ${message}`);
    }
  }

  return { uploaded, errors };
};

const ensureCollection = async (name: string): Promise<CollectionInfo> => {
  const existing = await findCollection(name);
  if (existing) return existing;

  console.log(`Creating collection "${name}"...`);
  return createCollection(name);
};

const printDedupSummary = (
  total: number,
  skipped: number,
  toUpload: number,
): void => {
  console.log(`  Total files found:    ${total}`);
  console.log(`  Already uploaded:     ${skipped}`);
  console.log(`  To upload:            ${toUpload}`);
};

const reportResults = (
  uploaded: number,
  errors: string[],
  elapsedSeconds: string,
): void => {
  console.log(`\n\n✅ Ingested ${uploaded} files in ${elapsedSeconds}s.`);

  if (errors.length > 0) {
    console.error(`\n❌ ${errors.length} error(s):`);
    for (const e of errors) console.error(`   ${e}`);
  }
};

const ingestMain = async (options: IngestOptions): Promise<void> => {
  const { dataDir, collectionName, force } = options;

  console.log(`Scanning for markdown files: ${join(dataDir, "**", "*.md")}`);

  const allFiles = await collectFiles(dataDir);

  if (allFiles.length === 0) {
    console.error("No markdown files found!");
    process.exit(1);
  }

  const collection = await ensureCollection(collectionName);

  let toUpload = allFiles;

  if (!force) {
    console.log(
      `\nChecking for already-uploaded records in "${collectionName}"...`,
    );
    const existingIds = await getExistingIds(collection.id);
    const skipped = allFiles.filter((f) => existingIds.has(f.recordId));
    toUpload = filterUnuploaded(allFiles, existingIds);
    printDedupSummary(allFiles.length, skipped.length, toUpload.length);
  } else {
    console.log(
      `Found ${allFiles.length} markdown files (--force, re-ingesting all).`,
    );
  }

  if (toUpload.length === 0) {
    console.log("\n✅ All files already uploaded. Nothing to do.");
    return;
  }

  console.log("\nLoading embedding model (all-MiniLM-L6-v2)...");

  const startTime = Date.now();
  const { uploaded, errors } = await ingestBatches(collection.id, toUpload);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  reportResults(uploaded, errors, elapsed);
};

export { type IngestOptions, ingestMain };
