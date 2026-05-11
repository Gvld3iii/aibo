/**
 * Aibo - knowledge.js
 * Autonomous knowledge acquisition system
 * Sources: manual URLs, RSS feeds, night crawler, self-directed learning
 */

const fs      = require('fs')
const path    = require('path')
const os      = require('os')
const http    = require('http')
const https   = require('https')
const { ipcMain } = require('electron')

const KNOWLEDGE_DIR  = path.join(os.homedir(), '.aibo')
const KNOWLEDGE_PATH = path.join(KNOWLEDGE_DIR, 'knowledge.json')
const RSS_PATH       = path.join(KNOWLEDGE_DIR, 'rss_feeds.json')
const CRAWLER_PATH   = path.join(KNOWLEDGE_DIR, 'crawler_log.json')

// ── AIBO CORE FEEDS — always subscribed, makes Aibo smarter ───────────────
// These are NOT user interests — these help Aibo stay aware and grow
const AIBO_CORE_FEEDS = [
  // AI news — Aibo stays current on AI developments
  { url: 'https://huggingface.co/blog/feed.xml',           topic: 'AI Models',        category: 'ai' },
  { url: 'https://techcrunch.com/category/artificial-intelligence/feed/', topic: 'AI News', category: 'ai' },

  // Current events — Aibo knows what's happening in the world
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', topic: 'Tech News',      category: 'news' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', topic: 'NYT Tech', category: 'news' },

  // Dev news — Aibo understands coding trends
  { url: 'https://stackoverflow.blog/feed/',               topic: 'Dev Trends',       category: 'dev' },
  { url: 'https://dev.to/feed',                            topic: 'Developer News',   category: 'dev' },

  // Science — Aibo stays curious
  { url: 'https://www.sciencedaily.com/rss/computers_math/artificial_intelligence.xml', topic: 'AI Research', category: 'science' },
]

// ── USER INTEREST FEEDS — added based on what user cares about ────────────
const USER_INTEREST_FEEDS = {
  aws:          ['https://aws.amazon.com/blogs/aws/feed/', 'https://aws.amazon.com/blogs/architecture/feed/'],
  coding:       ['https://dev.to/feed', 'https://stackoverflow.blog/feed/'],
  ai:           ['https://huggingface.co/blog/feed.xml'],
  tech:         ['https://techcrunch.com/feed/', 'https://www.theverge.com/rss/index.xml'],
  productivity: ['https://lifehacker.com/rss'],
  business:     ['https://hbr.org/feed/'],
  crypto:       ['https://coindesk.com/arc/outboundfeeds/rss/'],
  science:      ['https://www.sciencedaily.com/rss/top/science.xml'],
  gaming:       ['https://www.polygon.com/rss/index.xml'],
  design:       ['https://www.smashingmagazine.com/feed/'],
  startups:     ['https://techcrunch.com/startups/feed/'],
  music:        ['https://pitchfork.com/feed/feed-news/rss'],
  // Custom topics added by user via text input
}

// ── BROAD TOPIC SEARCH QUERIES — night crawler uses these ─────────────────
const AIBO_GROWTH_TOPICS = [
  'latest AI breakthroughs 2026',
  'new programming languages trending',
  'current tech news today',
  'AI assistant developments',
  'open source AI models released',
  'developer tools 2026',
  'machine learning research papers',
  'software engineering best practices',
]

// ── FILE UTILS ─────────────────────────────────────────────────────────────
function ensureDir() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true })
}

function loadKnowledge() {
  try {
    if (fs.existsSync(KNOWLEDGE_PATH)) {
      return JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'))
    }
  } catch(e) {}
  return []
}

function saveKnowledgeEntry(entry) {
  ensureDir()
  const knowledge = loadKnowledge()

  // Avoid duplicates by URL
  if (entry.url && knowledge.some(k => k.url === entry.url)) {
    console.log('[Aibo Knowledge] Already know about:', entry.url)
    return false
  }

  knowledge.push({
    id:        Date.now(),
    type:      entry.type,
    topic:     entry.topic,
    content:   entry.content?.slice(0, 2000), // cap at 2000 chars
    url:       entry.url || '',
    source:    entry.source || '',
    timestamp: new Date().toISOString(),
  })

  // Keep last 1000 entries
  const trimmed = knowledge.slice(-1000)
  fs.writeFileSync(KNOWLEDGE_PATH, JSON.stringify(trimmed, null, 2), 'utf8')
  console.log('[Aibo Knowledge] Saved:', entry.type, '—', entry.topic?.slice(0, 50))
  return true
}

