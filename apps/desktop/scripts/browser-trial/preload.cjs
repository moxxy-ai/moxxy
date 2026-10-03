// The trial window's bridge to main: adopt and release views, follow tabs, answer focus requests.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trial', {
  register: (webContentsId, requestId) => ipcRenderer.invoke('trial.register', { webContentsId, requestId }),
  release: (tabId) => ipcRenderer.invoke('trial.release', { tabId }),
  select: (tabId) => ipcRenderer.invoke('trial.select', { tabId }),
  focused: (requestId) => ipcRenderer.send('trial.focused', { requestId }),
  on: (channel, listener) => ipcRenderer.on(channel, (_event, payload) => listener(payload)),
});
