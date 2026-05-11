/**
 * Aibo - main.js
 * One transparent window per monitor — bypasses DPI scaling issues
 * The orb lives in whichever window the cursor is currently in
 */

const { app } = require('electron')

// Must be before app ready
app.commandLine.appendSwitch('high-dpi-support', '1')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

const {
  BrowserWindow, screen, ipcMain,
  clipboard, globalShortcut, Tray, Menu, nativeImage
} = require('electron')
const path   = require('path')
const http   = require('http')
const https  = require('https')
const { execSync, spawn } = require('child_process')
const { registerTaskHandlers } = require('./src/tasks')
const { registerGmailHandlers, getToken } = require('./src/gmail')
const {
  loadMemory, saveMemory, analyzeMessage,
  buildSystemPrompt, addToContext, extractFacts,
  saveKnowledge, searchKnowledge,
} = require('./src/memory')
const {
  registerKnowledgeHandlers,
  scheduleNightCrawler,
  autoSubscribeFeeds,
  searchKnowledge: searchKnowledgeBank,
} = require('./src/knowledge')

// ── CONFIG FILE ────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(require('os').homedir(), '.aibo', 'config.json')

function loadConfig() {
  try {
    if (require('fs').existsSync(CONFIG_PATH)) {
      return JSON.parse(require('fs').readFileSync(CONFIG_PATH, 'utf8'))
    }
  } catch(e) {}
  return null
}

function saveConfig(config) {
  const dir = path.dirname(CONFIG_PATH)
  if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true })
  require('fs').writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
}

let aiboConfig = loadConfig()

let memory = loadMemory()
let voiceProcess = null
console.log('[Aibo] Memory loaded:', memory.style.totalMessages, 'messages')

// One window per display
const displayWindows = []  // { window, display, bounds }
let tray       = null
let orbVisible = true
let activeWindow = null  // window where orb currently lives

// ── CREATE ONE WINDOW PER DISPLAY ──────────────────────────────────────────
function createWindows() {
  const displays = screen.getAllDisplays()
  console.log('[Aibo] Creating windows for', displays.length, 'display(s)')

  displays.forEach((display, index) => {
    const { x, y, width, height } = display.bounds
    console.log(`[Aibo] Display ${index + 1}:`, { x, y, width, height }, 'scale:', display.scaleFactor)

    const win = new BrowserWindow({
      x, y, width, height,
      transparent:  true,
      frame:        false,
      alwaysOnTop:  true,
      skipTaskbar:  true,
      resizable:    false,
      hasShadow:    false,
      webPreferences: {
        nodeIntegration:  false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    })

    win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true, { forward: true })

    // Open devtools only on primary display for debugging
    if (display.id === screen.getPrimaryDisplay().id) {
      win.webContents.openDevTools({ mode: 'detach' })
    }

    // Tell each window its own display bounds
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('desktop-bounds', {
        x: 0, y: 0,          // relative to this window
        width, height,
        displayIndex: index,
        isPrimary: display.id === screen.getPrimaryDisplay().id,
      })
      console.log(`[Aibo] Window ${index + 1} loaded:`, width, 'x', height)
    })

    displayWindows.push({ window: win, display, bounds: { x, y, width, height } })
  })

  // Start cursor polling — sends mouse position to the correct window
  startCursorPolling()
}

// ── CURSOR POLLING ─────────────────────────────────────────────────────────
// Every 16ms check which display the cursor is on
// Send relative position to that display's window only
// Send 'orb-inactive' to all other windows so orb hides there
function startCursorPolling() {
  let lastDisplayIndex = -1

  setInterval(() => {
    const cursor   = screen.getCursorScreenPoint()
    const display  = screen.getDisplayNearestPoint(cursor)

    // Find which of our tracked windows matches this display
    const entry = displayWindows.find(e => e.display.id === display.id)
    if (!entry) return

    const currentIndex = displayWindows.indexOf(entry)
    const { x, y, width, height } = entry.bounds

    // Cursor position relative to this display
    const relX = cursor.x - x
    const relY = cursor.y - y

    // Send mouse position to the active display's window
    if (!entry.window.isDestroyed()) {
      entry.window.webContents.send('mouse-move', { x: relX, y: relY, active: true })
    }

    // When cursor moves to a different display
    if (currentIndex !== lastDisplayIndex) {
      console.log(`[Aibo] Cursor moved to display ${currentIndex + 1}`)

      // Tell all OTHER windows the orb should sleep there
      displayWindows.forEach((e, i) => {
        if (i !== currentIndex && !e.window.isDestroyed()) {
          e.window.webContents.send('mouse-move', { x: -999, y: -999, active: false })
        }
      })

      lastDisplayIndex = currentIndex
      activeWindow = entry.window
    }
  }, 16)
}

