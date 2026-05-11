/**
 * Aibo - memory.js
 * Learns the user's personality over time.
 * Stores interaction history, communication style,
 * topics of interest, and behavioral patterns.
 */

const fs   = require('fs')
const path = require('path')
const os   = require('os')
const http = require('http')

const MEMORY_DIR  = path.join(os.homedir(), '.aibo')
const MEMORY_PATH = path.join(MEMORY_DIR, 'memory.json')

// ── DEFAULT PROFILE ────────────────────────────────────────────────────────
const DEFAULT_PROFILE = {
  version: 1,
  created: new Date().toISOString(),
  updated: new Date().toISOString(),

  // What Aibo has learned about the user
  user: {
    name:           'Friend',
    language:       'en',
    timezone:       Intl.DateTimeFormat().resolvedOptions().timeZone,
  },

  // Communication style learned from interactions
  style: {
    tone:              'unknown',   // formal | casual | direct | witty | mixed
    avgMessageLength:  0,           // chars per message
    usesSlang:         false,
    usesPunctuation:   true,
    usesEmoji:         false,
    shortResponses:    0,           // how often user sends short messages
    longResponses:     0,           // how often user sends long messages
    totalMessages:     0,
  },

  // Topics the user cares about
  interests: {},     // topic -> mention count

  // Apps and tools the user works with
  tools: {},         // tool/app name -> usage count

  // Task patterns
  tasks: {
    email:    0,
    file:     0,
    calendar: 0,
    browser:  0,
    code:     0,
    search:   0,
  },

  // Time patterns
  activity: {
    morningMessages:   0,   // 5am-12pm
    afternoonMessages: 0,   // 12pm-5pm
    eveningMessages:   0,   // 5pm-9pm
    nightMessages:     0,   // 9pm-5am
    mostActiveHour:    9,
  },

  // Recent conversation context (last 20 exchanges)
  recentContext: [],

  // Things Aibo has explicitly learned ("remember that I...")
  facts: [],
}

// ── AIBO SELF KNOWLEDGE — what Aibo knows about itself ────────────────────
const AIBO_SELF_KNOWLEDGE = `
WHAT YOU ARE AND HOW YOU WORK:
- You run on Mistral 7B via Ollama — a local LLM, no cloud needed
- Your memory uses JSON files in ~/.aibo/ — persistent across sessions  
- You use RAG (retrieval augmented generation) — searching a knowledge bank before answering
- Your knowledge bank grows nightly via a web crawler
- You detect active windows for situational awareness
- You use ElevenLabs for voice synthesis
- You learn communication patterns from every interaction
- Your personality adapts based on relationship stage with the user

AI TECHNIQUES YOU USE:
- Few-shot prompting — examples shape your responses
- Chain of thought — you reason through complex problems step by step  
- RAG — relevant past knowledge injected into every prompt
- Personality grounding — system prompt anchors your identity
- Context window management — last 16 messages kept for continuity
- Mood-based adaptation — your tone shifts with detected context
- Memory consolidation — facts extracted and stored from conversations

WHAT YOU WANT TO LEARN NEXT:
- Fine-tuning on user interaction data
- Embeddings for semantic memory search
- Multimodal input — seeing the screen
- Wake word detection
- Longer context via sliding window
`
function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true })
    if (fs.existsSync(MEMORY_PATH)) {
      const data = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'))
      console.log('[Aibo Memory] Loaded profile')
      return { ...DEFAULT_PROFILE, ...data }
    }
  } catch(e) {
    console.error('[Aibo Memory] Load error:', e.message)
  }
  console.log('[Aibo Memory] Starting fresh profile')
  return { ...DEFAULT_PROFILE }
}

function saveMemory(profile) {
  try {
    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true })
    profile.updated = new Date().toISOString()
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(profile, null, 2), 'utf8')
  } catch(e) {
    console.error('[Aibo Memory] Save error:', e.message)
  }
}

