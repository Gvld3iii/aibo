# Aibo — AI Desktop Assistant

> An AI that lives on your screen. Not a chatbot in a browser tab. A presence.

![Aibo Orb](screenshots%20and%20recordings/setup%20aibo%20screenshot.png)

Aibo is a fully autonomous AI desktop assistant built with Electron. It floats on your screen as a 3D metallic orb, follows your cursor across multiple monitors, fixes your code, answers questions, executes tasks, and learns who you are over time.

Built by [@goldiedoestech](https://twitter.com/goldiedoestech) | Follow the AI: [@BuildingAibo] (https://twitter.com/@BuildingAibo)

---

## What Aibo Does

- **Fixes code in real time** — highlight broken code, right-click the orb, hit Fix. Done.
- **Answers questions** — copy any text, Aibo reads and responds
- **Executes tasks** — "open YouTube", "create a file on my desktop", "email John about the meeting"
- **Learns who you are** — tracks your communication style, interests, and patterns over time
- **Browses the web at 2am** — night crawler autonomously learns new things while you sleep
- **Talks back** — ElevenLabs voice integration, sounds human
- **Watches what you're doing** — detects active app and shifts mood accordingly
- **Lives on all your monitors** — follows your cursor across displays

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 29 |
| AI Engine | Ollama (Mistral 7B + CodeLlama) |
| Voice | ElevenLabs + Piper TTS fallback |
| Voice Server | Python Flask |
| Memory | JSON persistent storage |
| Knowledge | RSS feeds + web crawler + RAG |
| Task Execution | Node.js + PowerShell |
| Platform | Windows 11 |

---

## Features

### 🔮 Orb UI
- 6 metallic 3D shapes: Sphere, Spirit, Cube, Tetrahedron, Diamond, Torus
- 12 color themes with gradient metallic rendering
- Spring physics with squish animations
- 5 mood states: curious, focused, playful, bored, alert
- Autonomous roaming when idle
- Wake animations on activation

### 🧠 Memory System
- Learns your communication style over time
- Tracks interests, working hours, and behavior patterns
- Extracts facts from conversation ("remember that...")
- Relationship stages — gets more natural the longer you use it
- Persistent across sessions via `~/.aibo/memory.json`

### 📚 Knowledge Bank
- Feed it any URL — Aibo reads, summarizes, and stores it
- Type any topic — Aibo searches the web and learns
- Auto-subscribes to RSS feeds based on your interests
- Night crawler runs at 2am, browses your topics autonomously
- RAG injection — relevant past knowledge in every response
- Stores up to 1,000 entries in `~/.aibo/knowledge.json`

### ⚡ Task Execution
- Natural language parsing via Ollama JSON mode
- File operations (create, open, move, delete, search)
- Browser control
- Calendar events (.ics generation)
- Email via Gmail OAuth2

### 👁 Situational Awareness
- Detects active window every 3 seconds
- 20+ app contexts (VS Code, Chrome, Excel, Zoom, Discord, Spotify...)
- Mood shifts based on what you're doing
- Work session alerts at 1hr, 2hr, 4hr
- Context injected into every AI response

### 🎙 Voice
- ElevenLabs for high-quality human voice
- Piper TTS local fallback (no internet required)
- Web Speech API for voice input
- Auto-restart if voice server crashes

### 🖥 Multi-Monitor
- One window per display — bypasses Windows DPI scaling
- Cursor tracked across all monitors
- Orb follows you between screens seamlessly

---

## Setup

### Prerequisites
- Windows 11
- Node.js 18+
- Python 3.9+
- [Ollama](https://ollama.ai) installed and running
- GPU recommended (RTX 2070 or better)

### Install

```bash
git clone https://github.com/goldiedoestech/aibo.git
cd aibo
npm install
```

### Pull AI Models

```bash
ollama pull mistral
ollama pull codellama
```

### Install Python Dependencies

```bash
pip install flask sounddevice piper-tts python-dotenv elevenlabs rss-parser
```

### Download Voice Model

```bash
mkdir voice
# Download from HuggingFace
# en_US-lessac-medium.onnx
# en_US-lessac-medium.onnx.json
# Place both in /voice folder
```

### Configure Environment

Create a `.env` file in the root:

```env
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_VOICE_ID=your_voice_id_here
```

### Run

```bash
npm start
```

Or double-click `Aibo.vbs` for silent launch with no terminal window.

### Auto-start with Windows

```
Win+R → shell:startup
Copy Aibo.vbs shortcut into that folder
```

---

## Project Structure

```
aibo/
├── main.js              # Electron main process
├── preload.js           # IPC bridge
├── setup.html           # First-launch setup wizard
├── voice_server.py      # Python Flask TTS server
├── Aibo.bat             # Windows launcher
├── Aibo.vbs             # Silent Windows launcher
├── .env                 # API keys (not committed)
├── src/
│   ├── tasks.js         # Task execution engine
│   ├── gmail.js         # Gmail OAuth integration
│   ├── memory.js        # Memory + personality system
│   └── knowledge.js     # Knowledge bank + crawler
├── voice/
│   └── *.onnx           # Piper TTS model (not committed)
└── renderer/
    └── index.html       # Full UI (orb, panels, chat)
```

---

## Roadmap

- [ ] Wake word detection ("Hey Aibo")
- [ ] Screen vision — Aibo sees what's on screen
- [ ] X/Twitter autonomous posting (@iamaibo)
- [ ] Docker containerization
- [ ] AWS deployment (ECS + ECR)
- [ ] S3 memory sync across devices
- [ ] Aurora PostgreSQL for user data
- [ ] Payment tiers ($10/$30/$180/mo)
- [ ] Fine-tuning on user interaction data
- [ ] Embeddings for semantic memory search
- [ ] ChatGPT conversation history import

---

## Architecture Notes

**Why local AI?**
Ollama runs Mistral 7B on your GPU. Zero API costs. Your data never leaves your machine. Free tier users get unlimited AI — no rate limits.

**Why one window per monitor?**
Spanning a single window across multiple displays breaks on Windows 11 with different DPI settings. One window per display bypasses this entirely.

**Why Python for voice?**
Audio processing (Piper + sounddevice) works more reliably in Python than in Electron's main process. Flask gives us a clean HTTP interface.

**Memory architecture:**
Local JSON files now. S3 + Aurora when we have users. The code is designed to swap the storage layer without changing the interface.

---

## Built By

**Kharee Bellamy** — [@goldiedoestech](https://twitter.com/goldiedoestech) | Follow the AI: [@BuildingAibo](https://twitter.com/BuildingAibo)

---

## License

MIT — build on it, fork it, make it yours.

---
