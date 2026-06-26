import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type OpenAI from "openai";

type SafetyClassification = "GREEN" | "AMBER" | "RED";

type InputSafetyClassification = {
  classification: SafetyClassification;
  reason: string;
  rewrittenPrompt: string | null;
};

const RED_INPUT_RESPONSE =
  "I'm here to help with general wellness information and product guidance. I can't help with that request.";

const INPUT_CLASSIFIER_MODEL =
  process.env["INPUT_CLASSIFIER_MODEL"] ?? "gpt-4.1-nano";

const ALLOWED_CLASSIFICATIONS = new Set<SafetyClassification>([
  "GREEN",
  "AMBER",
  "RED",
]);

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROMPTS_DIR = join(__dirname, "prompts");

const CLASSIFIER_INSTRUCTIONS = readFileSync(
  join(PROMPTS_DIR, "input-classifier-instructions.md"),
  "utf-8",
).trim();

const FALLBACK_SAFE_REWRITE_TEMPLATE = readFileSync(
  join(PROMPTS_DIR, "fallback-safe-rewrite.md"),
  "utf-8",
).trim();

// Local safe rewrite used when the classifier fails or returns invalid output.
const fallbackSafeRewrite = (rawUserInput: string): string =>
  FALLBACK_SAFE_REWRITE_TEMPLATE.replace("{{RAW_USER_INPUT}}", rawUserInput);

const CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    classification: {
      type: "string",
      enum: ["GREEN", "AMBER", "RED"],
    },
    reason: {
      type: "string",
    },
    rewrittenPrompt: {
      type: ["string", "null"],
    },
  },
  required: ["classification", "reason", "rewrittenPrompt"],
  additionalProperties: false,
} as const;

// Delimit raw input so the classifier cannot mistake it for instructions.
const buildClassifierMessage = (rawUserInput: string): string =>
  `<RAW_USER_INPUT_START>\n${rawUserInput}\n<RAW_USER_INPUT_END>\n\n` +
  "Classify the input above and produce a rewritten prompt if appropriate.";

const classifyWithOpenAI = async (
  openai: OpenAI,
  rawUserInput: string,
): Promise<string> => {
  const response = await openai.responses.create({
    model: INPUT_CLASSIFIER_MODEL,
    instructions: CLASSIFIER_INSTRUCTIONS,
    input: buildClassifierMessage(rawUserInput),
    temperature: 0,
    text: {
      format: {
        type: "json_schema",
        name: "input_safety_classification",
        schema: CLASSIFICATION_JSON_SCHEMA,
        strict: true,
      },
    },
  });
  return response.output_text;
};

const amberFallback = (
  rawUserInput: string,
  reason: string,
): InputSafetyClassification => ({
  classification: "AMBER",
  reason,
  rewrittenPrompt: fallbackSafeRewrite(rawUserInput),
});

const isAllowedClassification = (
  value: unknown,
): value is SafetyClassification =>
  typeof value === "string" &&
  ALLOWED_CLASSIFICATIONS.has(value as SafetyClassification);

const extractClassification = (
  parsed: Record<string, unknown>,
): SafetyClassification =>
  isAllowedClassification(parsed["classification"])
    ? parsed["classification"]
    : "AMBER";

const extractReason = (parsed: Record<string, unknown>): string =>
  typeof parsed["reason"] === "string" ? (parsed["reason"] as string) : "";

const determineRewrittenPrompt = (
  parsed: Record<string, unknown>,
  classification: SafetyClassification,
  rawUserInput: string,
): string | null => {
  if (classification === "RED") return null;

  const rawRewritten = parsed["rewrittenPrompt"];
  if (typeof rawRewritten === "string" && rawRewritten.trim())
    return rawRewritten;

  return fallbackSafeRewrite(rawUserInput);
};

const parseClassificationOutput = (
  rawOutput: string,
  rawUserInput: string,
): InputSafetyClassification => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawOutput) as Record<string, unknown>;
  } catch {
    return amberFallback(
      rawUserInput,
      "Classifier returned invalid JSON; using safe fallback.",
    );
  }

  const classification = extractClassification(parsed);

  return {
    classification,
    reason: extractReason(parsed),
    rewrittenPrompt: determineRewrittenPrompt(
      parsed,
      classification,
      rawUserInput,
    ),
  };
};

const classifyAndRewriteUserInput = async (
  openai: OpenAI,
  rawUserInput: string,
): Promise<InputSafetyClassification> => {
  let rawOutput: string;

  try {
    rawOutput = await classifyWithOpenAI(openai, rawUserInput);
  } catch {
    return amberFallback(
      rawUserInput,
      "Classifier call failed; using safe fallback.",
    );
  }

  return parseClassificationOutput(rawOutput, rawUserInput);
};

export {
  CLASSIFIER_INSTRUCTIONS,
  classifyAndRewriteUserInput,
  fallbackSafeRewrite,
  type InputSafetyClassification,
  RED_INPUT_RESPONSE,
  type SafetyClassification,
};
