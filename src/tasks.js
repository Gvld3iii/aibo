/**
 * Aibo - tasks.js
 * Natural language task parser + executor
 * Handles: email, file, calendar, browser
 */

const { ipcMain, shell } = require('electron')
const fs   = require('fs')
const path = require('path')
const http = require('http')
const os   = require('os')

// ── TASK PARSER ────────────────────────────────────────────────────────────
async function parseTask(description) {
  const home      = os.homedir()
  const desktop   = path.join(home, 'Desktop')
  const docs      = path.join(home, 'Documents')
  const downloads = path.join(home, 'Downloads')
  const today     = new Date().toISOString().split('T')[0]

  const prompt = `
You are a task parser for a Windows 11 PC.
The user's actual folder paths are:
- Home: ${home}
- Desktop: ${desktop}
- Documents: ${docs}
- Downloads: ${downloads}
- Today's date: ${today}

Parse the user's task into a JSON object.
Respond with ONLY valid JSON — no explanation, no markdown, no code fences.
Always use full absolute Windows paths (e.g. ${desktop}\\notes.txt).

Task: "${description}"

Return one of these formats:

Email task:
{
  "type": "email",
  "to": "recipient name or email",
  "subject": "email subject",
  "body": "full email body text",
  "confidence": 0.9
}

File task:
{
  "type": "file",
  "action": "create|open|move|rename|delete|search",
  "path": "full absolute Windows path",
  "newPath": "full absolute Windows path if moving or renaming",
  "content": "file content if creating",
  "confidence": 0.9
}

Calendar task:
{
  "type": "calendar",
  "title": "event title",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "duration": 60,
  "description": "event description",
  "confidence": 0.9
}

Browser task:
{
  "type": "browser",
  "action": "open|search|navigate",
  "url": "full https:// URL if known",
  "query": "search query if searching",
  "confidence": 0.9
}

Unknown task:
{
  "type": "unknown",
  "confidence": 0.1
}
`

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:  'mistral',
      prompt,
      stream: false,
      format: 'json',
    })

    const req = http.request({
      hostname: 'localhost',
      port:     11434,
      path:     '/api/generate',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          const text   = parsed.response?.trim() || '{}'
          const clean  = text.replace(/```json|```/g, '').trim()
          const task   = JSON.parse(clean)
          resolve(task)
        } catch(e) {
          resolve({ type: 'unknown', confidence: 0, parseError: e.message })
        }
      })
    })

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── EMAIL ──────────────────────────────────────────────────────────────────
async function executeEmail(task, gmailToken) {
  if (!gmailToken) {
    return { ok: false, error: 'Gmail not connected. Click Connect Gmail in the task panel.' }
  }

  try {
    const { google } = require('googleapis')
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials(gmailToken)

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    const message = [
      `To: ${task.to}`,
      `Subject: ${task.subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      task.body,
    ].join('\n')

    const encoded = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    })

    return { ok: true, message: `Email sent to ${task.to}` }
  } catch(err) {
    return { ok: false, error: err.message }
  }
}

// ── FILE ───────────────────────────────────────────────────────────────────
async function executeFile(task) {
  try {
    const home = os.homedir()

    // Resolve relative paths and ~ to full paths
    const resolvePath = (p) => {
      if (!p) return home
      if (p.startsWith('~')) return p.replace('~', home)
      if (path.isAbsolute(p)) return p
      // If relative, assume Desktop
      return path.join(home, 'Desktop', p)
    }

    const filePath = resolvePath(task.path)

    console.log(`[Aibo File] action=${task.action} path=${filePath}`)

    switch (task.action) {
      case 'create': {
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(filePath, task.content || '', 'utf8')
        return { ok: true, message: `Created: ${filePath}` }
      }

      case 'open': {
        if (!fs.existsSync(filePath)) {
          return { ok: false, error: `File not found: ${filePath}` }
        }
        await shell.openPath(filePath)
        return { ok: true, message: `Opened: ${filePath}` }
      }

      case 'delete': {
        if (!fs.existsSync(filePath)) {
          return { ok: false, error: `File not found: ${filePath}` }
        }
        fs.unlinkSync(filePath)
        return { ok: true, message: `Deleted: ${filePath}` }
      }

      case 'rename':
      case 'move': {
        if (!fs.existsSync(filePath)) {
          return { ok: false, error: `File not found: ${filePath}` }
        }
        const newPath = resolvePath(task.newPath)
        const newDir  = path.dirname(newPath)
        if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true })
        fs.renameSync(filePath, newPath)
        return { ok: true, message: `Moved to: ${newPath}` }
      }

      case 'search': {
        const query   = task.path || task.query || ''
        const results = searchFiles(home, query, 20)
        if (results.length === 0) {
          return { ok: true, message: `No files found matching "${query}"` }
        }
        return { ok: true, message: `Found ${results.length} file(s) matching "${query}":\n${results.slice(0, 5).join('\n')}` }
      }

      default:
        return { ok: false, error: `Unknown file action: ${task.action}` }
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function searchFiles(dir, query, limit, results = []) {
  if (results.length >= limit) return results
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= limit) break
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.name.toLowerCase().includes(query.toLowerCase())) {
        results.push(fullPath)
      }
      if (entry.isDirectory() && !['node_modules', 'AppData', '$Recycle.Bin'].includes(entry.name)) {
        try { searchFiles(fullPath, query, limit, results) } catch(e) {}
      }
    }
  } catch(e) {}
  return results
}

// ── CALENDAR ───────────────────────────────────────────────────────────────
async function executeCalendar(task) {
  try {
    const dateStr = task.date || new Date().toISOString().split('T')[0]
    const timeStr = task.time || '09:00'
    const startDate = new Date(`${dateStr}T${timeStr}:00`)

    if (isNaN(startDate.getTime())) {
      return { ok: false, error: `Invalid date/time: ${dateStr} ${timeStr}` }
    }

    const endDate = new Date(startDate.getTime() + (task.duration || 60) * 60000)
    const fmt     = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Aibo//EN',
      'BEGIN:VEVENT',
      `UID:${Date.now()}@aibo`,
      `DTSTART:${fmt(startDate)}`,
      `DTEND:${fmt(endDate)}`,
      `SUMMARY:${task.title || 'Aibo Event'}`,
      `DESCRIPTION:${task.description || 'Created by Aibo'}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const icsPath = path.join(os.tmpdir(), `aibo-event-${Date.now()}.ics`)
    fs.writeFileSync(icsPath, ics, 'utf8')
    await shell.openPath(icsPath)

    return { ok: true, message: `Calendar event created: ${task.title} on ${dateStr} at ${timeStr}` }
  } catch(err) {
    return { ok: false, error: err.message }
  }
}

// ── BROWSER ────────────────────────────────────────────────────────────────
async function executeBrowser(task) {
  try {
    let url = task.url

    if (!url && task.query) {
      url = `https://www.google.com/search?q=${encodeURIComponent(task.query)}`
    }

    // Make sure URL has a scheme
    if (url && !url.startsWith('http')) url = 'https://' + url

    if (!url) return { ok: false, error: 'No URL or search query provided' }

    await shell.openExternal(url)
    return { ok: true, message: `Opened: ${url}` }
  } catch(err) {
    return { ok: false, error: err.message }
  }
}

// ── IPC HANDLERS ───────────────────────────────────────────────────────────
function registerTaskHandlers(getGmailToken) {
  ipcMain.handle('parse-task', async (event, description) => {
    console.log('[Aibo Tasks] Parsing:', description)
    try {
      const task = await parseTask(description)
      console.log('[Aibo Tasks] Parsed:', JSON.stringify(task))
      return { ok: true, task }
    } catch(err) {
      console.error('[Aibo Tasks] Parse error:', err.message)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('execute-task', async (event, task) => {
    console.log('[Aibo Tasks] Executing:', task.type, task.action || '')
    try {
      switch(task.type) {
        case 'email':    return await executeEmail(task, getGmailToken())
        case 'file':     return await executeFile(task)
        case 'calendar': return await executeCalendar(task)
        case 'browser':  return await executeBrowser(task)
        default:         return { ok: false, error: `Unknown task type: ${task.type}` }
      }
    } catch(err) {
      console.error('[Aibo Tasks] Execute error:', err.message)
      return { ok: false, error: err.message }
    }
  })
}

module.exports = { registerTaskHandlers }