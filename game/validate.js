class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProtocolError(code, message);
}

function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function name(v) {
  const s = cleanText(v, 20);
  if (!s) fail('invalid_name', 'Nom invalide (1 à 20 caractères).');
  return s;
}

function roomCode(v) {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{4,8}$/.test(s)) fail('invalid_room_code', 'Code de salle invalide.');
  return s;
}

function int(v, min, max, code = 'invalid_value', message = 'Valeur invalide.') {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) fail(code, message);
  return n;
}

function id(v, code = 'invalid_id', message = 'Identifiant invalide.') {
  if (typeof v !== 'string' || !/^[\w-]{1,64}$/.test(v)) fail(code, message);
  return v;
}

function color(v) {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) fail('invalid_color', 'Couleur invalide.');
  return v.toLowerCase();
}

function oneOf(v, allowed, code = 'invalid_value', message = 'Valeur invalide.') {
  if (!allowed.includes(v)) fail(code, message);
  return v;
}

// Route chosen by the player: [[q, r], ...] (origin excluded), at most 60 steps
function path(v, max = 60) {
  if (!Array.isArray(v) || v.length < 1 || v.length > max) fail('invalid_path', 'Chemin invalide.');
  return v.map((step) => {
    if (!Array.isArray(step) || step.length !== 2) fail('invalid_path', 'Chemin invalide.');
    return [int(step[0], -10000, 10000, 'invalid_path', 'Chemin invalide.'), int(step[1], -10000, 10000, 'invalid_path', 'Chemin invalide.')];
  });
}

module.exports = { ProtocolError, fail, cleanText, name, roomCode, int, id, color, oneOf, path };
