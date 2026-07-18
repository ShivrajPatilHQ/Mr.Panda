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
  ask: (message, attachments) => ipcRenderer.invoke('ask', { message, attachments }),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (patch) => ipcRenderer.invoke('save-config', patch),
  listModels: () => ipcRenderer.invoke('list-models'),
  resetChat: () => ipcRenderer.send('reset-chat')
});
