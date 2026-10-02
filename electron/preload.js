// ============================================================
//  Sanfa Agent — electron/preload.js
//  Bridge API between Electron and Web UI
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sanfaElectron', {
  isElectron: true,
  platform: process.platform,
  syncBridge: (config) => {
    ipcRenderer.send('sync-bridge', config);
  }
});
