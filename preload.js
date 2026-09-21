const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('get-saved-data'),
  saveData: (data) => ipcRenderer.invoke('save-all-data', data),
  fetchIcsRules: (year, forceOnline = false) => ipcRenderer.invoke('fetch-ics-rules', { year, forceOnline })
});