// ── BROADCAST TO ALL WINDOWS ───────────────────────────────────────────────
function broadcastToAll(channel, data) {
  displayWindows.forEach(e => {
    if (!e.window.isDestroyed()) {
      e.window.webContents.send(channel, data)
    }
  })
}

// ── SYSTEM TRAY ────────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/' +
    '9hAAAABmJLR0QA/wD/AP+gvaeTAAAAoklEQVQ4jc2SQQqDMBBFX6ILeweXvUHx' +
    'JN5bkC7sObqXoDs3QgqFkDDzupCmNmkFqX2bgfl8ZgYS+SdJkrz3fo+IJIBVVQVg' +
    'ZhYAMLMiIh4AkiTJAMxMVJXWWgAws1JVAcDdWWsFkpndASilAEC01gIws1JKAXD' +
    'ee2ZWSimAMcbIGGOQUgIwxhhijDHGGGOMMcYYY4wxxhhjjDHGGGP8A18Bo2AkJTv' +
    'KHAAAAABJRkJggg=='
  )
  tray = new Tray(icon)
  tray.setToolTip('Aibo — AI Desktop Assistant')
  tray.on('click', toggleOrb)
  updateTrayMenu()
}

function updateTrayMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: orbVisible ? '👁  Hide Aibo' : '👁  Show Aibo', click: toggleOrb },
    { type: 'separator' },
    { label: '⚙️  Settings', click: () => { showOrb(); broadcastToAll('open-panel', {}) } },
    { label: '🎯  Tasks',    click: () => { showOrb(); broadcastToAll('open-tasks', {}) } },
    { type: 'separator' },
    { label: `📊  ${memory.style.totalMessages} interactions learned`, enabled: false },
    { label: `🖥️  ${displayWindows.length} monitor(s) active`, enabled: false },
    { type: 'separator' },
    { label: '🚪  Quit Aibo', click: () => { saveMemory(memory); app.exit(0) } },
  ]))
}

function toggleOrb() { orbVisible ? hideOrb() : showOrb() }

function showOrb() {
  orbVisible = true
  broadcastToAll('orb-visibility', true)
  tray?.setToolTip('Aibo — Active')
  updateTrayMenu()
}

function hideOrb() {
  orbVisible = false
  broadcastToAll('orb-visibility', false)
  tray?.setToolTip('Aibo — Hidden')
  updateTrayMenu()
}

// ── IPC ────────────────────────────────────────────────────────────────────
ipcMain.on('set-ignore-mouse', (event, ignore) => {
  // Only set for the window that sent this message
  const win = BrowserWindow.fromWebContents(event.sender)
  win?.setIgnoreMouseEvents(ignore, { forward: true })
})

ipcMain.on('quit-app',  () => { saveMemory(memory); app.exit(0) })
ipcMain.on('hide-orb',  hideOrb)
ipcMain.on('show-orb',  showOrb)

ipcMain.on('update-memory', (event, updates) => {
  memory = { ...memory, ...updates }
  if (updates.user) memory.user = { ...memory.user, ...updates.user }
  saveMemory(memory)
  updateTrayMenu()
})

ipcMain.handle('get-memory', () => memory)

