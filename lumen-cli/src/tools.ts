import type OpenAI from "openai";

const tools: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "search_nhs_condition",
    description:
      "Search NHS conditions in the local Chroma collection. " +
      "Returns relevant health condition information based on semantic similarity.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query text, e.g. 'diabetes symptoms', 'asthma treatment'",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "search_healf",
    description:
      "Search Healf products in the local Chroma collection. " +
      "Returns relevant product information based on semantic similarity.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query text, e.g. 'vitamin D', 'sleep support'",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_customer_info",
    description:
      "Retrieve the customer's personal health profile data. " +
      "Returns blood test results or wearable device metrics in TOON format.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["blood-tests", "wearable-data"],
          description:
            "Which profile to retrieve: 'blood-tests' for recent blood " +
            "test markers, 'wearable-data' for wearable device metrics",
        },
      },
      required: ["type"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export { tools };
