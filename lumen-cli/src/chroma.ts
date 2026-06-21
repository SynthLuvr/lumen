import ky from "ky";
import { type CollectionInfo, CollectionListSchema } from "./schemas.js";

const COLLECTION_NAME = "nhs-conditions";
const CHROMA_URL = process.env.CHROMA_URL ?? "http://localhost:8000";
const TENANT = process.env.CHROMA_TENANT ?? "default_tenant";
const DATABASE = process.env.CHROMA_DATABASE ?? "default_database";
const API_BASE = `${CHROMA_URL}/api/v2`;

const apiPrefix = (): string =>
  `${API_BASE}/tenants/${TENANT}/databases/${DATABASE}`;

const findCollection = async (name: string): Promise<CollectionInfo | null> => {
  const collections = CollectionListSchema.assert(
    await ky(`${apiPrefix()}/collections`).json(),
  );
  return collections.find((c) => c.name === name) ?? null;
};

export {
  apiPrefix,
  CHROMA_URL,
  COLLECTION_NAME,
  DATABASE,
  findCollection,
  TENANT,
};
