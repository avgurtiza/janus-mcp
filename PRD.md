This PRD outlines the development of a **Semantic Context Gatekeeper**, a specialized MCP server designed to reduce token costs and improve coding accuracy by using local embeddings to prune the context sent to cloud-based LLMs.

---

## **Product Requirements Document: Semantic Context Gatekeeper (MCP)**

### **1. Executive Summary**
When using cloud LLMs (Claude 3.5, GPT-4o) for large Laravel projects, costs and latency rise as the model "reads" irrelevant files to gain context. The **Semantic Context Gatekeeper** uses a local, lightweight model (**EmbeddingGemma via Ollama**) to identify the most relevant files semantically before any data is sent to the cloud, ensuring only "high-signal" code is billed and processed.

---

### **2. Problem Statement**
* **Token Waste:** Standard "keyword" searches often return too many irrelevant files, bloating the context window and increasing cloud API costs.
* **Brittleness:** Grep-based search misses related files that don't share exact strings (e.g., searching for "login" might miss `Authenticate.php` middleware).
* **Laravel Complexity:** The deep directory structure of Laravel/NativePHP makes manual context selection tedious for the user.

---

### **3. Goals & Objectives**
* **Reduce Cloud Token Consumption:** Aim for a 50–70% reduction in "Context Tokens" by filtering files locally.
* **Improve Retrieval Accuracy:** Use semantic meaning rather than just keywords.
* **Zero-Latency Feel:** Leverage **EmbeddingGemma’s Matryoshka** properties to keep local search under 200ms.
* **Privacy First:** Keep the indexing and initial search entirely on the local machine.

---

### **4. User Stories**
* **As a Developer,** I want the AI to automatically find my `Migrations` and `Policies` when I ask to change a `Model`, without me having to manually attach them.
* **As a Lead Engineer,** I want to use expensive models like Claude 3.5 Opus without my monthly bill skyrocketing due to redundant "file reading" tasks.
* **As a Laravel User,** I want the search to understand the relationship between a Route, a Controller, and a View based on conceptual intent.

---

### **5. Functional Requirements**

#### **FR-1: Local Vector Indexing**
* The MCP must scan the local Laravel project and generate embeddings for every file using `embedding-gemma:latest` via Ollama.
* It must support incremental updates (only re-indexing changed files) to save CPU.

#### **FR-2: Semantic "Skill" for OpenCode/Pi**
* The tool must expose a `semantic_search` tool to the Model Context Protocol.
* **Inputs:** A natural language query (e.g., "Where is the payment logic?").
* **Outputs:** A ranked list of file paths and a "relevance score."

#### **FR-3: Smart Pruning (The Gatekeeper)**
* The MCP should allow a "Top-K" configuration (e.g., only return the top 5 most relevant files).
* It must provide a "Summary Mode" where it returns only the method signatures of the relevant files instead of the full code, further saving tokens.

#### **FR-4: Matryoshka Optimization**
* The system should utilize truncated embeddings (256-dimension) to speed up comparison calculations without significant loss in accuracy.

---

### **6. Technical Architecture**

| Component | Technology | Role |
| :--- | :--- | :--- |
| **Orchestrator** | **Pi (Harness) / Node.js** | Handles the MCP communication and logic flow. |
| **Embedding Engine** | **Ollama (EmbeddingGemma)** | Converts text to vectors locally. |
| **Vector Store** | **ChromaDB or SQLite-vss** | Stores the vectors for fast local querying. |
| **Interface** | **OpenCode Zen / MCP Client** | The UI where the user interacts with the cloud LLM. |

#### **The Workflow Loop:**
1.  **Trigger:** User asks a question in OpenCode.
2.  **Intercept:** The MCP `semantic_search` tool is called.
3.  **Local Fetch:** EmbeddingGemma generates a vector for the query; the Vector Store finds matches.
4.  **Inject:** The MCP feeds the content of the *matched* files back into the prompt.
5.  **Cloud Execution:** The cloud LLM receives a lean, highly relevant prompt.

---

### **7. Success Metrics**
* **Cost Efficiency:** Average tokens per request should drop significantly compared to standard "Read All" behavior.
* **Accuracy:** User "Thumb-Up" rate on file retrieval relevance.
* **Performance:** The local embedding/search phase must complete in **< 300ms**.

---

### **8. Future Considerations**
* **Project Summaries:** Creating a "Map" of the project where Gemma summarizes what each folder does.
* **Multi-Model Support:** Allowing users to swap EmbeddingGemma for other local models like `nomic-embed-text`.
* **Git Integration:** Automatically indexing based on the current active branch or recent commits.