function searchKnowledge(query, limit = 5) {
  try {
    const knowledge = loadKnowledge()
    if (!knowledge.length) return []

    const q     = query.toLowerCase()
    const words = q.split(/\s+/).filter(w => w.length > 3)

    const scored = knowledge.map(k => {
      const text  = `${k.topic} ${k.content} ${k.source}`.toLowerCase()
      const score = words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0)
      return { ...k, score }
    })

    return scored
      .filter(k => k.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit)
  } catch(e) { return [] }
}

function getKnowledgeStats() {
  const knowledge = loadKnowledge()
  const byType    = {}
  knowledge.forEach(k => { byType[k.type] = (byType[k.type] || 0) + 1 })
  return { total: knowledge.length, byType, newest: knowledge.slice(-3).reverse() }
}

// ── WEB FETCHER ────────────────────────────────────────────────────────────
function fetchUrl(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Aibo/1.0 (AI Desktop Assistant)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout,
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location, timeout).then(resolve).catch(reject)
      }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { if (data.length < 100000) data += chunk })
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

// ── HTML CONTENT EXTRACTOR ─────────────────────────────────────────────────
function extractContent(html, url) {
  try {
    const cheerio = require('cheerio')
    const $       = cheerio.load(html)

    // Remove noise
    $('script, style, nav, header, footer, aside, .ad, .advertisement, .sidebar').remove()

    // Get title
    const title = $('h1').first().text().trim()
      || $('title').text().trim()
      || url

    // Get main content
    const contentSelectors = ['article', 'main', '.content', '.post-content', '.entry-content', 'body']
    let content = ''
    for (const sel of contentSelectors) {
      content = $(sel).first().text().trim()
      if (content.length > 200) break
    }

    // Clean up whitespace
    content = content.replace(/\s+/g, ' ').trim().slice(0, 2000)

    return { title, content }
  } catch(e) {
    return { title: url, content: '' }
  }
}

// ── SUMMARIZE WITH OLLAMA ──────────────────────────────────────────────────
async function summarizeWithOllama(text, topic) {
  return new Promise((resolve) => {
    const prompt = `Summarize this content about "${topic}" in 3-5 sentences. Be factual and concise:\n\n${text.slice(0, 3000)}`
    const body   = JSON.stringify({
      model:  'mistral',
      prompt,
      stream: false,
    })

    const req = http.request({
      hostname: 'localhost', port: 11434,
      path: '/api/generate', method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data).response?.trim() || text.slice(0, 500)) }
        catch(e) { resolve(text.slice(0, 500)) }
      })
    })
    req.on('error', () => resolve(text.slice(0, 500)))
    req.write(body)
    req.end()
  })
}

// ── LEARN FROM URL ─────────────────────────────────────────────────────────
async function learnFromUrl(url, topicHint = '') {
  console.log('[Aibo Knowledge] Learning from URL:', url)
  try {
    const html             = await fetchUrl(url)
    const { title, content } = extractContent(html, url)
    const topic            = topicHint || title
    const summary          = await summarizeWithOllama(content, topic)

    const saved = saveKnowledgeEntry({
      type:    'web',
      topic,
      content: summary,
      url,
      source:  new URL(url).hostname,
    })

    return { ok: true, topic, summary, saved }
  } catch(e) {
    console.error('[Aibo Knowledge] URL error:', e.message)
    return { ok: false, error: e.message }
  }
}

// ── RSS FEED READER ────────────────────────────────────────────────────────
async function readRssFeed(feedUrl, topic) {
  console.log('[Aibo Knowledge] Reading RSS:', feedUrl)
  try {
    const RSSParser = require('rss-parser')
    const parser    = new RSSParser({ timeout: 10000 })
    const feed      = await parser.parseURL(feedUrl)
    let   saved     = 0

    for (const item of feed.items.slice(0, 5)) {
      const content = item.contentSnippet || item.content || item.summary || ''
      if (content.length < 50) continue

      const summary = await summarizeWithOllama(content, item.title || topic)
      const ok = saveKnowledgeEntry({
        type:    'rss',
        topic:   item.title || topic,
        content: summary,
        url:     item.link || feedUrl,
        source:  feed.title || feedUrl,
      })
      if (ok) saved++
    }

    console.log(`[Aibo Knowledge] RSS ${feedUrl}: saved ${saved} articles`)
    return { ok: true, saved, feedTitle: feed.title }
  } catch(e) {
    console.error('[Aibo Knowledge] RSS error:', e.message)
    return { ok: false, error: e.message }
  }
}

