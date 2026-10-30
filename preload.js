const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  spotifyList: () => ipcRenderer.invoke('spotify:list'),
  spotifyFetch: (req) => ipcRenderer.invoke('spotify:fetch', req),
  spotifyPublic: (link) => ipcRenderer.invoke('spotify:public', link),
  cachePrune: (keep) => ipcRenderer.invoke('cache:prune', keep),
  trackMeta: (track) => ipcRenderer.invoke('track:meta', track),
  artLookup: (query) => ipcRenderer.invoke('art:lookup', query),
  lyrics: (req) => ipcRenderer.invoke('lyrics:get', req),
  onSpotifyProgress: (cb) => ipcRenderer.on('spotify:progress', (_e, m) => cb(m)),
  authState: () => ipcRenderer.invoke('auth:state'),
  authLogin: (p) => ipcRenderer.invoke('auth:login', p),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  onLoginStatus: (cb) => ipcRenderer.on('login:status', (_e, m) => cb(m)),
  slskGetSettings: () => ipcRenderer.invoke('slsk:getSettings'),
  slskSaveSettings: (s) => ipcRenderer.invoke('slsk:saveSettings', s),
  slskRequest: (req) => ipcRenderer.invoke('slsk:request', req),
  slskFind: (track) => ipcRenderer.invoke('slsk:find', track),
  slskPickFolder: () => ipcRenderer.invoke('slsk:pickFolder'),
  bgGet: () => ipcRenderer.invoke('bg:get'),
  bgChoose: () => ipcRenderer.invoke('bg:choose')
});
