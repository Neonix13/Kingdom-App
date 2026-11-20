# Audio — Kingdom Battleground

Couche sonore 100 % synthétisée (Web Audio API), sans fichier audio ni requête réseau. Modules ES dans `public/js/audio/`, démo et analyse dans `public/audio-demo.html` (http://localhost:3000/audio-demo.html).

## Mise en route

```js
import { createAudio } from './js/audio/index.js';

const audio = createAudio();            // pré-rendu des sons lancé en tâche de fond
addEventListener('pointerdown', () => audio.unlock(), { once: true });  // 1er geste utilisateur
```

- `createAudio({ masterVolume, musicVolume, sfxVolume, ambienceVolume, cameraHeightRange })` : volumes 0..1 (défauts 0.8 / 0.6 / 0.8 / 0.6). Les réglages sauvegardés dans `localStorage['kb_audio']` **priment** sur ces arguments (qui ne servent que de valeurs par défaut).
- `audio.unlock()` crée/reprend l'`AudioContext` (renvoie une promesse). Avant `unlock()`, tous les appels sont des no-op silencieux : `setMusic` / `setAmbience` / `setIntensity` sont mémorisés et appliqués au déverrouillage, `play` est ignoré.
- `audio.setVolumes({ masterVolume, musicVolume, sfxVolume, ambienceVolume })`, `audio.mute(true|false)`, `audio.settings` : persistés automatiquement.
- `audio.ready()` : promesse résolue quand tous les sons sont pré-rendus (~1,5 s, ~26 Mo).
- `audio.dispose()` : coupe tout et ferme le contexte.

## Effets (SFX)

```js
audio.play('attack_clash', { pan: -0.4, distance: 0.3, volume: 1 });
```

- `pan` : -1 (gauche) .. 1 (droite) ; `distance` : 0 (proche) .. 1 (lointain) → atténuation + passe-bas + plus de réverbération ; `volume` : multiplicateur.
- Sons : `ui_click`, `ui_hover` (très doux, limité à 1 / 60 ms), `select_unit`, `deploy_place`, `hit_impact`, `unit_death`, `unit_rout`, `attack_clash`, `arrow_volley`, `general_duel`, `horn_turn_start`, `drum_roll_initiative`, `gong`, `victory_fanfare`, `defeat`, `ping`, `notification`.
- Chaque son a 1 à 4 variantes et un léger désaccord aléatoire (anti-répétition). Polyphonie limitée par son et globalement (la plus ancienne voix est coupée en fondu).

### Boucles de déplacement

```js
const id = audio.startLoop('move_march', { pan, distance });   // ou 'move_gallop', 'chariot_rumble'
audio.updateLoop(id, { pan, distance, volume, rate });          // pendant le déplacement
audio.stopLoop(id);                                              // fondu de 0,6 s (paramètre optionnel)
```

## Musique générative

```js
audio.setMusic('menu' | 'deploy' | 'calm' | 'battle' | 'victory' | 'defeat' | 'off');
audio.setIntensity(0..1);   // en 'battle' : densité des taiko, tempo (84 → 110 bpm), ostinato pipa
```

Fondus enchaînés entre états (2 à 4 s). `victory` et `defeat` commencent par un court motif puis continuent calmement. Instruments : guzheng / pipa / guqin (Karplus-Strong), harmoniques de guqin, dizi (souffle + vibrato), taiko. Gammes pentatoniques (modes gong, zhi, yu, jue). `setIntensity` peut être appelé souvent : la valeur est lissée mesure par mesure.

Suggestion de branchement : `deploy` en phase de déploiement, `battle` pendant la bataille avec `setIntensity` ∝ nombre d'unités au contact, `victory`/`defeat` à la fin (en plus de `victory_fanfare`/`defeat` en SFX si souhaité).

## Ambiances

```js
audio.setAmbience({
  timeOfDay: 0..24,          // oiseaux le jour (chœur à l'aube), grillons + hibou la nuit
  nearWater: 0..1,           // rivière
  nearForest: 0..1,          // bruissement des feuilles, oiseaux, hibou
  nearVillage: 0..1,         // murmures, marteau lointain, poules (rares)
  cameraHeight,              // unités monde (plage par défaut 3..150 = distance d'orbite de world.js)
  waterPan, forestPan, villagePan,   // -1..1, optionnel : direction de la source
  enabled: true | false,
});
```

- Peut être appelé à chaque frame : les valeurs sont stockées, puis appliquées en douceur (~1 s) par un minuteur interne de 100 ms.
- L'ambiance démarre au premier appel de `setAmbience` (sauf `enabled: false`).
- Caméra haute → plus de vent, sons du sol atténués et filtrés.

## Rendu hors-ligne / tests

`renderOffline(seconds, setup, { volumes, seed, timeline })` (export de `index.js`) rend la même chaîne (bus, réverbération, limiteur) dans un `OfflineAudioContext` et renvoie un `AudioBuffer`. `analyze.js` fournit `metrics(buffer)` (crête, RMS, DC, écrêtage, centroïde, planéité, ratio harmonique, raccord de boucle). Bouton « Lancer l'analyse » sur la page de démo, ou `await kbAnalyse()` dans la console.

## Export MIDI

`npm run export-midi` (options : `-- --out DOSSIER --bars 32 --seed 1234 --minutes 20`) écrit dans `~/Downloads/Kingdom-MIDI/` un fichier MIDI par état de la musique générative (menu, calme, déploiement, bataille à intensité 0,2 / 0,5 / 0,9, bataille en montée 0 → 1, victoire, défaite), avec `--minutes N` une prise longue par état dans `~/Downloads/Kingdom-MIDI-Nmin/` (plus une bataille à intensité variable par paliers de 16 mesures ; victoire et défaite restent des motifs courts), avec les mêmes tirages que le jeu pour une graine donnée. Une piste par instrument (programmes General MIDI : koto pour le guzheng, shamisen pour le pipa, guitare nylon pour le guqin, harpe pour ses harmoniques, shakuhachi pour le dizi ; percussions sur le canal 10 : 35 taiko grave, 47 taiko médium, 50 tambour aigu, 76 bloc de bois), carte de tempo incluse (la bataille accélère avec l'intensité). Les glissés courts du guzheng deviennent une appogiature, les petits glissés des pitch bends (amplitude ±2 demi-tons).

## Musique rendue dans un DAW (phrases aléatoires)

1. `npm run music-phrases` (options `-- --phrases 24 --seed 1234 --states battle,menu`) écrit dans `~/Downloads/Kingdom-Phrases/` un MIDI par état (menu, calme, deploiement, bataille, victoire, defaite), `layout.json` et `LISEZMOI.md` (marche à suivre dans Ableton). Chaque phrase de 8 mesures est indépendante, à tempo fixe, dans un emplacement « 1 mesure d'amorce + 8 mesures + 2 mesures de queue ». La bataille est en 4 familles (`melodie`, `pipa`, `leger`, `lourd`) ; victoire et défaite ont en plus une intro (le motif d'ouverture).
2. Rendu dans le DAW, un dossier par état (`Rendus/bataille/…`).
3. `npm run music-import -- --dir "/chemin/vers/Rendus"` découpe les rendus, règle le volume par état (-20 dB RMS), encode en AAC (ffmpeg requis) dans `public/audio/music/<état>/` et écrit `public/audio/music/manifest.json`.

En jeu (`stemMusic.js`), un état présent dans le manifeste remplace la musique synthétisée : une phrase tirée au hasard (sans répéter les dernières) démarre sur la grille des mesures pendant que la queue de la précédente s'éteint ; la suivante est chargée pendant la lecture. En bataille, l'intensité règle le volume de chaque famille (`layerGains` dans `stemLayout.js`). Les états absents gardent la musique synthétisée. `gain` dans le manifeste ajuste le volume d'un état. Ce bus n'a pas de réverbération ajoutée.

## Architecture

| Fichier | Rôle |
|---|---|
| `index.js` | API publique `createAudio`, réglages, minuteur, `renderOffline` |
| `engine.js` | bus musique / SFX / ambiance, réverbération à convolution, compresseur + saturation douce (plafond ≈ -1,3 dBFS), voix, boucles |
| `bank.js` | pré-rendu des recettes via `OfflineAudioContext` (hors thread principal), normalisation, raccord des boucles |
| `recipes.js`, `kit.js` | recettes de synthèse (bruit filtré, modal, Karplus-Strong, cuivres, tambours…) |
| `music.js` | séquenceur génératif par mesure |
| `stemMusic.js`, `stemLayout.js` | lecture de la musique rendue (phrases aléatoires, familles par intensité) |
| `ambience.js` | lits sonores en boucle + événements poissoniens |
| `dsp.js`, `analyze.js` | utilitaires DSP et mesures |
