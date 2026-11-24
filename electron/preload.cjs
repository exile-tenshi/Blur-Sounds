const { contextBridge, ipcRenderer } = require('electron');
const on = (ch) => (cb) => { const f = (_e, d) => cb(d); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };
contextBridge.exposeInMainWorld('bsp', {
  invoke: (ch, ...a) => ipcRenderer.invoke(ch, ...a),
  onMixer: (cb) => { const off = on('mixer:state')(cb); ipcRenderer.invoke('mixer:get'); return off; }, onLevels: on('mixer:levels'), onMedia: on('media:state'), onHelper: on('helper:status'),
  onChatbox: on('chatbox:state'), onSoundTrigger: on('sound:trigger'), onSoundStop: on('sound:stopAll'), onHotkeyErrors: on('sound:hotkeyErrors'), onEngine: on('engine:state'), onClipSaved: on('clip:saved'), onRecSaved: on('rec:saved'), onShare: on('share:progress'), onListen: on('listen:switched'), onListenMissing: on('listen:missing'), onHifi: on('hifi:state'),
  fileUrl: (p) => 'file:///' + encodeURI(String(p).replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F'),
});