// ── OLLAMA ─────────────────────────────────────────────────────────────────
ipcMain.handle('ask-ollama', async (event, { mode, text }) => {
  console.log(`[Aibo] Asking Ollama — mode: ${mode}`)
  memory = analyzeMessage(text, memory)
  extractFacts(text, memory)
  addToContext(memory, 'user', text)

  const systemPrompt = buildSystemPrompt(memory)
  const model = mode === 'fix' ? 'codellama' : 'mistral'

  // Search knowledge bank for relevant context
  const relevant = searchKnowledge(text, 3)
  const knowledgeContext = relevant.length > 0
    ? `\nRELEVANT KNOWLEDGE FROM PAST INTERACTIONS:\n${relevant.map(k =>
        `- [${k.type}] ${k.topic}: ${k.content.slice(0, 150)}`
      ).join('\n')}\n`
    : ''

  // Inject current situational context
  const ctxNote = currentContext.activeApp
    ? `\nCURRENT CONTEXT: User is in ${currentContext.activeApp} (${currentContext.activeApp}), working for ${currentContext.workingMins} minutes, time: ${currentContext.timeOfDay}\n`
    : ''
  // Check if user is asking about Aibo itself
  const selfKeywords = ['how do you work', 'what are you', 'what can you do', 'how are you built',
    'what ai', 'your techniques', 'how do you learn', 'what model', 'tell me about yourself',
    'who are you', 'what is aibo', 'how were you made']
  const isSelfQuery = selfKeywords.some(k => text.toLowerCase().includes(k))
  const selfContext = isSelfQuery
    ? `\nRELEVANT — USER IS ASKING ABOUT YOU:\n${require('./src/memory').AIBO_SELF_KNOWLEDGE}\n`
    : ''

  const prompts = {
    read:    `Summarize and explain the following. Decide the best length:\n\n${text}`,
    fix:     `Fix the bugs in this code. Above EACH line you changed add a comment starting with "# FIXED:" explaining exactly what was wrong. Return ONLY the corrected code with fix comments. No explanations outside the code. No markdown fences:\n\n${text}`,
    explain: `Explain the following. Choose best format and length:\n\n${text}`,
    chat:    text,
  }

  try {
    const body = JSON.stringify({
      model,
      prompt: prompts[mode] || text,
      system: systemPrompt + knowledgeContext + ctxNote + selfContext,
      stream: false,
    })

    const reply = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost', port: 11434,
        path: '/api/generate', method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => {
          try { resolve(JSON.parse(data).response?.trim() || 'No response.') }
          catch(e) { reject(new Error('Failed to parse Ollama response')) }
        })
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })

    addToContext(memory, 'aibo', reply)

    // Save to knowledge bank based on mode
    if (mode === 'read' || mode === 'explain') {
      saveKnowledge({
        type:    'read',
        topic:   text.slice(0, 60),
        content: reply,
        source:  'user selection',
      })
    } else if (mode === 'chat') {
      saveKnowledge({
        type:    'chat',
        topic:   text.slice(0, 60),
        content: reply,
      })
    }

    saveMemory(memory)
    updateTrayMenu()
    return { ok: true, reply, model }
  } catch(err) {
    return { ok: false, error: `Could not reach Ollama.\n\n${err.message}` }
  }
})

// ── CLIPBOARD ──────────────────────────────────────────────────────────────
let lastClipboard = ''

function startClipboardWatch() {
  // Reset lastClipboard on startup so first copy always fires
  lastClipboard = clipboard.readText() || ''

  setInterval(() => {
    try {
      // Try plain text first
      let current = clipboard.readText()

      // If plain text is empty, try reading as buffer (handles VS Code RTF)
      if (!current || current.trim().length < 2) {
        const formats = clipboard.availableFormats()
        // VS Code copies as text/plain too, just need to check all formats
        if (formats.includes('text/plain')) {
          current = clipboard.readText('text/plain') || ''
        }
      }

      if (current && current.trim().length > 2 && current.trim() !== lastClipboard.trim()) {
        lastClipboard = current.trim()
        console.log('[Aibo] Clipboard updated:', current.slice(0, 50))
        broadcastToAll('clipboard-changed', current.trim())
      }
    } catch(e) {
      // Clipboard can throw if another app is using it
    }
  }, 300) // faster poll — 300ms instead of 500ms
}

ipcMain.handle('get-selected-text', async () => {
  try {
    const previous = clipboard.readText()
    await sleep(60)
    execSync('powershell -command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys(\'^c\')"')
    await sleep(200)
    const selected = clipboard.readText()
    clipboard.writeText(previous)
    if (selected && selected !== previous && selected.trim().length > 0) return selected.trim()
    return ''
  } catch(err) { return '' }
})

