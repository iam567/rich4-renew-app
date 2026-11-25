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
  // 局域網房間 (lan-relay.cjs): start this computer's server; its port and the addresses phones open
  lan: {
    start: () => ipcRenderer.invoke('lan:start'),
    find: () => ipcRenderer.invoke('lan:find'),
  },
  // 存檔: the slots as files in the game folder's `save` (main.cjs)
  saves: {
    dir: () => ipcRenderer.invoke('saves:dir'),
    read: (slot, kind) => ipcRenderer.invoke('saves:read', slot, kind),
    write: (slot, text) => ipcRenderer.invoke('saves:write', slot, text),
  },
  // 全螢幕 / 視窗 and 結束遊戲 from the game's 系統 window (issue #72)
  window: {
    isFullScreen: () => ipcRenderer.invoke('win:isFullScreen'),
    setFullScreen: on => ipcRenderer.invoke('win:setFullScreen', !!on),
    quit: () => ipcRenderer.invoke('win:quit'),
  },
});
