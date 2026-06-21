import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCustomerInfo, runTool, type ToolCall } from "../tool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = join(__dirname, "..", "..", "..", "my-profile");

const readProfile = async (filename: string): Promise<string> =>
  readFile(join(PROFILE_DIR, filename), "utf-8");

describe("get_customer_info via runTool", () => {
  describe('type: "blood-tests"', () => {
    it("returns the raw blood test TOON data", async () => {
      const call: ToolCall = {
        name: "get_customer_info",
        arguments: JSON.stringify({ type: "blood-tests" }),
      };

      const output = await runTool(call);
      const expected = await readProfile("blood_tests.toon");

      expect(output).toBe(expected);
    });

    it("contains blood test markers in TOON format", async () => {
      const call: ToolCall = {
        name: "get_customer_info",
        arguments: JSON.stringify({ type: "blood-tests" }),
      };

      const output = await runTool(call);

      expect(output).toMatch(/markers\[\d+\]\{.*\}:/);
      expect(output).toContain("test_date");
    });
  });

  describe('type: "wearable-data"', () => {
    it("returns the raw wearable data TOON data", async () => {
      const call: ToolCall = {
        name: "get_customer_info",
        arguments: JSON.stringify({ type: "wearable-data" }),
      };

      const output = await runTool(call);
      const expected = await readProfile("wearable_data.toon");

      expect(output).toBe(expected);
    });

    it("contains wearable device metrics in TOON format", async () => {
      const call: ToolCall = {
        name: "get_customer_info",
        arguments: JSON.stringify({ type: "wearable-data" }),
      };

      const output = await runTool(call);

      expect(output).toContain("wearable");
      expect(output).toContain("device");
      expect(output).toContain("metrics");
    });
  });

  describe("argument validation", () => {
    it("throws on invalid JSON arguments", async () => {
      const call: ToolCall = {
        name: "get_customer_info",
        arguments: "not valid json",
      };

      await expect(runTool(call)).rejects.toThrow();
    });

    it("throws on missing type field", async () => {
      const call: ToolCall = {
        name: "get_customer_info",
        arguments: JSON.stringify({ wrong_field: "blood-tests" }),
      };

      await expect(runTool(call)).rejects.toThrow();
    });

    it("throws on invalid type value", async () => {
      const call: ToolCall = {
        name: "get_customer_info",
        arguments: JSON.stringify({ type: "invalid-type" }),
      };

      await expect(runTool(call)).rejects.toThrow();
    });
  });
});

describe("runCustomerInfo", () => {
  it('returns the blood test file content for "blood-tests"', async () => {
    const output = await runCustomerInfo("blood-tests");
    const expected = await readProfile("blood_tests.toon");
    expect(output).toBe(expected);
  });

  it('returns the wearable data file content for "wearable-data"', async () => {
    const output = await runCustomerInfo("wearable-data");
    const expected = await readProfile("wearable_data.toon");
    expect(output).toBe(expected);
  });
});
