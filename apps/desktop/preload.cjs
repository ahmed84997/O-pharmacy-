// The only bridge from the screens to the desktop shell. The shell checks which page asks: the Hub's pages get oDesktop, the setup page gets oSetup.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('oDesktop', {
  checkUpdate: () => ipcRenderer.invoke('o:check-update'),
  /** start the print agent with this device's key (D39) */
  agent: (deviceKey) => ipcRenderer.invoke('o:agent', deviceKey),
  /** this PC's Windows printers and the receipt/label printer chosen for it */
  localPrinters: () => ipcRenderer.invoke('o:local-printers'),
  setLocalPrinters: (v) => ipcRenderer.invoke('o:set-local-printers', v),
});
contextBridge.exposeInMainWorld('oSetup', {
  info: () => ipcRenderer.invoke('o:setup-info'),
  scan: () => ipcRenderer.invoke('o:setup-scan'),
  probe: (address) => ipcRenderer.invoke('o:setup-probe', address),
  choose: (c) => ipcRenderer.invoke('o:setup-choose', c),
});
