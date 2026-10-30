// Jam: ouvir junto com outros usuários do Roxy. Os comandos viajam como mensagens privadas do
// Soulseek (via slskd), com um prefixo próprio; só essas mensagens são lidas e marcadas como lidas.
// O anfitrião manda o estado (faixa, posição, tocando) e cada convidado baixa o mesmo arquivo e se ajusta.
const JAM_PREFIX = 'ROXYJAM1 ';
const JAM_POLL_MS = 2000;
const JAM_MAX_LATENCY = 10000; // relógios diferentes não podem empurrar a posição mais que isso
const JAM_DRIFT_MS = 2000;     // diferença tolerada antes de reposicionar o convidado
const JAM_INVITE_TTL = 10 * 60 * 1000; // convite mais velho que isso (ex.: entregue ao abrir o app) é ignorado
// Quem abrir a conversa num cliente comum do Soulseek lê isto em vez de só ver os dados técnicos.
const JAM_INVITE_TEXT = '[Roxy] Convite para ouvir junto (jam). Abra o Roxy para entrar. ';

// Posição em que o convidado deveria estar agora, dado o estado enviado pelo anfitrião.
function jamTarget(s, now = Date.now()) {
  if (!s.playing) return s.pos;
  return s.pos + Math.min(JAM_MAX_LATENCY, Math.max(0, now - s.at));
}

function jamParse(text) {
  const i = typeof text === 'string' ? text.indexOf(JAM_PREFIX) : -1; // o convite vem depois de um texto legível
  if (i < 0) return null;
  try {
    const m = JSON.parse(text.slice(i + JAM_PREFIX.length));
    return m && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}

class Jam {
  constructor(on) {
    this.on = on;            // (evento, ...args) => void
    this.role = null;        // 'host' | 'guest' | null
    this.id = null;          // identificador da sessão
    this.host = null;        // no convidado: usuário do anfitrião
    this.guests = new Map(); // no anfitrião: usuário -> 'invited' | 'joined'
    this.seen = new Map();   // conversa -> quantidade não lida já vista sem nada da jam
    setInterval(() => this.poll().catch(() => {}), JAM_POLL_MS);
  }

  async _req(method, path, body) {
    const r = await window.api.slskRequest({ method, path, body });
    if (r.status === 0) throw new Error(r.error || 'Falha ao falar com o slskd.');
    return r;
  }

  async send(user, msg) {
    const text = (msg.t === 'invite' ? JAM_INVITE_TEXT : '') + JAM_PREFIX + JSON.stringify(msg);
    const r = await this._req('POST', '/conversations/' + encodeURIComponent(user), text);
    if (!r.ok) throw new Error('Não consegui mandar a mensagem para ' + user + ' (erro ' + r.status + ').');
  }

  // ---- anfitrião ----
  async invite(user) {
    user = String(user || '').trim();
    if (!user) throw new Error('Digite o usuário do Soulseek.');
    if (this.role === 'guest') throw new Error('Saia da jam atual antes de criar a sua.');
    if (!this.role) { this.role = 'host'; this.id = Math.random().toString(36).slice(2, 10); }
    await this.send(user, { t: 'invite', id: this.id, at: Date.now() });
    this.guests.set(user, 'invited');
    this.on('changed');
  }

  broadcast(state) {
    if (this.role !== 'host') return;
    for (const [user, st] of this.guests) {
      if (st === 'joined') this.send(user, { t: 'state', id: this.id, ...state }).catch(() => {});
    }
  }

  // ---- convidado ----
  async accept(host, id) {
    if (this.role) await this.leave();
    this.role = 'guest';
    this.host = host;
    this.id = id;
    await this.send(host, { t: 'join', id });
    this.on('changed');
  }

  decline(host, id) {
    this.send(host, { t: 'decline', id }).catch(() => {});
  }

  async leave() {
    const { role, host, id, guests } = this;
    this.role = null; this.host = null; this.id = null; this.guests = new Map();
    this.on('changed');
    if (role === 'guest') await this.send(host, { t: 'leave', id }).catch(() => {});
    if (role === 'host') for (const user of guests.keys()) this.send(user, { t: 'end', id }).catch(() => {});
  }

  // ---- mensagens recebidas ----
  async poll() {
    const r = await this._req('GET', '/conversations');
    if (!r.ok || !Array.isArray(r.data)) return;
    for (const c of r.data) {
      if (!c.hasUnAcknowledgedMessages) { this.seen.delete(c.username); continue; }
      if (this.seen.get(c.username) === c.unAcknowledgedMessageCount) continue; // só mensagens comuns, já vistas
      const u = encodeURIComponent(c.username);
      const m = await this._req('GET', '/conversations/' + u + '/messages?unAcknowledgedOnly=true');
      let left = 0;
      for (const msg of Array.isArray(m.data) ? m.data : []) {
        if (msg.direction !== 'In' || msg.isAcknowledged) continue;
        const cmd = jamParse(msg.message);
        if (!cmd) { left++; continue; } // conversa normal: não mexe
        this._req('PUT', '/conversations/' + u + '/' + msg.id).catch(() => {});
        this.handle(c.username, cmd);
      }
      this.seen.set(c.username, left);
    }
  }

  handle(user, m) {
    if (m.t === 'invite') {
      if (m.at && Date.now() - m.at > JAM_INVITE_TTL) return; // convite antigo: já foi marcado como lido, só não aparece
      return this.on('invite', user, m.id);
    }
    if (this.role === 'host' && m.id === this.id && this.guests.has(user)) {
      if (m.t === 'join') { this.guests.set(user, 'joined'); this.on('changed'); this.on('joined', user); }
      if (m.t === 'leave' || m.t === 'decline') { this.guests.delete(user); this.on('changed'); this.on('left', user, m.t); }
      return;
    }
    if (this.role === 'guest' && user === this.host && m.id === this.id) {
      if (m.t === 'state') this.on('state', m);
      if (m.t === 'end') { this.role = null; this.host = null; this.id = null; this.on('changed'); this.on('ended', user); }
    }
  }
}

window.Jam = Jam;
window.jamTarget = jamTarget;
window.jamParse = jamParse;
