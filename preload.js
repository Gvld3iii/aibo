/**
 * Aibo - preload.js
 * Secure IPC bridge — main ↔ renderer
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aibo', {

  // ── MOUSE ──
  setIgnoreMouse: (ignore) => {
    ipcRenderer.send('set-ignore-mouse', ignore)
  },
  onMouseMove: (callback) => {
    ipcRenderer.on('mouse-move', (event, pos) => callback(pos))
  },

  // ── APP ──
  quit: () => ipcRenderer.send('quit-app'),
  hideOrb: () => ipcRenderer.send('hide-orb'),
  showOrb: () => ipcRenderer.send('show-orb'),

  // Tray tells renderer to show/hide the orb
  onOrbVisibility: (callback) => {
    ipcRenderer.on('orb-visibility', (event, visible) => callback(visible))
  },

  // Tray can open panel or tasks directly
  onOpenPanel: (callback) => {
    ipcRenderer.on('open-panel', () => callback())
  },
  onOpenTasks: (callback) => {
    ipcRenderer.on('open-tasks', () => callback())
  },

  // Receive virtual desktop dimensions (all monitors combined)
  onDesktopBounds: (callback) => {
    ipcRenderer.on('desktop-bounds', (event, bounds) => callback(bounds))
  },

  // ── OLLAMA ──
  askOllama: (mode, text) => {
    return ipcRenderer.invoke('ask-ollama', { mode, text })
  },

  // ── CLIPBOARD ──
  getSelectedText: () => ipcRenderer.invoke('get-selected-text'),
  writeClipboard:  (text) => ipcRenderer.send('write-clipboard', text),
  onClipboardChange: (callback) => {
    ipcRenderer.on('clipboard-changed', (event, text) => callback(text))
  },

  // ── WAKE ──
  onTriggerSelection: (callback) => {
    ipcRenderer.on('trigger-selection', () => callback())
  },

  // ── WEB SEARCH ──
  webSearch: (query) => ipcRenderer.invoke('web-search', query),

  // ── TASKS ──
  parseTask:   (description) => ipcRenderer.invoke('parse-task', description),
  executeTask: (task)        => ipcRenderer.invoke('execute-task', task),

  // ── GMAIL ──
  gmailStatus:     () => ipcRenderer.invoke('gmail-status'),
  gmailConnect:    () => ipcRenderer.invoke('gmail-connect'),
  gmailDisconnect: () => ipcRenderer.invoke('gmail-disconnect'),

  // ── VOICE ──
  speak: (text) => ipcRenderer.invoke('speak', text),
  stopSpeaking: () => ipcRenderer.send('stop-speaking'),

  // Receive config from main on launch
  onAiboConfig: (callback) => {
    ipcRenderer.on('aibo-config', (event, config) => callback(config))
  },

  // Request config directly (backup if IPC event missed)
  getConfig: () => ipcRenderer.invoke('get-config'),

  // ── SITUATIONAL AWARENESS ──
  getContext:       () => ipcRenderer.invoke('get-context'),
  onContextUpdate:  (cb) => ipcRenderer.on('context-update',  (e, data) => cb(data)),
  onContextAlert:   (cb) => ipcRenderer.on('context-alert',   (e, data) => cb(data)),

  // ── KNOWLEDGE BANK ──
  learnUrl:        (url)   => ipcRenderer.invoke('learn-url', url),
  learnTopic:      (topic) => ipcRenderer.invoke('learn-topic', topic),
  addFeed:         (url, topic, category) => ipcRenderer.invoke('add-feed', { url, topic, category }),
  getFeeds:        () => ipcRenderer.invoke('get-feeds'),
  removeFeed:      (url) => ipcRenderer.invoke('remove-feed', url),
  refreshFeeds:    () => ipcRenderer.invoke('refresh-feeds'),
  searchKnowledge: (query) => ipcRenderer.invoke('search-knowledge', query),
  knowledgeStats:  () => ipcRenderer.invoke('knowledge-stats'),
  startCrawler:    () => ipcRenderer.invoke('start-crawler'),
  stopCrawler:     () => ipcRenderer.invoke('stop-crawler'),
  autoSubscribe:   () => ipcRenderer.invoke('auto-subscribe'),
  onKnowledgeUpdate: (callback) => ipcRenderer.on('knowledge-update', (e, data) => callback(data)),

  // ── MEMORY ──
  getMemory:    () => ipcRenderer.invoke('get-memory'),
  updateMemory: (updates) => ipcRenderer.send('update-memory', updates),

})