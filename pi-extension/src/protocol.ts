// pi-extension/src/protocol.ts

// Commands from MCP Server to Pi
export type PiCommand =
  | { action: "index"; files: { path: string; content: string }[] }
  | { action: "search"; query: string; topK: number }
  | { action: "stats" }
  | { action: "clear" };

// Responses from Pi to MCP Server
export type PiResponse =
  | { status: "ready" }
  | { action: "indexed"; fileCount: number }
  | { action: "search"; results: { path: string; score: number }[] }
  | { action: "stats"; fileCount: number; indexedAt: string | null }
  | { action: "error"; message: string };

export function parseCommand(line: string): PiCommand | null {
  try {
    return JSON.parse(line) as PiCommand;
  } catch {
    return null;
  }
}

export function createResponse(response: PiResponse): string {
  return JSON.stringify(response) + "\n";
}