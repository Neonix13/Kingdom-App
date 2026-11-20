// API calls, in-page modals (no native dialogs) and toasts
import { h } from './dom.js';

export async function api(method, url, body, opts = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    if (opts.raw) { init.body = body; init.headers['Content-Type'] = opts.contentType || 'application/octet-stream'; }
    else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(url, init);
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.details = data && data.details;
    throw err;
  }
  return data;
}

let toastWrap;
export function toast(msg, kind = 'info', { action, timeout = 3500 } = {}) {
  if (!toastWrap) { toastWrap = h('div', { class: 'toasts' }); document.body.append(toastWrap); }
  const el = h('div', { class: 'toast ' + kind }, h('span', null, msg));
  if (action) el.append(h('button', { type: 'button', onclick: () => { action.fn(); el.remove(); } }, action.label));
  el.append(h('button', { type: 'button', class: 'x', onclick: () => el.remove() }, '×'));
  toastWrap.append(el);
  if (timeout) setTimeout(() => el.remove(), action ? timeout * 3 : timeout);
  return el;
}

// Generic modal: returns a promise resolved with the clicked button value (or null when closed)
export function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], onOpen, wide }) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const p = buttons.find((b) => b.primary);
        if (p) { e.preventDefault(); e.stopPropagation(); finish(p); }
      }
    };
    const finish = async (b) => {
      if (b.validate) {
        const ok = await b.validate();
        if (!ok) return;
      }
      close(b.value);
    };
    const box = h('div', { class: 'modal' + (wide ? ' wide' : '') },
      h('h3', null, title),
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-actions' }, buttons.map((b) => h('button', { type: 'button', class: (b.primary ? 'primary ' : '') + (b.danger ? 'danger' : ''), onclick: () => finish(b) }, b.label))));
    const overlay = h('div', { class: 'modal-overlay', onmousedown: (e) => { if (e.target === overlay) close(null); } }, box);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    const first = box.querySelector('input,select,textarea');
    if (first) setTimeout(() => first.focus(), 0);
    if (onOpen) onOpen(box, close);
  });
}

export function confirmModal(title, text, { okLabel = 'Confirmer', danger = false } = {}) {
  return modal({ title, body: h('p', null, text), buttons: [{ label: 'Annuler', value: false }, { label: okLabel, value: true, primary: true, danger }] });
}

export async function loginModal(reason) {
  const pwd = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Mot de passe administrateur' });
  const err = h('p', { class: 'err' });
  const ok = await modal({
    title: 'Connexion administrateur',
    body: [reason ? h('p', null, reason) : null, pwd, err],
    buttons: [{ label: 'Annuler', value: false }, {
      label: 'Se connecter', value: true, primary: true,
      validate: async () => {
        try { await api('POST', '/api/admin/login', { password: pwd.value }); return true; } catch (e) { err.textContent = e.message; return false; }
      },
    }],
  });
  return !!ok;
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const i = h('input', { type: 'file', accept, style: { display: 'none' } });
    i.addEventListener('change', () => { resolve(i.files[0] || null); i.remove(); });
    document.body.append(i);
    i.click();
  });
}