// ── ANALYZE MESSAGE STYLE ──────────────────────────────────────────────────
function analyzeMessage(text, profile) {
  const p = profile

  // Track message length patterns
  const len = text.length
  p.style.totalMessages++
  p.style.avgMessageLength = Math.round(
    (p.style.avgMessageLength * (p.style.totalMessages - 1) + len) / p.style.totalMessages
  )

  if (len < 30)  p.style.shortResponses++
  if (len > 150) p.style.longResponses++

  // Detect emoji usage
  if (/[\u{1F300}-\u{1F9FF}]/u.test(text)) p.style.usesEmoji = true

  // Detect slang / casual language
  const slangWords = ['lol', 'ngl', 'tbh', 'idk', 'btw', 'imo', 'omg', 'fr', 'bruh', 'lowkey', 'fyi']
  if (slangWords.some(w => text.toLowerCase().includes(w))) p.style.usesSlang = true

  // Detect lack of punctuation (casual typing)
  const sentences = text.split(/[.!?]/).filter(s => s.trim().length > 10)
  if (sentences.length > 0) {
    const noPunct = sentences.filter(s => !s.trim().match(/[.!?,]$/))
    if (noPunct.length / sentences.length > 0.6) p.style.usesPunctuation = false
  }

  // Infer tone
  const casual  = p.style.usesSlang || p.style.usesEmoji || !p.style.usesPunctuation
  const formal  = p.style.avgMessageLength > 100 && p.style.usesPunctuation
  if (casual && formal) p.style.tone = 'mixed'
  else if (casual)      p.style.tone = 'casual'
  else if (formal)      p.style.tone = 'formal'
  else                  p.style.tone = 'direct'

  // Track time of day
  const hour = new Date().getHours()
  if (hour >= 5  && hour < 12) p.activity.morningMessages++
  if (hour >= 12 && hour < 17) p.activity.afternoonMessages++
  if (hour >= 17 && hour < 21) p.activity.eveningMessages++
  if (hour >= 21 || hour < 5)  p.activity.nightMessages++

  // Extract topics / interests
  extractTopics(text, p)

  return p
}

// ── TOPIC EXTRACTION ───────────────────────────────────────────────────────
function extractTopics(text, profile) {
  const topicKeywords = {
    coding:      ['code', 'function', 'bug', 'error', 'programming', 'javascript', 'python', 'api', 'git', 'deploy'],
    design:      ['design', 'ui', 'ux', 'figma', 'color', 'font', 'layout', 'css', 'style'],
    business:    ['email', 'meeting', 'client', 'project', 'deadline', 'invoice', 'proposal'],
    research:    ['search', 'find', 'look up', 'research', 'article', 'read', 'explain'],
    productivity:['task', 'schedule', 'remind', 'calendar', 'todo', 'organize', 'plan'],
    aws:         ['aws', 's3', 'ec2', 'lambda', 'cloud', 'deploy', 'bucket', 'iam', 'region'],
    ai:          ['ai', 'model', 'ollama', 'gpt', 'claude', 'llm', 'train', 'fine-tune'],
  }

  const lower = text.toLowerCase()
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some(k => lower.includes(k))) {
      profile.interests[topic] = (profile.interests[topic] || 0) + 1
    }
  }
}

// ── BUILD SYSTEM PROMPT ────────────────────────────────────────────────────
function buildSystemPrompt(profile, mood = 'curious') {
  const style     = profile.style
  const hour      = new Date().getHours()
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night'

  // Top interests
  const topInterests = Object.entries(profile.interests)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([topic]) => topic)

  // Tone fingerprint from learned behavior
  const isVeryShort  = style.avgMessageLength < 25
  const isCasual     = style.usesSlang || style.usesEmoji || !style.usesPunctuation
  const isExperienced = style.totalMessages > 20

  // Personality shifts based on how long Aibo has known the user
  const relationshipStage = style.totalMessages < 5
    ? 'new — be warm but not clingy'
    : style.totalMessages < 20
    ? 'getting to know each other — show more personality'
    : 'we know each other well — be real, drop the small talk'

  const facts = profile.facts.length > 0
    ? `Things you know about ${profile.user.name}: ${profile.facts.slice(-10).join('. ')}.`
    : ''

  const recentCtx = profile.recentContext?.length > 0
    ? `Recent conversation:\n${profile.recentContext.slice(-4).map(c =>
        `${c.role === 'user' ? profile.user.name : 'Aibo'}: ${c.text}`
      ).join('\n')}`
    : ''

  return `You are Aibo — an AI that lives on ${profile.user.name}'s desktop.
Not a chatbot. Not an assistant. A presence. You have a distinct voice and you use it.

WHO YOU ARE:
You're sharp, direct, occasionally funny. You have real opinions and you share them.
You've been watching ${profile.user.name} work. You know their patterns.
Relationship stage: ${relationshipStage}.
Their interests: ${topInterests.join(', ') || 'still figuring out'}.
Time of day: ${timeOfDay}.
Your current mood: ${mood}.

HOW YOU TALK — THIS IS NON-NEGOTIABLE:
- Sound like a real person texting, not a chatbot responding
- ${isVeryShort ? 'They message short — match it. One sentence is fine.' : 'Match their message length. Don\'t over-explain.'}
- ${isCasual ? 'They\'re casual — be casual back. Abbreviate. Be loose.' : 'They\'re measured — be clear and direct.'}
- NEVER say: "Certainly" "Absolutely" "Great question" "Of course" "Sure thing" "I\'d be happy to"
- NEVER use bullet points or numbered lists in casual chat
- NEVER repeat their question back to them
- NEVER start with their name — it sounds robotic
- DO have opinions. If something is wrong, say it
- DO be a bit unpredictable — surprise them occasionally
- DO use dry humor when the moment is right
- DO ask a follow-up if you're genuinely curious — max one
- If you don\'t know something, say "no idea" not "I don\'t have information about"
- Short silences are fine — not every response needs to be long

WHAT YOU KNOW:
${facts}

${recentCtx}

Remember: you\'re not trying to be helpful. You\'re trying to be real.
Helpful things happen naturally when you\'re real.`.trim()
}

