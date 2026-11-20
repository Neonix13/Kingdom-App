// Tiny DOM helpers
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function seg(options, value, onChange, cls = '') {
  const wrap = h('div', { class: 'segctl ' + cls });
  for (const o of options) {
    const b = h('button', { type: 'button', class: o.id === value ? 'on' : '', title: o.title || '' }, o.swatch ? h('i', { style: { background: o.swatch } }) : null, o.name);
    b.addEventListener('click', () => {
      for (const x of wrap.children) x.classList.remove('on');
      b.classList.add('on');
      onChange(o.id);
    });
    wrap.append(b);
  }
  return wrap;
}

export function field(label, input, hint) {
  return h('label', { class: 'fld' }, h('span', null, label), input, hint ? h('small', null, hint) : null);
}

export function num(value, { min, max, step = 1, onInput, onChange } = {}) {
  const el = h('input', { type: 'number', min, max, step });
  el.value = value;
  if (onInput) el.addEventListener('input', () => onInput(parseFloat(el.value)));
  if (onChange) el.addEventListener('change', () => onChange(parseFloat(el.value)));
  return el;
}

export function range(value, { min, max, step = 1, onInput } = {}) {
  const out = h('output', null, String(value));
  const el = h('input', { type: 'range', min, max, step });
  el.value = value;
  el.addEventListener('input', () => { out.textContent = el.value; onInput && onInput(parseFloat(el.value)); });
  return h('div', { class: 'rangewrap' }, el, out);
}

export function check(label, value, onChange) {
  const el = h('input', { type: 'checkbox' });
  el.checked = !!value;
  el.addEventListener('change', () => onChange(el.checked));
  return h('label', { class: 'chk' }, el, label);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
