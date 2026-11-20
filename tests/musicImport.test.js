const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const node = (args) => spawnSync(process.execPath, ['--no-warnings', ...args], { cwd: ROOT, encoding: 'utf8' });

function writeWav(file, sr, ch, bits, frames, fn) {
  const bps = bits / 8;
  const data = Buffer.alloc(frames * ch * bps);
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, fn(i / sr, c)));
    const o = (i * ch + c) * bps;
    if (bits === 32) data.writeFloatLE(v, o);
    else if (bits === 24) data.writeIntLE(Math.round(v * 8388607), o, 3);
    else data.writeInt16LE(Math.round(v * 32767), o);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(bits === 32 ? 3 : 1, 20); h.writeUInt16LE(ch, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * ch * bps, 28); h.writeUInt16LE(ch * bps, 32); h.writeUInt16LE(bits, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

// A fake DAW render: in every slot, a tone whose pitch encodes the slot index, silent before the phrase, decaying in the tail.
function fakeRender(file, st, sr, bits, baseHz) {
  const barSec = 240 / st.bpm;
  const frames = Math.round(st.totalBars * barSec * sr);
  const slots = st.slots.map((s) => ({ ...s, t0: s.phraseBar * barSec, t1: (s.phraseBar + s.bars) * barSec, hz: baseHz + 50 * s.index }));
  writeWav(file, sr, 2, bits, frames, (t) => {
    const s = slots.find((x) => t >= x.t0 && t < x.t1 + 2 * barSec);
    if (!s) return 0;
    const env = t < s.t1 ? 0.5 : 0.5 * Math.exp(-(t - s.t1) * 4);
    return env * Math.sin(2 * Math.PI * s.hz * (t - s.t0));
  });
}

function decode(file) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'], { maxBuffer: 1 << 28 });
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
}

test('music-phrases + music-import : découpe, nommage, niveau et manifeste', { skip: !hasFfmpeg && 'ffmpeg absent' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-music-test-'));
  const phr = path.join(tmp, 'phrases');
  let r = node(['scripts/music-phrases.mjs', '--out', phr, '--phrases', '3', '--states', 'battle,menu,victory']);
  assert.strictEqual(r.status, 0, r.stderr);
  const layout = JSON.parse(fs.readFileSync(path.join(phr, 'layout.json'), 'utf8'));
  for (const f of ['bataille.mid', 'menu.mid', 'victoire.mid', 'LISEZMOI.md']) assert.ok(fs.existsSync(path.join(phr, f)), f);
  assert.deepStrictEqual(layout.states.battle.tracks.filter((t) => !/^(melodie-|pipa$|leger-|lourd-)/.test(t)), []);

  const renders = path.join(tmp, 'Rendus');
  for (const d of ['bataille', 'menu', 'victoire']) fs.mkdirSync(path.join(renders, d), { recursive: true });
  const b = layout.states.battle;
  fakeRender(path.join(renders, 'bataille', 'bataille melodie-guzheng.wav'), b, 48000, 24, 400);
  fakeRender(path.join(renders, 'bataille', 'bataille melodie-dizi.wav'), b, 48000, 24, 400);
  fakeRender(path.join(renders, 'bataille', 'bataille pipa.wav'), b, 48000, 24, 700);
  fakeRender(path.join(renders, 'bataille', 'bataille leger-taiko-grave.wav'), b, 48000, 16, 1000);
  fakeRender(path.join(renders, 'bataille', 'bataille lourd.wav'), b, 48000, 32, 1300);
  fakeRender(path.join(renders, 'bataille', 'bataille lourd-taiko-medium.wav'), b, 48000, 32, 3000);
  fakeRender(path.join(renders, 'menu', 'menu Master.wav'), layout.states.menu, 44100, 16, 500);
  fakeRender(path.join(renders, 'victoire', 'Master.wav'), layout.states.victory, 48000, 32, 600);

  const target = path.join(tmp, 'music');
  r = node(['scripts/music-import.mjs', '--dir', renders, '--layout', path.join(phr, 'layout.json'), '--target', target]);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(manifest.states).sort(), ['battle', 'menu', 'victory']);
  const mb = manifest.states.battle;
  assert.strictEqual(mb.phrases, 3);
  assert.deepStrictEqual(mb.layers, ['melodie', 'pipa', 'leger', 'lourd']);
  assert.ok(manifest.states.victory.intro && manifest.states.victory.intro.bars >= 2);
  assert.ok(fs.existsSync(path.join(target, 'victoire', 'mix-intro.m4a')));
  assert.ok(/lourd ← bataille lourd\.wav\n/.test(r.stdout), 'le groupe « lourd » remplace ses pistes');

  const barSec = 240 / mb.bpm;
  for (const [layer, base] of [['pipa', 700], ['leger', 1000], ['lourd', 1300]]) {
    for (const i of [1, 3]) {
      const x = decode(path.join(target, 'bataille', `${layer}-0${i}.m4a`));
      const onset = x.findIndex((v) => Math.abs(v) > 0.05) / 48000;
      assert.ok(Math.abs(onset - mb.preRoll) < 0.015, `${layer}-0${i} : attaque à ${onset.toFixed(3)} s, attendu ${mb.preRoll}`);
      const from = Math.round((mb.preRoll + barSec) * 48000), n = 24000;
      let zc = 0;
      for (let k = from + 1; k < from + n; k++) if ((x[k - 1] < 0) !== (x[k] < 0)) zc++;
      const hz = zc / 2 / (n / 48000);
      assert.ok(Math.abs(hz - (base + 50 * i)) < 15, `${layer}-0${i} : ${hz.toFixed(0)} Hz, attendu ${base + 50 * i}`);
      const len = x.length / 48000;
      assert.ok(Math.abs(len - (mb.preRoll + (mb.phraseBars + mb.tailBars) * barSec)) < 0.06, `${layer}-0${i} : durée ${len.toFixed(2)} s`);
    }
  }
  const mel = decode(path.join(target, 'bataille', 'melodie-02.m4a'));
  const peak = mel.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  assert.ok(peak > 0.05 && peak <= 0.97, `crête ${peak}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});
