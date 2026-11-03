// The page's way to the app's own files for 在線更新 (game/src/ui/update.ts): only inside <userData>/rich4-update.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rich4Desktop', {
  update: {
    read: name => ipcRenderer.invoke('update:read', name),
    write: (name, data) => ipcRenderer.invoke('update:write', name, data),
    remove: name => ipcRenderer.invoke('update:remove', name),
    rename: (from, to) => ipcRenderer.invoke('update:rename', from, to),
    list: () => ipcRenderer.invoke('update:list'),
  },
});
