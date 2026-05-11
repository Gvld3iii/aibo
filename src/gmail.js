/**
 * Aibo - gmail.js
 * Gmail OAuth2 flow using Electron BrowserWindow
 * Setup: https://console.cloud.google.com
 *   1. Create a project
 *   2. Enable Gmail API
 *   3. Create OAuth credentials (Desktop app)
 *   4. Add your email as a test user
 *   5. Paste client_id and client_secret below
 */

const { BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const http = require('http')

// ── CONFIG ─────────────────────────────────────────────────────────────────
const GMAIL_CONFIG = {
  client_id:     process.env.GMAIL_CLIENT_ID     || 'YOUR_GMAIL_CLIENT_ID',
  client_secret: process.env.GMAIL_CLIENT_SECRET || 'YOUR_GMAIL_CLIENT_SECRET',
  redirect_uri:  'http://localhost:8765/oauth2callback',
}

const TOKEN_DIR  = path.join(os.homedir(), '.aibo')
const TOKEN_PATH = path.join(TOKEN_DIR, 'gmail-token.json')

let gmailToken = null

// ── TOKEN STORAGE ──────────────────────────────────────────────────────────
function loadToken() {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      gmailToken = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
      console.log('[Aibo Gmail] Token loaded from disk')
      return true
    }
  } catch(e) {
    console.log('[Aibo Gmail] No saved token found')
  }
  return false
}

function saveToken(token) {
  if (!fs.existsSync(TOKEN_DIR)) fs.mkdirSync(TOKEN_DIR, { recursive: true })
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), 'utf8')
  console.log('[Aibo Gmail] Token saved')
}

function getToken() {
  return gmailToken
}

// ── OAUTH FLOW ─────────────────────────────────────────────────────────────
function startGmailAuth() {
  return new Promise((resolve, reject) => {
    if (GMAIL_CONFIG.client_id === 'YOUR_GMAIL_CLIENT_ID') {
      return reject(new Error('Gmail client_id not configured. See src/gmail.js setup instructions.'))
    }

    const { google } = require('googleapis')
    const oauth2Client = new google.auth.OAuth2(
      GMAIL_CONFIG.client_id,
      GMAIL_CONFIG.client_secret,
      GMAIL_CONFIG.redirect_uri
    )

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt:      'consent',
      scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    })

    // Open auth popup
    const authWindow = new BrowserWindow({
      width:  520,
      height: 680,
      title:  'Connect Gmail to Aibo',
      webPreferences: { nodeIntegration: false },
    })

    authWindow.loadURL(authUrl)

    let resolved = false

    // Local redirect server to catch OAuth callback
    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith('/oauth2callback')) return

      const code = new URL(req.url, 'http://localhost:8765').searchParams.get('code')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0d0d1a;color:#e0dff8;">
          <h2 style="color:#9b8fef">✅ Gmail connected to Aibo!</h2>
          <p>You can close this window.</p>
        </body></html>
      `)

      server.close()
      if (!authWindow.isDestroyed()) authWindow.close()

      try {
        const { tokens } = await oauth2Client.getToken(code)
        gmailToken = tokens
        saveToken(tokens)
        resolved = true
        resolve(tokens)
      } catch(err) {
        reject(err)
      }
    })

    server.listen(8765, () => {
      console.log('[Aibo Gmail] OAuth callback server listening on :8765')
    })

    authWindow.on('closed', () => {
      server.close()
      if (!resolved) reject(new Error('Auth window closed before completing'))
    })
  })
}

// ── IPC HANDLERS ───────────────────────────────────────────────────────────
function registerGmailHandlers() {
  loadToken()

  ipcMain.handle('gmail-status', () => {
    return { connected: !!gmailToken }
  })

  ipcMain.handle('gmail-connect', async () => {
    try {
      await startGmailAuth()
      return { ok: true }
    } catch(err) {
      console.error('[Aibo Gmail] Auth error:', err.message)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('gmail-disconnect', () => {
    gmailToken = null
    try { fs.unlinkSync(TOKEN_PATH) } catch(e) {}
    console.log('[Aibo Gmail] Disconnected')
    return { ok: true }
  })
}

module.exports = { registerGmailHandlers, getToken }