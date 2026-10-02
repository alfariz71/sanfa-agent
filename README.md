# Sanfa Agent Web

An autonomous AI agent client and server featuring streaming chat, live tool calling, sub-agent delegation, and desktop bridge automation.

---

## 🚀 Key Features

- **⚡ Real-Time Streaming:** High-performance Server-Sent Events (SSE) chat responses with Markdown and KaTeX math rendering.
- **🛠️ Integrated Tool Suite:**
  - Web search & deep page reader (with OpenGraph & metadata scraping)
  - Code execution & shell integration
  - Desktop control bridge (screenshots, mouse, and keyboard automation via PowerShell)
  - Sub-agent task delegation
- **🎨 Ember Forge Theme:** Aesthetic dark mode interface with responsive layout for desktop and mobile.
- **📁 Multi-Project Workspaces:** Organize conversations into dedicated project folders.
- **👥 Custom Personas:** Switch seamlessly between specialized system personalities.

---

## 📦 Getting Started

### Prerequisites
- Node.js 18.x or newer

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/your-username/sanfa-agent.git
   cd sanfa-agent
   ```

2. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

3. Start the server:
   ```bash
   node server.mjs
   ```

4. Open your browser at `http://localhost:3333`. Default credentials:
   - **Username:** `admin`
   - **Password:** `admin123`

---

## 🛡️ License
MIT License. Built with passion for autonomous agentic workflows.
