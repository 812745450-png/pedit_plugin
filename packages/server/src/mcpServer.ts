import { stdin, stdout } from "node:process";
import { recordRuntimeMcpToolCall } from "./runtime/bridgeRuntimeStore.js";
import { compactToolOutput } from "./tools/compactOutput.js";
import {
  invokePeditTool,
  PEDIT_CREATE_PENDING_TASK_TOOL_NAME,
  PEDIT_CLAIM_NEXT_TASK_TOOL_NAME,
  PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME,
  PEDIT_GET_CANVAS_STATE_TOOL_NAME,
  PEDIT_OPEN_CANVAS_TOOL_NAME,
  PEDIT_RUN_LOCAL_FAST_PATH_TOOL_NAME,
  PEDIT_STATUS_TOOL_NAME,
  PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME,
  type PeditToolName
} from "./tools/registry.js";

export interface McpRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export interface McpResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

interface ParsedFrames {
  messages: McpRequest[];
  remaining: Buffer<ArrayBufferLike>;
}

const toolDescriptions: Record<PeditToolName, string> = {
  [PEDIT_STATUS_TOOL_NAME]: "Return Pedit plugin, canvas URL, and tool availability status.",
  [PEDIT_OPEN_CANVAS_TOOL_NAME]: "Start the local Pedit Canvas web app and return its URL.",
  [PEDIT_GET_CANVAS_STATE_TOOL_NAME]: "Read a Pedit canvas project state snapshot.",
  [PEDIT_CREATE_PENDING_TASK_TOOL_NAME]: "Create a pending Pedit generation task in a project snapshot.",
  [PEDIT_CLAIM_NEXT_TASK_TOOL_NAME]: "Claim the next pending Pedit task and mark it running while Codex processes the image.",
  [PEDIT_RUN_LOCAL_FAST_PATH_TOOL_NAME]: "Run Pedit's deterministic high-fidelity local fast path for supported claimed strict-local color edits before falling back to image2.",
  [PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME]: "Write a generated image result back into a project snapshot.",
  [PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME]: "Return the current image export target from a project snapshot."
};

const peditToolNames: PeditToolName[] = [
  PEDIT_STATUS_TOOL_NAME,
  PEDIT_OPEN_CANVAS_TOOL_NAME,
  PEDIT_GET_CANVAS_STATE_TOOL_NAME,
  PEDIT_CREATE_PENDING_TASK_TOOL_NAME,
  PEDIT_CLAIM_NEXT_TASK_TOOL_NAME,
  PEDIT_RUN_LOCAL_FAST_PATH_TOOL_NAME,
  PEDIT_WRITE_GENERATION_RESULT_TOOL_NAME,
  PEDIT_EXPORT_CURRENT_IMAGE_TOOL_NAME
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const createMcpResponse = (
  id: string | number | null,
  result: unknown
): McpResponse => ({
  jsonrpc: "2.0",
  id,
  result
});

const createMcpError = (
  id: string | number | null,
  code: number,
  message: string
): McpResponse => ({
  jsonrpc: "2.0",
  id,
  error: {
    code,
    message
  }
});

export const encodeMcpMessage = (message: McpResponse) => {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
};

export const parseMcpFrames = (buffer: Buffer<ArrayBufferLike>): ParsedFrames => {
  const messages: McpRequest[] = [];
  let remaining = buffer;

  while (remaining.length > 0) {
    const separator = remaining.indexOf("\r\n\r\n");

    if (separator === -1) {
      break;
    }

    const header = remaining.subarray(0, separator).toString("utf8");
    const contentLengthLine = header
      .split("\r\n")
      .find((line) => line.toLowerCase().startsWith("content-length:"));
    const contentLength = Number(contentLengthLine?.split(":")[1]?.trim());

    if (!Number.isInteger(contentLength) || contentLength < 0) {
      throw new Error("Invalid MCP Content-Length header.");
    }

    const bodyStart = separator + 4;
    const bodyEnd = bodyStart + contentLength;

    if (remaining.length < bodyEnd) {
      break;
    }

    messages.push(
      JSON.parse(remaining.subarray(bodyStart, bodyEnd).toString("utf8")) as McpRequest
    );
    remaining = remaining.subarray(bodyEnd);
  }

  return {
    messages,
    remaining
  };
};

export const handleMcpRequest = (request: McpRequest): McpResponse | null => {
  const id = request.id ?? null;

  if (request.method === "notifications/initialized") {
    return null;
  }

  if (request.method === "initialize") {
    return createMcpResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "pedit",
        version: "0.1.0"
      }
    });
  }

  if (request.method === "tools/list") {
    return createMcpResponse(id, {
      tools: peditToolNames.map((name) => ({
        name,
        description: toolDescriptions[name],
        inputSchema: {
          type: "object",
          additionalProperties: true
        }
      }))
    });
  }

  if (request.method === "tools/call") {
    if (!isRecord(request.params) || typeof request.params.name !== "string") {
      return createMcpError(id, -32602, "tools/call requires a tool name.");
    }

    const toolName = request.params.name as PeditToolName;

    if (!peditToolNames.includes(toolName)) {
      return createMcpError(id, -32602, `Unknown Pedit tool ${request.params.name}.`);
    }

    try {
      recordRuntimeMcpToolCall(toolName);
      const result = compactToolOutput(
        invokePeditTool(toolName, request.params.arguments ?? {})
      );

      return createMcpResponse(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      });
    } catch (error) {
      return createMcpResponse(id, {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error)
          }
        ]
      });
    }
  }

  return createMcpError(id, -32601, `Unsupported MCP method ${request.method ?? "<missing>"}.`);
};

export const runMcpServer = () => {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  stdin.on("data", (chunk: Buffer<ArrayBufferLike>) => {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = parseMcpFrames(buffer);
      buffer = parsed.remaining;

      for (const message of parsed.messages) {
        const response = handleMcpRequest(message);

        if (response) {
          stdout.write(encodeMcpMessage(response));
        }
      }
    } catch (error) {
      const response = createMcpError(
        null,
        -32700,
        error instanceof Error ? error.message : String(error)
      );
      stdout.write(encodeMcpMessage(response));
      buffer = Buffer.alloc(0);
    }
  });
};
