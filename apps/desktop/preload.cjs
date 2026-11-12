// The only bridge from the screens to the desktop shell: ask for an update check (the shell shows its own dialogs).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('oDesktop', { checkUpdate: () => ipcRenderer.invoke('o:check-update') });
