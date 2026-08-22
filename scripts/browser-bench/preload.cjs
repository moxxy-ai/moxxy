const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bench', { ready: (id) => ipcRenderer.send('wv-ready', id) });
