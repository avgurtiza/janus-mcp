// pi-extension/src/protocol.ts
export function parseCommand(line) {
    try {
        return JSON.parse(line);
    }
    catch {
        return null;
    }
}
export function createResponse(response) {
    return JSON.stringify(response) + "\n";
}