// ── RSS FEED MANAGER ───────────────────────────────────────────────────────
function loadFeeds() {
  try {
    if (fs.existsSync(RSS_PATH)) return JSON.parse(fs.readFileSync(RSS_PATH, 'utf8'))
  } catch(e) {}
  return []
}

function saveFeeds(feeds) {
  ensureDir()
  fs.writeFileSync(RSS_PATH, JSON.stringify(feeds, null, 2), 'utf8')
}

function addFeed(url, topic, category = 'general') {
  const feeds = loadFeeds()
  if (feeds.some(f => f.url === url)) return false
  feeds.push({ url, topic, category, addedAt: new Date().toISOString() })
  saveFeeds(feeds)
  return true
}

async function refreshAllFeeds() {
  const feeds   = loadFeeds()
  const results = []
  for (const feed of feeds) {
    const result = await readRssFeed(feed.url, feed.topic)
    results.push({ ...feed, ...result })
    await sleep(1000) // be polite to servers
  }
  return results
}

// ── AUTONOMOUS INTEREST DETECTION ─────────────────────────────────────────
async function autoSubscribeFeeds(userInterests = []) {
  console.log('[Aibo Knowledge] Auto-subscribing feeds...')
  const feeds = loadFeeds()
  let added   = 0

  // Always subscribe to core feeds first
  for (const feed of AIBO_CORE_FEEDS) {
    if (!feeds.some(f => f.url === feed.url)) {
      addFeed(feed.url, feed.topic, feed.category)
      added++
      console.log('[Aibo Knowledge] Core feed added:', feed.topic)
    }
  }

  // Then add user interest feeds
  for (const interest of userInterests) {
    const interestFeeds = USER_INTEREST_FEEDS[interest] || []
    for (const feedUrl of interestFeeds) {
      if (!feeds.some(f => f.url === feedUrl)) {
        addFeed(feedUrl, interest, interest)
        added++
      }
    }
  }

  console.log(`[Aibo Knowledge] Auto-subscribed ${added} new feeds`)
  return added
}

// ── ADD CUSTOM TOPIC ───────────────────────────────────────────────────────
// User types any topic — Aibo searches and learns about it
async function learnCustomTopic(topic) {
  console.log('[Aibo Knowledge] Learning custom topic:', topic)

  // Search DuckDuckGo for the topic
  const results = await searchDuckDuckGo(`${topic} latest news 2026`)
  let learned = 0

  for (const result of results.slice(0, 3)) {
    if (!result.url?.startsWith('http')) continue
    const res = await learnFromUrl(result.url, topic)
    if (res.ok && res.saved) learned++
    await sleep(1000)
  }

  // Also try to find an RSS feed for the topic
  const feedSearch = await searchDuckDuckGo(`${topic} RSS feed site:feedburner.com OR site:feeds.feedblitz.com`)
  for (const result of feedSearch.slice(0, 2)) {
    if (result.url?.includes('feed') || result.url?.includes('rss')) {
      try {
        await readRssFeed(result.url, topic)
        addFeed(result.url, topic, 'custom')
      } catch(e) {}
    }
  }

  return { ok: true, learned, topic }
}

// ── NIGHT CRAWLER ──────────────────────────────────────────────────────────
let nightCrawlerRunning = false
let nightCrawlerTimer   = null

// Topics Aibo searches autonomously
const SEARCH_TOPICS = [
  'latest AWS services 2026',
  'new AI models released',
  'javascript best practices',
  'productivity tools for developers',
  'machine learning tutorials',
  'cloud computing trends',
  'open source AI projects',
]

async function searchDuckDuckGo(query) {
  try {
    const encoded = encodeURIComponent(query)
    const html    = await fetchUrl(`https://html.duckduckgo.com/html/?q=${encoded}`)
    const cheerio = require('cheerio')
    const $       = cheerio.load(html)
    const results = []

    $('.result__title a').each((i, el) => {
      if (i >= 3) return
      const href = $(el).attr('href') || ''
      const text = $(el).text().trim()
      // Extract actual URL from DDG redirect
      const match = href.match(/uddg=([^&]+)/)
      if (match) {
        results.push({ title: text, url: decodeURIComponent(match[1]) })
      }
    })

    return results
  } catch(e) {
    return []
  }
}

