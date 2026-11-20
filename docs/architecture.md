# Architecture — Kingdom Battleground

Vue d'ensemble du projet pour s'y retrouver. Les détails sont dans les autres fichiers de `docs/`.

## Lancer en local
```
npm install
node --watch server.js        # http://localhost:3000 (redémarre tout seul quand un fichier serveur change)
npm test                      # tests automatiques (node:test)
```
Les parties sont gardées en mémoire : un redémarrage du serveur les efface (les joueurs reviennent au menu).
Mot de passe admin local : `config.local.json` → `{ "adminPassword": "…" }` (fichier non versionné) ou variable `ADMIN_PASSWORD`.

## Les grandes briques

| Dossier | Rôle |
|---|---|
| `server.js`, `server/` | Serveur local Express + WebSocket (`createServer.js`), stockage mémoire, routes HTTP : admin (`admin.js`), cartes (`mapRoutes.js`, `editorRoutes.js`), équilibrage (`balanceRoutes.js`). |
| `lambda/` | Même jeu en production sur AWS (API Gateway WebSocket + DynamoDB). Adaptateur fin : toute la logique est partagée avec le serveur local. |
| `game/protocol.js` | **Le cœur réseau**, commun local/AWS : reçoit les actions des joueurs, les valide (`validate.js`), applique les règles, renvoie à chacun **sa** vue (brouillard : `views.js`), gère reconnexions, absents, minuteurs. |
| `game/GameRoom.js` | État d'une partie et règles de combat/déplacement. |
| `game/turns/` | Déroulé des tours : `sequential.js` (classique, initiative) et `simultaneous.js` (planification secrète puis résolution en ticks, `game/rules/resolve.js`). |
| `game/rules/`, `public/js/rules.js` | Règles partagées serveur/client (coûts de déplacement, pentes, falaises, nuit, vision, capacités). |
| `game/bots/` | IA (adversaire solo, 3 niveaux) et partie tutoriel. |
| `game/replay.js` | Enregistrement des replays (format `kb-replay-1`). |
| `game/maps.js`, `data/maps/` | Cartes (un fichier JSON par carte, format décrit en tête de `maps.js`). |
| `data/balance/`, `game/data/` | Statistiques (unités, généraux, terrains, segments, postures) en JSON, modifiables depuis l'admin ; `game/data/*.js` ne font que les charger. |
| `simulation/` | Simulateur IA contre IA pour l'équilibrage (aussi lançable depuis l'admin). |
| `tests/` | Tests automatiques (`npm test`). |

## Côté navigateur (`public/`)

| Page / script | Rôle |
|---|---|
| `index.html` + `js/lobby.js` | Menu, salons, invitations (`/?join=CODE`), spectateurs, choix carte/mode/réglages, armée, solo, tutoriel. |
| `game.html` + `js/game.js` | Partie (vue 2D sur canvas) ; `js/net.js` = connexion WebSocket/reconnexion ; `js/simultaneous.js` = interface du mode simultané ; `js/tutorial.js` = guide du tutoriel. |
| `js/map3d/` | **Vue 3D** (bouton « 3D » en partie) : `world.js` construit le monde (terrain, eau, ciel, végétation…), `gameView.js` le relie à la partie via `window.gameBridge` (bloc en fin de `game.js`), `units3d.js` les soldats, `buildings.js` les villages, `overlays.js` brouillard et surbrillances, `gameUI.js` réglages/mode photo/caméra clavier. |
| `js/audio/` | Son entièrement synthétisé (musique, ambiances, effets) ; `gameAudio.js` le branche sur les événements de la partie. |
| `map3d.html` | Visionneuse 3D de carte (sans partie). `units-demo.html`, `audio-demo.html` : bancs d'essai. |
| `replay.html`, `replay3d.html` | Replays 2D et 3D. |
| `admin/` | Administration : éditeur de cartes, éditeur d'équilibrage + simulations. |

## Circulation d'une action
1. Le joueur clique (2D ou 3D) → `game.js` envoie une action (`KBNet.send('move_unit', …)`).
2. `game/protocol.js` valide, applique la règle (`GameRoom`), enregistre le replay.
3. Le serveur renvoie à chaque joueur sa propre vue (`game_state`, événements comme `combat_result`) filtrée par le brouillard.
4. `game.js` met à jour l'interface ; la vue 3D et le son reçoivent les mêmes événements (`window.view3d.onEvent`, `window.gameEventHooks`).

## Mise en production (AWS)
Pas encore refaite avec la nouvelle version : le client et la lambda doivent être déployés ensemble (les anciennes parties ne sont pas compatibles), et le site statique n'a pas les routes `/api/*` (cartes, équilibrage, admin) — à prévoir avant de fusionner sur `main`.
