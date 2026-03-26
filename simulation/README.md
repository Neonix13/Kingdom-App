# Simulation d'Équilibrage — Kingdom Battleground

Simulateur headless qui fait jouer l'IA contre elle-même pour analyser l'équilibrage des généraux et des unités.

## Prérequis

```bash
npm install   # depuis la racine du projet
```

## Lancer une simulation complète

```bash
# Simulation standard (11x11 généraux, 50 parties par matchup = 6 050 parties)
node simulation/run.js --games 50 --budget 5000 --threads 4

# Budget 10k
node simulation/run.js --games 50 --budget 10000 --threads 4

# Sans système d'initiative (départ aléatoire, alternance stricte)
node simulation/run.js --games 50 --budget 5000 --threads 4 --no-initiative
```

### Options

| Option | Défaut | Description |
|--------|--------|-------------|
| `--games N` | 10 | Nombre de parties par matchup (121 matchups au total) |
| `--budget N` | 2500 | Budget d'or pour la composition d'armée |
| `--threads N` | 4 | Nombre de threads (worker_threads) |
| `--output DIR` | `simulation/results/` | Dossier de sortie pour le rapport JSON |
| `--no-initiative` | désactivé | Désactive l'initiative (d20+stratégie), utilise départ aléatoire + alternance |

Le rapport JSON est sauvegardé dans le dossier de sortie avec un timestamp.

## Enregistrer un matchup spécifique

```bash
node simulation/record.js --g1 ren_pa --g2 go_hou_mei --budget 5000
```

### Options

| Option | Défaut | Description |
|--------|--------|-------------|
| `--g1 ID` | ou_ki | Général du joueur 1 |
| `--g2 ID` | mou_bu | Général du joueur 2 |
| `--budget N` | 5000 | Budget d'or |
| `--output DIR` | `simulation/results/` | Dossier de sortie |

### IDs des généraux

| ID | Nom | Royaume |
|----|-----|---------|
| ou_ki | Ou Ki | QIN |
| mou_bu | Mou Bu | QIN |
| ou_sen | Ou Sen | QIN |
| kan_ki | Kan Ki | QIN |
| ri_boku | Ri Boku | ZHAO |
| kei_sha | Kei Sha | ZHAO |
| shi_ba_shou | Shi Ba Shou | ZHAO |
| ren_pa | Ren Pa | ZHAO/WEI |
| go_kei | Go Kei | WEI |
| go_hou_mei | Go Hou Mei | WEI |
| gai_mou | Gai Mou | WEI |

Le fichier replay JSON est sauvegardé et le chemin affiché dans la console.

## Visualiser un replay

1. Démarrer le serveur : `node server.js`
2. Ouvrir `http://localhost:3000/replay.html`
3. **Glisser-déposer** le fichier JSON replay, ou cliquer "Choose File"
4. Ou utiliser l'URL directe affichée par `record.js` : `http://localhost:3000/replay.html?file=/simulation/results/replay_xxx.json`

### Contrôles du viewer

| Touche / Bouton | Action |
|-----------------|--------|
| `Espace` | Play / Pause |
| `←` ou `h` | Tour précédent |
| `→` ou `l` | Tour suivant |
| `Home` | Début |
| `End` | Fin |
| Molette | Zoom |
| Clic + glisser | Déplacer la caméra |
| Sélecteur de vitesse | 0.5x, 1x, 2x, 5x, 20x |

Le panneau latéral affiche les actions du tour en cours et l'état de toutes les unités (PV, moral).