async function runNightCrawler(userInterests = [], mainWindow) {
  if (nightCrawlerRunning) return
  nightCrawlerRunning = true

  console.log('[Aibo Night Crawler] Starting autonomous learning session')

  // Always crawl Aibo growth topics + user interests
  const userTopics = userInterests.map(i => `${i} latest 2026`)
  const allTopics  = [...AIBO_GROWTH_TOPICS, ...userTopics]

  let learned = 0

  for (const topic of allTopics.slice(0, 10)) {
    if (!nightCrawlerRunning) break

    console.log('[Aibo Night Crawler] Searching:', topic)
    const results = await searchDuckDuckGo(topic)

    for (const result of results.slice(0, 2)) {
      if (!result.url?.startsWith('http')) continue
      const res = await learnFromUrl(result.url, topic)
      if (res.ok && res.saved) {
        learned++
        mainWindow?.webContents.send('knowledge-update', {
          topic: res.topic,
          count: learned,
        })
      }
      await sleep(2000)
    }

    await sleep(3000)
  }

  // Always refresh all subscribed feeds
  await refreshAllFeeds()

  nightCrawlerRunning = false
  console.log(`[Aibo Night Crawler] Session complete — learned ${learned} new things`)
  return learned
}

function stopNightCrawler() {
  nightCrawlerRunning = false
  clearTimeout(nightCrawlerTimer)
  console.log('[Aibo Night Crawler] Stopped')
}

// Schedule night crawler — runs at 2am or when system is idle
function scheduleNightCrawler(interests, mainWindow) {
  const now  = new Date()
  const next = new Date()
  next.setHours(2, 0, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)

  const msUntil2am = next - now
  console.log(`[Aibo Night Crawler] Scheduled for 2am (${Math.round(msUntil2am / 3600000)}h away)`)

  nightCrawlerTimer = setTimeout(async () => {
    await runNightCrawler(interests, mainWindow)
    // Reschedule for next night
    scheduleNightCrawler(interests, mainWindow)
  }, msUntil2am)
}

// ── IPC HANDLERS ───────────────────────────────────────────────────────────
function registerKnowledgeHandlers(getMemory, getMainWindow) {
  // Learn from a URL manually
  ipcMain.handle('learn-url', async (event, url) => {
    return await learnFromUrl(url)
  })

  // Learn a custom topic by name
  ipcMain.handle('learn-topic', async (event, topic) => {
    return await learnCustomTopic(topic)
  })

  // Add RSS feed
  ipcMain.handle('add-feed', async (event, { url, topic, category }) => {
    const added = addFeed(url, topic, category)
    if (added) {
      // Immediately read it
      const result = await readRssFeed(url, topic)
      return { ok: true, added, ...result }
    }
    return { ok: false, error: 'Feed already exists' }
  })

  // Get all feeds
  ipcMain.handle('get-feeds', () => loadFeeds())

  // Remove feed
  ipcMain.handle('remove-feed', (event, url) => {
    const feeds = loadFeeds().filter(f => f.url !== url)
    saveFeeds(feeds)
    return { ok: true }
  })

  // Refresh all feeds manually
  ipcMain.handle('refresh-feeds', async () => {
    const results = await refreshAllFeeds()
    return { ok: true, results }
  })

  // Search knowledge bank
  ipcMain.handle('search-knowledge', (event, query) => {
    return searchKnowledge(query, 10)
  })

  // Get knowledge stats
  ipcMain.handle('knowledge-stats', () => getKnowledgeStats())

  // Start night crawler manually
  ipcMain.handle('start-crawler', async () => {
    const memory    = getMemory()
    const interests = Object.keys(memory.interests || {})
      .sort((a, b) => (memory.interests[b] || 0) - (memory.interests[a] || 0))
      .slice(0, 5)

    runNightCrawler(interests, getMainWindow())
    return { ok: true, interests }
  })

  // Stop night crawler
  ipcMain.handle('stop-crawler', () => {
    stopNightCrawler()
    return { ok: true }
  })

  // Auto subscribe to feeds based on interests
  ipcMain.handle('auto-subscribe', async () => {
    const memory    = getMemory()
    const interests = Object.keys(memory.interests || {}).slice(0, 5)
    const added     = await autoSubscribeFeeds(interests)
    return { ok: true, added, interests }
  })
}

module.exports = {
  registerKnowledgeHandlers,
  learnFromUrl,
  learnCustomTopic,
  saveKnowledgeEntry,
  searchKnowledge,
  getKnowledgeStats,
  readRssFeed,
  addFeed,
  loadFeeds,
  refreshAllFeeds,
  runNightCrawler,
  stopNightCrawler,
  scheduleNightCrawler,
  autoSubscribeFeeds,
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }