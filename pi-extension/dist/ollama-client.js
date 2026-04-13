// pi-extension/src/ollama-client.ts
export class OllamaClient {
    baseUrl;
    constructor(baseUrl = "http://localhost:11434") {
        this.baseUrl = baseUrl;
    }
    async embed(text, model = "embedding-gemma:latest") {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, prompt: text }),
        });
        if (!response.ok) {
            throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return data.embedding;
    }
    async isAvailable() {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            return response.ok;
        }
        catch {
            return false;
        }
    }
}
