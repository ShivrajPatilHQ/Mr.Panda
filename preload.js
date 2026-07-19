// Safe bridge shared by the panda window and the chat window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panda', {
  // panda window
  showMenu: () => ipcRenderer.send('show-context-menu'),
  quit: () => ipcRenderer.send('quit-app'),
  interact: () => ipcRenderer.send('interact'),
  hideToTray: () => ipcRenderer.send('hide-to-tray'),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  toggleChat: () => ipcRenderer.send('toggle-chat'),
  // chat window
  closeChat: () => ipcRenderer.send('close-chat'),
  ask: (message, attachments, mode) => ipcRenderer.invoke('ask', { message, attachments, mode }),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  saveConfig: (patch) => ipcRenderer.invoke('save-config', patch),
  listModels: () => ipcRenderer.invoke('list-models'),
  resetChat: (mode) => ipcRenderer.send('reset-chat', mode),
  copyText: (text) => ipcRenderer.send('copy-text', text),
  pasteIntoBox: (text) => ipcRenderer.invoke('paste-into-box', text),
  humanize: (payload) => ipcRenderer.invoke('humanize', payload),
  openAccessibility: () => ipcRenderer.send('open-accessibility'),
  // saved investors
  saveFromReply: (text) => ipcRenderer.invoke('save-from-reply', text),
  listInvestors: () => ipcRenderer.invoke('list-investors'),
  removeInvestor: (id) => ipcRenderer.invoke('remove-investor', id),
  clearInvestors: () => ipcRenderer.invoke('clear-investors'),
  exportCsv: () => ipcRenderer.invoke('export-csv')
});