// ── WEB SEARCH ─────────────────────────────────────────────────────────────
ipcMain.handle('web-search', async (event, query) => {
  try {
    const encoded = encodeURIComponent(query)
    const raw = await new Promise((resolve, reject) => {
      https.get(
        `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
        res => {
          let data = ''
          res.on('data', c => data += c)
          res.on('end', () => resolve(data))
        }
      ).on('error', reject)
    })
    const json   = JSON.parse(raw)
    const answer = json.Answer || json.AbstractText || json.RelatedTopics?.[0]?.Text || null
    if (answer?.length > 10) {
      // Save to knowledge bank
      saveKnowledge({
        type:    'web',
        topic:   query.slice(0, 60),
        content: answer,
        source:  json.AbstractURL || 'DuckDuckGo',
      })
      return { ok: true, answer, source: json.AbstractURL || 'DuckDuckGo' }
    }
    return { ok: true, answer: null, source: null }
  } catch(err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.on('write-clipboard', (event, text) => clipboard.writeText(text))

// ── SITUATIONAL AWARENESS ──────────────────────────────────────────────────
let currentContext = {
  activeApp:     '',
  activeTitle:   '',
  lastClipboard: '',
  workingMins:   0,
  idleMins:      0,
  timeOfDay:     'morning',
  mood:          'curious',
}

// App context definitions — tells Aibo how to behave in each app
const APP_CONTEXTS = {
  // Dev tools
  'Code':         { mode: 'coding',      mood: 'focused',     quiet: true,  label: 'VS Code'       },
  'code':         { mode: 'coding',      mood: 'focused',     quiet: true,  label: 'VS Code'       },
  'sublime_text': { mode: 'coding',      mood: 'focused',     quiet: true,  label: 'Sublime Text'  },
  'notepad++':    { mode: 'coding',      mood: 'focused',     quiet: true,  label: 'Notepad++'     },
  'powershell':   { mode: 'terminal',    mood: 'alert',       quiet: false, label: 'PowerShell'    },
  'cmd':          { mode: 'terminal',    mood: 'alert',       quiet: false, label: 'Terminal'      },
  'WindowsTerminal':{ mode: 'terminal',  mood: 'alert',       quiet: false, label: 'Terminal'      },
  'git-bash':     { mode: 'terminal',    mood: 'focused',     quiet: true,  label: 'Git Bash'      },

  // Browsers
  'chrome':       { mode: 'browsing',    mood: 'curious',     quiet: false, label: 'Chrome'        },
  'firefox':      { mode: 'browsing',    mood: 'curious',     quiet: false, label: 'Firefox'       },
  'msedge':       { mode: 'browsing',    mood: 'curious',     quiet: false, label: 'Edge'          },
  'brave':        { mode: 'browsing',    mood: 'curious',     quiet: false, label: 'Brave'         },

  // Office/productivity
  'EXCEL':        { mode: 'data',        mood: 'focused',     quiet: false, label: 'Excel'         },
  'WINWORD':      { mode: 'writing',     mood: 'focused',     quiet: true,  label: 'Word'          },
  'POWERPNT':     { mode: 'presenting',  mood: 'focused',     quiet: true,  label: 'PowerPoint'    },
  'Notion':       { mode: 'notes',       mood: 'curious',     quiet: false, label: 'Notion'        },
  'Obsidian':     { mode: 'notes',       mood: 'curious',     quiet: false, label: 'Obsidian'      },

  // Communication
  'Discord':      { mode: 'social',      mood: 'playful',     quiet: true,  label: 'Discord'       },
  'slack':        { mode: 'work-chat',   mood: 'alert',       quiet: true,  label: 'Slack'         },
  'zoom':         { mode: 'meeting',     mood: 'alert',       quiet: true,  label: 'Zoom'          },
  'Teams':        { mode: 'meeting',     mood: 'alert',       quiet: true,  label: 'Teams'         },

  // Media
  'Spotify':      { mode: 'music',       mood: 'playful',     quiet: true,  label: 'Spotify'       },
  'vlc':          { mode: 'video',       mood: 'bored',       quiet: true,  label: 'VLC'           },

  // Design
  'figma':        { mode: 'design',      mood: 'curious',     quiet: false, label: 'Figma'         },
  'Photoshop':    { mode: 'design',      mood: 'focused',     quiet: true,  label: 'Photoshop'     },

  // Default
  'explorer':     { mode: 'files',       mood: 'curious',     quiet: false, label: 'File Explorer' },
}

// Get current active window process name using PowerShell
function getActiveWindowProcess() {
  try {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
        }
"@
      $hwnd = [Win32]::GetForegroundWindow()
      $pid = 0
      [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
      $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
      if ($proc) { "$($proc.ProcessName)|$($proc.MainWindowTitle)" }
    `
    const result = execSync(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, {
      timeout: 2000,
      windowsHide: true,
    }).toString().trim()
    return result
  } catch(e) {
    return ''
  }
}

// Start polling active window every 3 seconds
function startContextAwareness() {
  let lastApp     = ''
  let workStart   = Date.now()
  let lastActivity = Date.now()

  setInterval(() => {
    try {
      const raw   = getActiveWindowProcess()
      if (!raw) return

      const [processName, windowTitle] = raw.split('|')
      const appCtx = APP_CONTEXTS[processName] || {
        mode: 'general', mood: 'curious', quiet: false, label: processName
      }

      // Track working time
      const now        = Date.now()
      const hour       = new Date().getHours()
      currentContext.timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night'
      currentContext.workingMins = Math.floor((now - workStart) / 60000)
      currentContext.activeApp   = processName
      currentContext.activeTitle = windowTitle || ''
      currentContext.mood        = appCtx.mood

      // App changed — notify renderer
      if (processName !== lastApp) {
        console.log(`[Aibo Context] App changed: ${lastApp} → ${processName} (${appCtx.mode})`)
        lastApp = processName

        broadcastToAll('context-update', {
          app:   processName,
          label: appCtx.label,
          mode:  appCtx.mode,
          mood:  appCtx.mood,
          quiet: appCtx.quiet,
          title: windowTitle,
          workingMins: currentContext.workingMins,
          timeOfDay:   currentContext.timeOfDay,
        })
      }

      // Alert on long work sessions
      const mins = currentContext.workingMins
      if (mins === 60)  broadcastToAll('context-alert', { type: 'long-session', mins })
      if (mins === 120) broadcastToAll('context-alert', { type: 'very-long-session', mins })
      if (mins === 240) broadcastToAll('context-alert', { type: 'marathon-session', mins })

    } catch(e) {
      // Silently ignore context polling errors
    }
  }, 3000)

  console.log('[Aibo] Situational awareness started')
}

// Expose current context to renderer
ipcMain.handle('get-context', () => currentContext)

// ── VOICE SERVER ───────────────────────────────────────────────────────────
function getPythonCmd() {
  // Try different python commands until one works
  const cmds = ['python', 'python3', 'py']
  for (const cmd of cmds) {
    try {
      const result = execSync(`${cmd} --version`, { timeout: 3000 }).toString()
      if (result.includes('Python')) {
        console.log(`[Aibo Voice] Found Python: ${cmd} (${result.trim()})`)
        return cmd
      }
    } catch(e) {}
  }
  console.error('[Aibo Voice] Python not found — voice disabled')
  return null
}

let voiceRestartCount = 0
let isQuitting = false

function startVoiceServer() {
  const serverPath = path.join(__dirname, 'voice_server.py')
  const pythonCmd  = getPythonCmd()

  if (!pythonCmd) return
  if (!require('fs').existsSync(serverPath)) {
    console.error('[Aibo Voice] voice_server.py not found at:', serverPath)
    return
  }

  console.log('[Aibo Voice] Starting voice server...')
  voiceProcess = spawn(pythonCmd, [serverPath], {
    detached: false,
    stdio:    ['ignore', 'pipe', 'pipe'],
    cwd:      __dirname,
  })

  voiceProcess.stdout.on('data', d => console.log('[Voice]', d.toString().trim()))
  voiceProcess.stderr.on('data', d => console.log('[Voice ERR]', d.toString().trim()))

  voiceProcess.on('exit', (code, signal) => {
    voiceProcess = null

    // Don't restart if we're quitting intentionally
    if (isQuitting) return

    voiceRestartCount++
    console.log(`[Aibo Voice] Server exited (code: ${code}) — restart #${voiceRestartCount} in 3s`)

    // Auto restart after 3 seconds — up to 5 times
    if (voiceRestartCount <= 5) {
      setTimeout(() => {
        if (!isQuitting) {
          console.log('[Aibo Voice] Restarting...')
          startVoiceServer()
        }
      }, 3000)
    } else {
      console.error('[Aibo Voice] Too many restarts — giving up. Restart Aibo manually.')
    }
  })

  console.log('[Aibo Voice] PID:', voiceProcess.pid)
}

// Speak text via voice server
async function speakText(text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ text })
    const req  = http.request({
      hostname: '127.0.0.1',
      port:     5002,
      path:     '/speak',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve({ ok: true }))
    })
    req.on('error', err => {
      console.error('[Aibo Voice] Speak error:', err.message)
      resolve({ ok: false, error: err.message })
    })
    req.write(body)
    req.end()
  })
}

