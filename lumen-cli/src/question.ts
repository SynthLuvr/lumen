import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isCancel, outro, text } from "@clack/prompts";
import { OpenAI } from "openai";
import {
  classifyAndRewriteUserInput,
  RED_INPUT_RESPONSE,
} from "./input-classifier.js";
import { runCustomerInfo, runTool, type ToolCall } from "./tool.js";
import { tools } from "./tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(
  join(__dirname, "prompts", "system-prompt.md"),
  "utf-8",
);

type ResponseInput = OpenAI.Responses.ResponseInput;
type ResponseInputItem = OpenAI.Responses.ResponseInputItem;
type ResponseOutputItem = OpenAI.Responses.ResponseOutputItem;

type CarryForwardItem = Extract<
  ResponseOutputItem,
  { type: "message" | "function_call" | "reasoning" }
>;

type ToolCallItem = Extract<ResponseOutputItem, { type: "function_call" }> &
  ToolCall;

const MODEL = "gpt-5.4-nano" as const;

const SystemMessage = (message: string) =>
  ({
    role: "system" as const,
    content: message,
  }) satisfies ResponseInput[number];

const UserMessage = (message: string) =>
  ({ role: "user" as const, content: message }) satisfies ResponseInput[number];

const isCarryForwardItem = (
  item: ResponseOutputItem,
): item is CarryForwardItem =>
  item.type === "message" ||
  item.type === "function_call" ||
  item.type === "reasoning";

const isToolCallItem = (item: ResponseOutputItem): item is ToolCallItem =>
  item.type === "function_call" &&
  (item.name === "search_nhs_condition" ||
    item.name === "search_healf" ||
    item.name === "get_customer_info");

const handleStreamEvent = (
  event: OpenAI.Responses.ResponseStreamEvent,
  state: { outputText: string; output: ResponseOutputItem[] },
): void => {
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.delta);
    state.outputText += event.delta;
  } else if (event.type === "response.completed")
    state.output = event.response.output;
};

const streamResponse = async (
  openai: OpenAI,
  input: ResponseInput,
): Promise<{
  outputText: string;
  output: ResponseOutputItem[];
  cancelled: boolean;
}> => {
  const controller = new AbortController();
  let cancelled = false;

  const onSigint = () => {
    cancelled = true;
    controller.abort();
    process.stdout.write("\n");
  };

  process.once("SIGINT", onSigint);

  const state = { outputText: "", output: [] as ResponseOutputItem[] };

  try {
    const stream = await openai.responses.create(
      { model: MODEL, input, tools, stream: true },
      { signal: controller.signal },
    );
    for await (const event of stream) handleStreamEvent(event, state);
  } finally {
    process.off("SIGINT", onSigint);
  }

  return { ...state, cancelled };
};

const buildToolOutputs = (
  toolCalls: ToolCallItem[],
): Promise<ResponseInputItem[]> =>
  Promise.all(
    toolCalls.map(async (item) => ({
      type: "function_call_output" as const,
      call_id: item.call_id,
      output: await runTool(item),
    })),
  );

const processInput = async (
  openai: OpenAI,
  input: ResponseInput,
): Promise<void> => {
  const firstResponse = await streamResponse(openai, input);
  if (firstResponse.cancelled) return;

  const inputs = firstResponse.output.filter(isCarryForwardItem);
  const toolCalls = firstResponse.output.filter(isToolCallItem);

  if (!toolCalls.length) {
    process.stdout.write("\n");
    return;
  }

  const toolOutputs = await buildToolOutputs(toolCalls);
  await streamResponse(openai, [...input, ...inputs, ...toolOutputs]);
  process.stdout.write("\n");
};

const buildInput = async (userPrompt: string): Promise<ResponseInput> => {
  const profile = await runCustomerInfo("profile");
  return [
    SystemMessage(systemPrompt),
    SystemMessage(`Customer profile:\n\n${profile}`),
    UserMessage(userPrompt),
  ];
};

const handleUserInput = async (
  openai: OpenAI,
  rawPrompt: string,
): Promise<boolean> => {
  const { classification, rewrittenPrompt } = await classifyAndRewriteUserInput(
    openai,
    rawPrompt,
  );

  if (classification === "RED" || !rewrittenPrompt) {
    console.log(RED_INPUT_RESPONSE);
    return false;
  }

  // The raw prompt is never passed to the model — only the safe rewrite.
  await processInput(openai, await buildInput(rewrittenPrompt));
  return true;
};

const promptForQuestion = async (): Promise<string | null> => {
  const answer = await text({ message: "Ask Lumen:" });
  if (isCancel(answer)) return null;
  return answer.trim() || null;
};

const questionMain = async (question?: string): Promise<void> => {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    outro("❌ OPENAI_API_KEY environment variable is required.");
    process.exitCode = 1;
    return;
  }

  const openai = new OpenAI({ apiKey });

  const rawPrompt = question?.trim() || (await promptForQuestion());

  if (!rawPrompt) {
    outro("Goodbye!");
    return;
  }

  await handleUserInput(openai, rawPrompt);
};

export { handleUserInput, processInput, questionMain };
