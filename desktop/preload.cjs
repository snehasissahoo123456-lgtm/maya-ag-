const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mayaSetup", Object.freeze({
  saveConfig: (config) => ipcRenderer.invoke("maya:save-config", config)
}));