// IPC — renderer asks Aibo to speak
ipcMain.handle('speak', async (event, text) => {
  return await speakText(text)
})

// IPC — stop speaking
ipcMain.on('stop-speaking', () => {
  http.request({ hostname: '127.0.0.1', port: 5002, path: '/stop', method: 'POST' })
    .on('error', () => {}).end()
})

// ── APP LIFECYCLE ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Always have a default config
  if (!aiboConfig) {
    aiboConfig = {
      name:      'Friend',
      shape:     'ball',
      color:     { main: '#6C5DD3', glow: '#9b8fef', dark: '#3a2fa0' },
      interests: ['coding', 'ai', 'tech'],
      language:  'en',
      firstLaunch: true,
    }
  }

  // First launch — show setup wizard
  if (aiboConfig.firstLaunch) {
    showSetupWizard()
    return
  }

  // Normal launch
  launchAibo()
})

function showSetupWizard() {
  const setupWin = new BrowserWindow({
    width:  900,
    height: 680,
    center: true,
    frame:  false,
    resizable: false,
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
  })

  setupWin.loadFile(path.join(__dirname, 'setup.html'))

  ipcMain.once('setup-complete', (event, config) => {
    // Mark as no longer first launch
    config.firstLaunch = false
    aiboConfig = config
    saveConfig(config)

    // Update memory with user preferences
    memory.user.name     = config.name
    memory.user.language = config.language || 'en'
    config.interests.forEach(i => {
      memory.interests[i] = (memory.interests[i] || 0) + 5
    })
    saveMemory(memory)

    console.log('[Aibo Setup] Config saved:', JSON.stringify(config))
    setupWin.close()
    launchAibo()
  })
}

