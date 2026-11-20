// Shared WebSocket client: session (sessionStorage, per tab), automatic rejoin, reconnection with backoff,
// heartbeat (tick), connection indicator. Used by lobby.js and game.js.
const KBNet = (() => {
  const SESSION_KEY = 'kb_session';
  const RECENT_KEY = 'kb_recent_sessions';
  const RECENT_MAX_AGE = 12 * 3600 * 1000;
  const TICK_MS = 15000;

  let ws = null;
  let status = 'idle';
  let onEvent = () => {};
  let onStatus = () => {};
  let queue = [];
  let retry = 0;
  let stopped = false;
  let rejoining = false;
  let tickTimer = null;
  let reconnectTimer = null;
  let indicator = null;

  function url() {
    return window.WS_URL || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  }

  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null; } catch (e) { return null; }
  }

  function recentSessions() {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
      return list.filter(s => s && s.token && Date.now() - (s.savedAt || 0) < RECENT_MAX_AGE);
    } catch (e) { return []; }
  }

  function setSession(s) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    const list = recentSessions().filter(x => !(x.roomCode === s.roomCode && x.playerId === s.playerId));
    list.unshift({ ...s, savedAt: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
  }

  function forget(roomCode, playerId) {
    const list = recentSessions().filter(x => !(x.roomCode === roomCode && (!playerId || x.playerId === playerId)));
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  }

  function clearSession() {
    const s = getSession();
    sessionStorage.removeItem(SESSION_KEY);
    if (s) forget(s.roomCode, s.playerId);
  }

  function setStatus(next) {
    if (status === next) return;
    const prev = status;
    status = next;
    renderIndicator();
    onStatus(next, prev);
  }

  function rawSend(obj) {
    const msg = JSON.stringify(obj);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg);
    else queue.push(msg);
  }

  function send(action, data = {}) {
    const s = getSession();
    const payload = { action, ...data };
    if (s && payload.roomCode == null) payload.roomCode = s.roomCode;
    rawSend(payload);
  }

  function rejoin() {
    const s = getSession();
    if (!s) return false;
    rejoining = true;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'rejoin_game', roomCode: s.roomCode, playerId: s.playerId, token: s.token }));
    return true;
  }

  function open() {
    clearTimeout(reconnectTimer);
    if (stopped) return;
    setStatus(retry === 0 && status === 'idle' ? 'connecting' : 'reconnecting');
    const sock = new WebSocket(url());
    ws = sock;
    sock.onopen = () => {
      retry = 0;
      setStatus('connected');
      const hadSession = rejoin();
      const pending = queue;
      queue = [];
      if (!hadSession) for (const m of pending) sock.send(m);
      else for (const m of pending) if (!/"action":"rejoin_game"/.test(m)) sock.send(m);
    };
    sock.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      const { event, ...data } = msg;
      if (event === 'session') {
        rejoining = false;
        setSession({ roomCode: data.roomCode, playerId: data.playerId, token: data.token, role: data.role, name: data.name });
      } else if (event === 'session_replaced') {
        stopped = true;
        setStatus('replaced');
      } else if (event === 'error' && (data.code === 'rejoin_failed' || (rejoining && data.code === 'room_not_found'))) {
        rejoining = false;
        clearSession();
        data.sessionLost = true;
      } else if (event === 'error' && data.code === 'room_not_found' && getSession() && data.action !== 'join_room') {
        clearSession();
        data.sessionLost = true;
      }
      onEvent(event, data);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (stopped) return;
      setStatus('reconnecting');
      const delay = Math.min(8000, 1000 * Math.pow(2, retry++));
      reconnectTimer = setTimeout(open, delay);
    };
    sock.onerror = () => { try { sock.close(); } catch (e) { /* closed */ } };
  }

  function connect(handlers = {}) {
    onEvent = handlers.onEvent || onEvent;
    onStatus = handlers.onStatus || onStatus;
    stopped = false;
    open();
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (getSession() && ws && ws.readyState === WebSocket.OPEN) send('tick');
    }, TICK_MS);
    window.addEventListener('online', () => { if (!ws && !stopped) { retry = 0; open(); } });
  }

  function disconnect() {
    stopped = true;
    clearInterval(tickTimer);
    if (ws) ws.close();
  }

  const LABELS = {
    idle: 'Hors ligne', connecting: 'Connexion…', connected: 'Connecté', reconnecting: 'Reconnexion…', replaced: 'Session ouverte ailleurs',
  };

  function renderIndicator() {
    if (!indicator) return;
    indicator.className = `net-status net-${status}`;
    indicator.querySelector('.net-label').textContent = LABELS[status] || status;
    indicator.title = LABELS[status] || status;
  }

  function mountIndicator(parent = document.body) {
    if (indicator) return indicator;
    indicator = document.createElement('div');
    indicator.id = 'net-status';
    indicator.innerHTML = '<span class="net-dot"></span><span class="net-label"></span>';
    parent.appendChild(indicator);
    renderIndicator();
    return indicator;
  }

  return {
    connect, disconnect, send, rejoin, getSession, setSession, clearSession, recentSessions, forget, mountIndicator,
    get status() { return status; },
  };
})();

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
