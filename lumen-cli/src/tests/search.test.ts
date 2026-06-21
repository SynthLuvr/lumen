import ky from "ky";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embedOne } from "../embeddings.js";
import { CountSchema, IdOnlySchema } from "../schemas.js";
import { localSearch, type SearchRow } from "../search.js";

const TEST_COLLECTION = "vitest-search-tests";
const TENANT = process.env.CHROMA_TENANT ?? "default_tenant";
const DATABASE = process.env.CHROMA_DATABASE ?? "default_database";
const CHROMA_URL = process.env.CHROMA_URL ?? "http://localhost:8000";
const PREFIX = `${CHROMA_URL}/api/v2/tenants/${TENANT}/databases/${DATABASE}`;

const chromaAvailable = async (): Promise<boolean> => {
  try {
    await ky(`${CHROMA_URL}/api/v2/heartbeat`);
    return true;
  } catch {
    return false;
  }
};

const deleteCollection = async (name: string): Promise<void> => {
  const resp = await ky(`${PREFIX}/collections/${name}`, {
    method: "DELETE",
    throwHttpErrors: false,
  });
  // 404 is fine — means it's already gone
  if (!resp.ok && resp.status !== 404) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Failed to delete collection: ${resp.status} — ${text}`);
  }
};

const createTestCollection = async (): Promise<string> => {
  await deleteCollection(TEST_COLLECTION);
  await new Promise((r) => setTimeout(r, 500));

  const collection = IdOnlySchema.assert(
    await ky(`${PREFIX}/collections`, {
      method: "POST",
      json: {
        name: TEST_COLLECTION,
        configuration: {
          embedding_function: { type: "known", name: "default", config: {} },
        },
        metadata: { description: "vitest test collection" },
      },
    }).json(),
  );
  return collection.id;
};

const deleteTestCollection = async (collectionId: string): Promise<void> => {
  await ky(`${PREFIX}/collections/${collectionId}`, {
    method: "DELETE",
    throwHttpErrors: false,
  });
};

const addDocuments = async (
  collectionId: string,
  ids: string[],
  documents: string[],
): Promise<void> => {
  // Chroma v2 requires explicit embeddings even with a configured embedding
  // function, so we embed client-side with the same model localSearch uses.
  const embeddings: number[][] = [];
  for (const doc of documents) {
    embeddings.push(await embedOne(doc));
  }

  await ky(`${PREFIX}/collections/${collectionId}/add`, {
    method: "POST",
    json: { ids, documents, embeddings },
  });
};

const getCollectionCount = async (collectionId: string): Promise<number> =>
  CountSchema.assert(
    await ky(`${PREFIX}/collections/${collectionId}/count`).json(),
  );

const testDocs = [
  {
    id: "doc-diabetes",
    text: "Diabetes is a lifelong condition that causes a person's blood sugar level to become too high. There are two main types of diabetes: type 1 and type 2.",
  },
  {
    id: "doc-asthma",
    text: "Asthma is a common lung condition that causes occasional breathing difficulties. It affects people of all ages and often starts in childhood.",
  },
  {
    id: "doc-flu",
    text: "Flu (influenza) is a common infectious viral illness spread by coughs and sneezes. It can be very unpleasant, but most people recover within a week.",
  },
  {
    id: "doc-nutrition",
    text: "A balanced diet and good nutrition are essential for maintaining a healthy weight and preventing chronic diseases such as heart disease.",
  },
  {
    id: "doc-vaccines",
    text: "Vaccines protect against serious and potentially deadly diseases. They work by training the immune system to recognise and fight infections.",
  },
];

describe.sequential("localSearch — real Chroma integration", {
  timeout: 120_000,
}, () => {
  let collectionId: string;

  beforeAll(async () => {
    const ok = await chromaAvailable();
    if (!ok) throw new Error("Chroma is not reachable at localhost:8000");

    collectionId = await createTestCollection();

    await addDocuments(
      collectionId,
      testDocs.map((d) => d.id),
      testDocs.map((d) => d.text),
    );

    // Poll until documents are indexed
    let count = 0;
    let attempts = 0;
    while (count < testDocs.length && attempts < 30) {
      await new Promise((r) => setTimeout(r, 500));
      count = await getCollectionCount(collectionId);
      attempts++;
    }

    if (count < testDocs.length)
      throw new Error(
        `Documents not fully indexed after ${attempts} attempts (count=${count})`,
      );
  });

  afterAll(async () => {
    if (collectionId) await deleteTestCollection(collectionId);
  });

  it("returns results sorted by relevance (semantic match)", async () => {
    const rows: SearchRow[] = await localSearch(
      collectionId,
      "blood sugar diabetes",
      3,
    );

    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe("doc-diabetes");

    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].score;
      const curr = rows[i].score;
      if (prev != null && curr != null)
        expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it("returns the correct document for an asthma query", async () => {
    const rows = await localSearch(collectionId, "breathing problems lungs", 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("doc-asthma");
  });

  it("returns the correct document for a vaccine query", async () => {
    const rows = await localSearch(
      collectionId,
      "immunisation protection against infections",
      1,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("doc-vaccines");
  });

  it("respects nResults limit", async () => {
    for (const n of [1, 2, 5]) {
      const rows = await localSearch(collectionId, "health and medicine", n);
      expect(rows).toHaveLength(n);
    }
  });

  it("handles nResults larger than collection size", async () => {
    const rows = await localSearch(collectionId, "health", 100);
    expect(rows.length).toBeLessThanOrEqual(testDocs.length);
    expect(rows.length).toBe(testDocs.length);
  });

  it("returns all documents when nResults equals collection size", async () => {
    const rows = await localSearch(collectionId, "health", testDocs.length);
    expect(rows).toHaveLength(testDocs.length);

    const returnedIds = new Set(rows.map((r) => r.id));
    for (const doc of testDocs) {
      expect(returnedIds.has(doc.id)).toBe(true);
    }
  });

  it("includes document text in results", async () => {
    const rows = await localSearch(collectionId, "flu influenza", 1);
    expect(rows[0].document).toBeTruthy();
    expect(rows[0].document).toContain("Flu");
  });

  it("returns non-null scores (L2 distances)", async () => {
    const rows = await localSearch(collectionId, "nutrition", 3);
    for (const row of rows) {
      expect(row.score).not.toBeNull();
      expect(typeof row.score).toBe("number");
      expect(row.score!).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns consistent result structure for all rows", async () => {
    const rows = await localSearch(collectionId, "health", testDocs.length);

    for (const row of rows) {
      expect(typeof row.id).toBe("string");
      expect(row.id.length).toBeGreaterThan(0);
      expect(["string", "object"]).toContain(typeof row.document);
    }
  });

  it("handles an empty query string", async () => {
    const rows = await localSearch(collectionId, "", 3);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.id).toBeTruthy();
    }
  });

  it("returns results for a very specific query", async () => {
    const rows = await localSearch(
      collectionId,
      "balanced diet healthy weight heart disease",
      1,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("doc-nutrition");
  });

  it("produces same results when called twice (deterministic)", async () => {
    const rows1 = await localSearch(collectionId, "flu", 3);
    const rows2 = await localSearch(collectionId, "flu", 3);

    expect(rows1.map((r) => r.id)).toEqual(rows2.map((r) => r.id));
    for (let i = 0; i < rows1.length; i++) {
      expect(rows2[i].score).toBeCloseTo(rows1[i].score!, 4);
    }
  });

  it("throws when collection ID does not exist", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    await expect(localSearch(fakeId, "test query", 1)).rejects.toThrow(
      /Request failed with status code 404/,
    );
  });
});