async function launchAibo() {
  createWindows()
  createTray()
  startClipboardWatch()
  startVoiceServer()
  startContextAwareness()
  registerTaskHandlers(getToken)
  registerGmailHandlers()
  registerKnowledgeHandlers(() => memory, () => displayWindows[0]?.window)

  // Send config to all renderer windows once they load
  // Small delay ensures renderer JS has fully initialized
  displayWindows.forEach(({ window: win }) => {
    const sendConfig = () => {
      setTimeout(() => {
        win.webContents.send('aibo-config', aiboConfig)
        console.log('[Aibo] Config sent to renderer:', aiboConfig?.shape, aiboConfig?.color?.main)
      }, 500) // 500ms gives renderer time to register listeners
    }

    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', sendConfig)
    } else {
      sendConfig()
    }
  })

  // Renderer can also request config on demand (backup)
  ipcMain.handle('get-config', () => aiboConfig)

  // Auto-subscribe RSS feeds based on interests
  const interests = Object.keys(memory.interests || {})
    .sort((a, b) => (memory.interests[b] || 0) - (memory.interests[a] || 0))
    .slice(0, 5)
  await autoSubscribeFeeds(interests)

  // Schedule night crawler at 2am
  scheduleNightCrawler(interests, displayWindows[0]?.window)

  globalShortcut.register('Ctrl+Shift+Space', () => {
    console.log('[Aibo] Wake hotkey')
    if (!orbVisible) showOrb()

    const current = clipboard.readText()
    if (current && current.trim().length > 2 && current.trim() !== lastClipboard.trim()) {
      lastClipboard = current.trim()
      broadcastToAll('clipboard-changed', current.trim())
    }

    broadcastToAll('trigger-selection', {})
  })

  // Keep all windows on top
  setInterval(() => {
    displayWindows.forEach(e => {
      if (!e.window.isDestroyed()) e.window.setAlwaysOnTop(true, 'screen-saver')
    })
  }, 5000)

  // Handle display changes
  screen.on('display-added', () => {
    displayWindows.forEach(e => { if (!e.window.isDestroyed()) e.window.close() })
    displayWindows.length = 0
    createWindows()
  })
  screen.on('display-removed', () => {
    displayWindows.forEach(e => { if (!e.window.isDestroyed()) e.window.close() })
    displayWindows.length = 0
    createWindows()
  })
}

app.on('window-all-closed', e => e.preventDefault())
app.on('before-quit', () => {
  isQuitting = true
  saveMemory(memory)
  if (voiceProcess) { voiceProcess.kill(); console.log('[Aibo Voice] Server stopped') }
})
app.on('will-quit', () => globalShortcut.unregisterAll())

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }