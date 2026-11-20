# Audit backend — Kingdom Battleground

Périmètre : `server.js`, `lambda/handler.js`, `game/GameRoom.js`, `game/HexUtils.js`, clients `public/js/lobby.js` / `public/js/game.js` (partie réseau).
Format : problème → correction. Sévérité : **[C]** critique (crash, partie bloquée, triche), **[M]** majeur, **[m]** mineur.

## 1. Transport / dispatcher

| # | Problème | Correction |
|---|----------|------------|
| 1 | **[C]** Serveur local : aucune protection autour du dispatcher. Un message malformé (`submit_army` avec `units: null`, `place_unit` d'un non-joueur, `getDeploymentState` d'un inconnu…) lève une exception dans le handler `ws` → **crash du process Node** et perte de toutes les parties. | Dispatcher unique `game/protocol.js` : chaque action est enveloppée dans un `try/catch`, les erreurs renvoient `{event:'error', code:'server_error'}`. |
| 2 | **[M]** `server.js` et `lambda/handler.js` dupliquent tout le switch d'actions et ont divergé (lambda : pas de minuteur de défense, `turn_change` sans `manche`, pas de `set_player_color`/`select_general` cohérents, rejoin différent). | Un seul dispatcher partagé ; `server.js` et `lambda/handler.js` ne sont plus que des adaptateurs (envoi + stockage). |
| 3 | **[M]** Aucune validation des entrées : `budget`, `q/r`, `facing`, `stanceId`, `count`, noms, couleurs… acceptés tels quels. | Validation stricte par action (`game/validate.js`) ; entiers bornés, chaînes nettoyées, enums vérifiées. |
| 4 | **[M]** Le `roomCode` envoyé par le client sert à retrouver la salle sans vérifier que la connexion en est membre (ex. `chat_message`/`ping` vers n'importe quelle salle dont on connaît le code si on y a été membre, `defend_choice` sans aucun contrôle). | Chaque action (hors création/connexion) exige que la connexion soit liée à un membre de la salle. |
| 5 | **[C]** Lambda : lecture → modification → écriture DynamoDB sans contrôle de version. Deux messages simultanés (ex. deux joueurs qui valident leur armée en même temps) → une écriture écrase l'autre ; l'armée perdue empêche le passage au déploiement : **partie bloquée**. | Verrou optimiste : attribut `version`, `PutCommand` conditionnel, nouvel essai (jusqu'à 6) en cas de conflit. Local : file d'attente par salle. |
| 6 | **[M]** Lambda : `$disconnect` attend 600 ms (facturé) pour deviner si c'est un rafraîchissement. | Identité stable par jeton : la déconnexion marque juste le membre hors ligne si sa connexion courante est celle qui se ferme. |
| 7 | **[m]** Identifiants : `Math.random()` pour connexions, attaques (`atk_<Date.now()>_<random>`), codes de salle. | `crypto.randomBytes` / `crypto.randomInt`. |

## 2. Identité, reconnexion, nettoyage

| # | Problème | Correction |
|---|----------|------------|
| 8 | **[C]** L'identité d'un joueur = l'id de sa connexion WebSocket, **diffusée à tous** (`players[].id`, `chat.authorId`, `hostId`). `rejoin_game {oldPlayerId}` suffit pour **voler la place** de n'importe quel joueur. | Identité = `playerId` public + `token` secret (jamais diffusé). La reprise exige le jeton. |
| 9 | **[C]** Serveur local : 10 s après une déconnexion, le joueur est **supprimé de la salle même en pleine bataille** → impossible de revenir (« Joueur introuvable »), `turnOrder` pointe vers un joueur disparu : **partie bloquée** (TODO « Crash / déconnexion en cours de partie »). | Les joueurs ne sont jamais supprimés après le lobby. Délai de grâce, puis règles explicites (voir §5). |
| 10 | **[M]** Rejoin en phase `army_building` (local et lambda) ou `lobby` (local) : rien n'est renvoyé, le client reste sur un écran vide. | `session` + resynchronisation complète pour toutes les phases (lobby, armée, déploiement, bataille, fin). |
| 11 | **[M]** Salles jamais supprimées en local si un joueur reste « fantôme » ; aucune purge des parties terminées. | Purge locale des salles sans membre connecté (30 min) et des parties terminées (30 min). Lambda : TTL DynamoDB existant (3 j). |
| 12 | **[M]** Lambda : l'entrée `KingdomConnections` expire au bout d'1 h ; après, `$disconnect` ne retrouve plus la salle. | TTL rafraîchi à chaque battement de cœur (`tick`) ; un 410 à l'envoi est traité comme une déconnexion. |

## 3. Règles / courses (engine)

| # | Problème | Correction |
|---|----------|------------|
| 13 | **[C]** `defend_choice` n'est pas contrôlé : **n'importe quel joueur** (l'attaquant compris) peut répondre à la place du défenseur (choisir « rien » pour lui). | Seul le propriétaire de l'unité ciblée peut répondre. |
| 14 | **[M]** Plusieurs attaques en attente simultanées possibles, l'attaquant peut finir son tour pendant que le défenseur choisit, la résolution se fait alors pendant le tour suivant. | Une seule attaque en attente par salle ; tant qu'elle n'est pas résolue, le joueur actif ne peut pas agir ni finir son tour. |
| 15 | **[M]** Lambda : aucun délai de défense — si le défenseur ne répond pas (onglet fermé), **la partie est bloquée**. | Échéances stockées dans l'état de la salle (`expiresAt`), traitées par minuterie locale ou paresseusement (tout message entrant + `tick` client toutes les 15 s) sur lambda. |
| 16 | **[C]** `start_game` ne vérifie pas la phase : l'hôte peut **relancer la partie en pleine bataille** (re-génère la carte, repasse en `army_building`). `set_budget` idem pendant la construction d'armée. | Vérification de phase pour toutes les actions. |
| 17 | **[M]** `submit_army` crée les unités **avant** de vérifier le budget : `count: 1e9` → allocation énorme (DoS). Quantités non entières acceptées. | Validation (entiers 0–60, types connus, ≤ 200 unités) et calcul du coût avant création. |
| 18 | **[M]** On peut attaquer une unité **non déployée** (q/r = null → distance `NaN` → contrôle de portée contourné) ou **cachée par le brouillard** (ids `u_N` prévisibles) ; le message d'erreur « hors de portée (distance X) » révèle la position d'unités invisibles. | La cible doit être déployée et visible par l'attaquant ; message d'erreur générique pour les cibles invisibles. |
| 19 | **[M]** Ordre de tour : `getCurrentPlayerId` saute les joueurs éliminés mais `endTurn` incrémente l'index brut → un joueur peut **jouer deux fois** ; si le dernier joueur est éliminé, l'index boucle sur le premier. | Contrôleur de tour séquentiel dédié (`game/turns/sequential.js`) qui avance jusqu'au prochain joueur vivant ; si le joueur actif est éliminé pendant son tour, le tour passe automatiquement. |
| 20 | **[m]** `manche` non sérialisée (lambda la remettait à 1 à chaque action). | Sérialisation complète de l'état. |
| 21 | **[m]** Orientation du défenseur : le code testait `contre_attaque`/`encaissement` alors que le client envoie `counter`/`absorb` → le défenseur ne se tournait jamais vers l'attaquant. | Valeurs alignées (`counter`/`absorb`/`rien`). |
| 22 | **[M]** Carte : `generateHexMap` couvre tout le rectangle de l'image (cases hors carte jouables), les données sont lues depuis `public/data/*.json` à chaque création de salle. | Registre `game/maps.js` : la carte de la salle (`mapId`) fournit cases (`height`), terrain (plaine par défaut), segments, zones fixes éventuelles, objectifs. |
| 23 | **[m]** `change_stance` accepté hors phase bataille. | Contrôle de phase et de tour. |

## 4. Fuites d'information (brouillard de guerre)

| # | Problème | Correction |
|---|----------|------------|
| 24 | **[M]** `deployment_state.occupiedHexes` contient la position de **toutes** les unités adverses pendant le déploiement. | Uniquement ses propres unités. |
| 25 | **[M]** `unit_move_anim` est diffusé à tous avec le chemin complet : on voit les déplacements d'unités cachées. | Envoyé en entier au propriétaire et aux spectateurs ; pour les autres, tronqué à la partie visible, ou pas envoyé si l'arrivée est invisible. |
| 26 | **[M]** `combat_result` diffusé à tous (noms, vitalité restante, ids) même pour des combats hors de vue (TODO « N'afficher que les combats visibles »). | Envoyé aux deux camps, aux spectateurs, et aux autres joueurs seulement s'ils voient l'attaquant ou la cible. |
| 27 | **[m]** `game_state.heightData` (~25 Ko) renvoyé à chaque action — risque de dépasser la limite de 128 Ko d'API Gateway avec plusieurs joueurs. | Supprimé : le client lit les hauteurs depuis la carte (`/api/maps/<mapId>`). |

## 5. Client

| # | Problème | Correction |
|---|----------|------------|
| 28 | **[C]** XSS : noms de joueurs et messages de chat injectés via `innerHTML` (lobby et partie). | Nettoyage côté serveur + échappement côté client. |
| 29 | **[M]** `deploymentReady()` et le cas `deployment_ready_update` utilisent une variable `btn` non définie → `ReferenceError`, le bouton « Prêt » ne se met jamais à jour. | Corrigé (boutons `#btn-deploy-ready-global` et `#btn-deploy-ready-center`). |
| 30 | **[m]** Menu contextuel : appel à `showToast` inexistant. | Remplacé par `notify`. |
| 31 | **[M]** Couleurs : couleur par défaut identique pour tous (`#4a90d9`), rejet silencieux d'une couleur hors palette → toutes les armées en bleu. | Couleur attribuée par le serveur (distincte à l'arrivée), unique, erreur explicite en cas de refus ; le client affiche la couleur reçue dans `room_update`. |
| 32 | **[m]** `use_ability` n'envoie jamais `targetId` (Mou Bu échoue toujours). | Non corrigé (gameplay) — signalé. |

## 6. Nouvelle architecture

```
game/protocol.js     dispatcher unique (validation, sessions, échéances, vues par destinataire)
game/validate.js     validation des entrées (ProtocolError {code, message})
game/GameRoom.js     règles + état (carte de la salle, sérialisation complète)
game/turns/          contrôleurs de tour (sequential ; seam pour un futur mode "simultaneous")
game/maps.js         registre des cartes (data/maps/<id>.json)
server/createServer.js  Express + ws local (store mémoire, minuteries), server.js = point d'entrée
server/memoryStore.js   store local (file d'attente par salle)
lambda/handler.js       adaptateur API Gateway ; lambda/dynamoStore.js (verrou optimiste)
public/js/net.js        client WS partagé (session, reconnexion, battement de cœur, indicateur)
tests/*.test.js         npm test (node:test)
```

## 7. Protocole (résumé)

Entrant `{action, roomCode?, ...}` — sortant `{event, ...}` ; erreurs `{event:'error', code, message, action}`.

- Session : `create_room {playerName, mapId?}`, `join_room {roomCode, playerName, spectator?}`, `rejoin_game {roomCode, playerId, token}`, `leave_room`, `get_state`, `tick` (toutes les 15 s), `list_maps`.
  Réponses : `session {roomCode, playerId, token, role}` (seul message contenant le jeton, envoyé à son seul propriétaire), `room_created`, `room_joined`, `session_replaced`, `maps_list {maps, modes}`, `pong`.
- Lobby (hôte) : `set_map {mapId}`, `set_budget`, `set_mode` (seul `sequential` disponible), `start_game` ; tous : `set_player_color {color:#rrggbb}` (unique), `select_general`.
  `room_update` contient `mapId`, `mapName`, `mode`, `players[{id,name,color,generalId,isReady,connected}]`, `spectators`.
- Jeu : actions inchangées (`submit_army`, `place_unit`, `deployment_ready`, `move_unit`, `attack_unit`, `defend_choice {choice: rien|counter|absorb}`, `rotate_facing`, `change_stance`, `motivate_unit`, `use_ability {targetId?}`, `end_turn`, `chat_message`, `ping`).
- Nouveaux événements : `presence {players, spectators}`, `player_disconnected`, `player_reconnected`, `player_left {reason: left|timeout|abandon}`, `player_joined`, `spectator_joined`, `turn_auto_ended`, `chat_history`, `deployment_ready_update.readyIds`, `defense_request.seconds/expiresAt`.
- `game_state` : `mapId`, `mode`, `turnDeadline`, `players[].connected`, `spectators` ; **plus de `heightData`** (lire la carte). Spectateurs : `isSpectator: true`, toutes les unités, `visibleHexes` = toute la carte, `myUnits: []`.
- `myId` / `playerId` = identifiant stable du joueur (`p_…`, `s_…` pour un spectateur), plus l'id de connexion.

## 8. Règles de présence

| Phase | Déconnexion |
|-------|-------------|
| lobby | retiré après 30 s (hôte transféré) |
| armée / déploiement | retiré après 2 min, la partie continue sans lui |
| bataille | son tour passe après 60 s (30 s pour les tours suivants s'il est toujours absent) ; abandon (éliminé) après 10 min |
| défense en attente | « rien » après 20 s, que le défenseur soit là ou non |
| salle | supprimée 30 min après la fin, ou 30 min sans aucun membre connecté |

## 9. Reste à faire / limites

- Production (S3 statique) : `/api/maps` n'existe pas ; le client 2D se rabat sur `/data/*.json` pour la carte `default` uniquement. Pour d'autres cartes en production il faut publier `data/maps` sur S3 (ou exposer une route HTTP).
- Vue 3D : `gameView.js` appelle `createWorld` sans `mapId` → affiche toujours la carte par défaut ; `window.KB_MAP_ID` est disponible.
- Serveur local : l'état est en mémoire, un redémarrage (`--watch`) efface les parties ; le client renvoie alors au menu.
- `use_ability` : le client n'envoie pas de cible (Mou Bu).