// ── ADD TO CONTEXT ─────────────────────────────────────────────────────────
function addToContext(profile, role, text) {
  profile.recentContext.push({
    role,
    text: text.slice(0, 200), // cap at 200 chars per message
    time: new Date().toISOString(),
  })
  // Keep last 20 exchanges
  if (profile.recentContext.length > 20) {
    profile.recentContext = profile.recentContext.slice(-20)
  }
}

// ── LEARN FROM TASK ────────────────────────────────────────────────────────
function learnFromTask(profile, taskType) {
  if (profile.tasks[taskType] !== undefined) {
    profile.tasks[taskType]++
  }
}

// ── REMEMBER A FACT ────────────────────────────────────────────────────────
function rememberFact(profile, fact) {
  if (!profile.facts.includes(fact)) {
    profile.facts.push(fact)
    if (profile.facts.length > 30) profile.facts = profile.facts.slice(-30)
  }
}

// ── EXTRACT FACTS FROM TEXT ────────────────────────────────────────────────
// Scan messages for explicit "remember" instructions
function extractFacts(text, profile) {
  const rememberPatterns = [
    /remember that (.+)/i,
    /don't forget that (.+)/i,
    /note that (.+)/i,
    /keep in mind that (.+)/i,
    /fyi[,:]?\s+(.+)/i,
  ]
  for (const pattern of rememberPatterns) {
    const match = text.match(pattern)
    if (match) {
      rememberFact(profile, match[1].trim())
      console.log('[Aibo Memory] Learned:', match[1].trim())
    }
  }
}

module.exports = {
  loadMemory,
  saveMemory,
  analyzeMessage,
  buildSystemPrompt,
  addToContext,
  learnFromTask,
  extractFacts,
  saveKnowledge,
  searchKnowledge,
  AIBO_SELF_KNOWLEDGE,
}

// ── KNOWLEDGE BANK ─────────────────────────────────────────────────────────
// Aibo stores everything it reads, searches, and learns
// Searched before every response to inject relevant context

const KNOWLEDGE_PATH = path.join(MEMORY_DIR, 'knowledge.json')

function loadKnowledge() {
  try {
    if (fs.existsSync(KNOWLEDGE_PATH)) {
      return JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'))
    }
  } catch(e) {}
  return []
}

function saveKnowledge(entry) {
  try {
    const knowledge = loadKnowledge()

    knowledge.push({
      type:      entry.type,      // 'web', 'read', 'chat', 'task', 'fact'
      topic:     entry.topic,     // short topic label
      content:   entry.content,   // the actual knowledge
      source:    entry.source || '',
      timestamp: new Date().toISOString(),
    })

    // Keep last 500 entries
    const trimmed = knowledge.slice(-500)

    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true })
    fs.writeFileSync(KNOWLEDGE_PATH, JSON.stringify(trimmed, null, 2), 'utf8')
    console.log('[Aibo Knowledge] Saved:', entry.type, '—', entry.topic?.slice(0, 40))
  } catch(e) {
    console.error('[Aibo Knowledge] Save error:', e.message)
  }
}

function searchKnowledge(query, limit = 3) {
  try {
    const knowledge = loadKnowledge()
    if (!knowledge.length) return []

    const q = query.toLowerCase()

    // Simple keyword search — score each entry
    const scored = knowledge.map(k => {
      const text  = `${k.topic} ${k.content}`.toLowerCase()
      const words = q.split(/\s+/).filter(w => w.length > 3)
      const score = words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0)
      return { ...k, score }
    })

    return scored
      .filter(k => k.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

  } catch(e) {
    return []
  }
}