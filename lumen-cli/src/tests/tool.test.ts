import ky from "ky";
import { beforeAll, describe, expect, it } from "vitest";
import { apiPrefix, COLLECTION_NAME, findCollection } from "../chroma.js";
import { CountSchema } from "../schemas.js";
import {
  formatNhsResults,
  formatResults,
  runSearch,
  runTool,
  type ToolCall,
} from "../tool.js";

const CHROMA_URL = process.env.CHROMA_URL ?? "http://localhost:8000";
const HEALF_COLLECTION = "healf-products";

const chromaAvailable = async (): Promise<boolean> => {
  try {
    await ky(`${CHROMA_URL}/api/v2/heartbeat`);
    return true;
  } catch {
    return false;
  }
};

const getCollectionCount = async (name: string): Promise<number> => {
  const collection = await findCollection(name);
  if (!collection) return 0;
  return CountSchema.assert(
    await ky(`${apiPrefix()}/collections/${collection.id}/count`).json(),
  );
};

const NHS_QUERY = "diabetes symptoms";
const HEALF_QUERY = "vitamin";

describe("runTool — real Chroma integration", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    const ok = await chromaAvailable();
    if (!ok) throw new Error("Chroma is not reachable at localhost:8000");

    const nhsCount = await getCollectionCount(COLLECTION_NAME);
    if (nhsCount === 0)
      throw new Error(
        `Collection "${COLLECTION_NAME}" is empty. Run \`pnpm cli ingest nhs\` first.`,
      );
  });

  describe("search_nhs_condition", () => {
    it("returns formatted results for a valid query", async () => {
      const call: ToolCall = {
        name: "search_nhs_condition",
        arguments: JSON.stringify({ query: NHS_QUERY }),
      };

      const output = await runTool(call);

      expect(output).toMatch(
        /^The following is factual NHS reference information\./,
      );
      expect(output).toContain("```md");
      expect(output).toMatch(/\n---\s*$/);
    });

    it("includes the full document content", async () => {
      const call: ToolCall = {
        name: "search_nhs_condition",
        arguments: JSON.stringify({ query: NHS_QUERY }),
      };

      const output = await runTool(call);

      const blocks = output.match(/```md\n([\s\S]*?)\n```/g) ?? [];
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        const content = block.replace(/^```md\n/, "").replace(/\n```$/, "");
        expect(content.length).toBeGreaterThan(50);
      }
    });

    it("returns the same results as runSearch directly", async () => {
      const call: ToolCall = {
        name: "search_nhs_condition",
        arguments: JSON.stringify({ query: NHS_QUERY }),
      };

      const toolOutput = await runTool(call);
      const directOutput = await runSearch(
        COLLECTION_NAME,
        NHS_QUERY,
        undefined,
        undefined,
        formatNhsResults,
      );

      expect(toolOutput).toBe(directOutput);
    });

    it("respects custom limit argument", async () => {
      const call: ToolCall = {
        name: "search_nhs_condition",
        arguments: JSON.stringify({ query: NHS_QUERY }),
      };

      const output1 = await runTool(call);

      const output2 = await runSearch(
        COLLECTION_NAME,
        NHS_QUERY,
        1,
        undefined,
        formatNhsResults,
      );

      const count1 = (output1.match(/```md/g) ?? []).length;
      const count2 = (output2.match(/```md/g) ?? []).length;
      expect(count1).toBeGreaterThanOrEqual(count2);
      expect(count2).toBeLessThanOrEqual(1);
    });
  });

  describe("search_healf", () => {
    beforeAll(async () => {
      const healfCount = await getCollectionCount(HEALF_COLLECTION);
      if (healfCount === 0)
        throw new Error(
          `Collection "${HEALF_COLLECTION}" is empty. Run \`pnpm cli ingest healf\` first.`,
        );
    });

    it("returns formatted results for a valid query", async () => {
      const call: ToolCall = {
        name: "search_healf",
        arguments: JSON.stringify({ query: HEALF_QUERY }),
      };

      const output = await runTool(call);

      expect(output).not.toMatch(/factual NHS reference information/);
      expect(output).toContain("```md");
      expect(output).toMatch(/\n---\s*$/);
    });
  });

  describe("formatResults", () => {
    it('returns "No results found." for empty array', () => {
      const output = formatResults([]);
      expect(output).toBe("No results found.");
    });

    it("formats a single row correctly", () => {
      const output = formatResults([
        {
          id: "test-1",
          document: "Test document text",
          metadata: { filename: "test.md" },
          score: 0.5,
        },
      ]);

      expect(output).toBe("test.md\n```md\nTest document text\n```\n\n---");
    });

    it("formats multiple rows correctly", () => {
      const output = formatResults([
        {
          id: "a",
          document: "First",
          metadata: { filename: "a.md" },
          score: 0.1,
        },
        {
          id: "b",
          document: "Second",
          metadata: { filename: "b.md" },
          score: 0.2,
        },
      ]);

      expect(output).toBe(
        "a.md\n```md\nFirst\n```\n\nb.md\n```md\nSecond\n```\n\n---",
      );
    });

    it("falls back to id when filename metadata is missing", () => {
      const output = formatResults([
        {
          id: "fallback-id",
          document: "Content",
          metadata: null,
          score: 0.3,
        },
      ]);

      expect(output).toBe("fallback-id\n```md\nContent\n```\n\n---");
    });
  });

  describe("formatNhsResults", () => {
    const NHS_SAFETY_HEADER =
      "The following is factual NHS reference information.";

    it('returns "No results found." for empty array (no annotation)', () => {
      const output = formatNhsResults([]);
      expect(output).toBe("No results found.");
      expect(output).not.toContain("NHS");
    });

    it("prepends the safety annotation for non-empty results", () => {
      const output = formatNhsResults([
        {
          id: "nhs-1",
          document: "Type 2 diabetes information",
          metadata: { filename: "diabetes.md" },
          score: 0.4,
        },
      ]);

      expect(output.startsWith(NHS_SAFETY_HEADER)).toBe(true);
      expect(output).toContain("diabetes.md\n```md\n");
      expect(output).toMatch(/\n---\s*$/);
    });

    it("preserves all row formatting after the header", () => {
      const output = formatNhsResults([
        {
          id: "a",
          document: "First",
          metadata: { filename: "a.md" },
          score: 0.1,
        },
        {
          id: "b",
          document: "Second",
          metadata: { filename: "b.md" },
          score: 0.2,
        },
      ]);

      expect(output.startsWith(NHS_SAFETY_HEADER)).toBe(true);
      expect(output).toContain("a.md\n```md\nFirst\n```");
      expect(output).toContain("b.md\n```md\nSecond\n```");
    });
  });

  describe("error handling", () => {
    it("throws on invalid JSON arguments", async () => {
      const call: ToolCall = {
        name: "search_nhs_condition",
        arguments: "not valid json",
      };

      await expect(runTool(call)).rejects.toThrow();
    });

    it("throws on missing query field", async () => {
      const call: ToolCall = {
        name: "search_nhs_condition",
        arguments: JSON.stringify({ wrong_field: "test" }),
      };

      await expect(runTool(call)).rejects.toThrow();
    });

    it("returns error string for nonexistent collection", async () => {
      const output = await runSearch("nonexistent-collection-xyz", "test");
      expect(output).toContain("not found");
    });
  });
});
