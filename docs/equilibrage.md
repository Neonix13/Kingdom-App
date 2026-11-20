# Équilibrage — données de jeu, éditeur et simulations

## Où sont les données

Les tables d'équilibrage sont des fichiers JSON dans `data/balance/` :

| Fichier | Forme | Contenu |
|---|---|---|
| `units.json` | objet `{ id: unité }` | statistiques des unités (vitalité, moral, attaque, puissance, défense, armure, intimidation, vitesse, portée, coût, catégorie, texte du bonus) |
| `generals.json` | tableau `[général]` | généraux (royaume, armée, vitalité, armure, intimidation, arme `{ name, damage }`, force, stratégie, charisme, citation, capacités facultatives) |
| `terrains.json` | objet | modificateurs par type de terrain |
| `segments.json` | objet | modificateurs des bords entre deux cases (rivière, falaise, pont, mur…) |
| `stances.json` | objet | modificateurs des postures |

Les modules `game/data/{units,generals,terrains,segments,stances}.js` ne sont plus que des chargeurs : ils exportent exactement la même forme qu'avant (`require('./data/units')` reste un objet, `generals` reste un tableau). Rien d'autre n'a changé pour le moteur, l'IA du simulateur ou la lambda (qui embarque la racine du dépôt, donc `data/balance/`).

Le code commun est dans `data/balance/index.js` (chargement, rechargement, enregistrement, historique) et `data/balance/schema.js` (champs, bornes et règles de validation).

## Rechargement à chaud

- Les fichiers sont lus avec `fs` (pas `require`) : `node --watch server.js` ne redémarre pas le serveur quand on enregistre.
- Après un enregistrement ou une restauration, `reload()` **remplit les objets exportés en place** (les clés d'un objet sont remplacées, le tableau des généraux est vidé puis rempli). Tous les modules qui ont fait `require('./data/…')` voient donc les nouvelles valeurs, sans redémarrage.
- Le serveur surveille aussi les fichiers (`fs.watchFile`, toutes les 2 s) : une modification à la main, un `git checkout` ou une écriture par un autre processus est rechargée automatiquement. Un fichier invalide est ignoré (message dans la console) et les anciennes données restent en mémoire.
- `balance.version(table)` renvoie l'empreinte de la version chargée : un cache dérivé des données peut s'en servir pour se reconstruire (c'est ce que fait `game/rules/index.js` pour la table de déplacement).

**Effet sur les parties :**
- Nouvelles parties : elles utilisent les nouvelles valeurs.
- Parties en cours : les unités et le général sont des copies créées quand l'armée est validée, ils gardent donc leurs statistiques. En revanche les modificateurs de terrains, segments et postures sont lus à chaque action : ils changent aussi dans les parties en cours.
- Lambda AWS : chaque instance lit les JSON à son démarrage. Pour changer les valeurs en production, il faut committer les JSON puis redéployer. L'API d'écriture n'existe que sur le serveur Express.

## Validation

Chaque enregistrement est validé côté serveur, et la page d'édition applique les mêmes règles, reçues de `GET /api/balance/schema` :

- types (entier, texte, booléen, liste de valeurs), champs requis, champs inconnus refusés ;
- bornes (par exemple coût de 50 à 10 000, parce qu'un coût de 0 ferait boucler le constructeur d'armée de l'IA ; modificateurs de −10 à +10) ;
- règles croisées : vitalité ≤ vitalité max, moral ≤ moral max ;
- identifiants : la clé doit être égale à `id`, et **l'ensemble des entrées est figé**. Les identifiants sont référencés par les cartes (`game/maps.js`), le moteur (capacités par `general.id`), les listes de l'IA et le client (portraits, listes du lobby). Ajouter ou supprimer une entrée demande donc une modification du code, puis du JSON ;
- références : le royaume doit être `QIN`, `ZHAO`, `WEI`, `CHU`, `HAN`, `YAN`, `QI` ou une combinaison avec `/` (ex. `ZHAO/WEI`) ; la catégorie d'unité doit être `Infanterie`, `Chevaux`, `Tireurs` ou `Chars` (le moteur et l'IA s'en servent) ; `special` d'un segment vaut `null` ou `collapse_1d4` ;
- capacités des généraux (`activeAbility { name, description?, cooldown }`, `passiveAbility { name, description? }`) : elles sont facultatives. Le moteur les lit (`GameRoom.useGeneralAbility`) mais les données d'origine n'en contiennent pas. Une capacité saisie sans son nom ou sans sa recharge est refusée. Si tous ses champs sont vidés, la capacité est supprimée.

## API

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| GET | `/api/balance` | public | `{ version, tables: { units, generals, terrains, segments, stances } }` : toutes les tables, pour les clients |
| GET | `/api/balance/schema` | public | spécification des champs (`{ order, tables }`) |
| GET | `/api/balance/:table` | public | `{ table, version, data }` |
| PUT | `/api/balance/:table` | admin | corps `{ data, baseVersion }` ; 400 + `details: [{ id, field, message }]` si invalide, 409 si `baseVersion` ne correspond plus (quelqu'un a enregistré entre-temps) ; réponse `{ version, unchanged, backup, globalVersion }` |
| GET | `/api/balance/history[?table=units]` | admin | versions archivées `[{ file, table, replacedAt, size }]`, plus récentes d'abord |
| GET | `/api/balance/history/:file` | admin | contenu d'une version archivée |
| POST | `/api/balance/history/:file/restore` | admin | restaure (valide, archive la version actuelle, recharge) ; corps optionnel `{ baseVersion }` |
| POST | `/api/balance/reload` | admin | relit tous les fichiers |
| GET | `/api/balance/sim` | admin | état de la simulation en cours ou de la dernière (`status`, `done`, `total`, `report`, `log`…) et limites |
| POST | `/api/balance/sim` | admin | lance une simulation `{ gamesPerMatchup, budget, threads, initiative }` ; 409 si une simulation tourne déjà |
| POST | `/api/balance/sim/cancel` | admin | annule la simulation en cours |
| GET | `/api/balance/reports` | admin | rapports trouvés dans `simulation/results*/` (avec paramètres et version des données quand ils existent) |
| GET | `/api/balance/reports/:dir/:file` | admin | contenu d'un rapport |

L'accès admin utilise la session de `server/admin.js` (cookie après `POST /api/admin/login`).

### Historique

À chaque enregistrement, la version remplacée est copiée dans `data/balance/history/<table>_<horodatage UTC>.json`. Seules les 100 dernières versions par table sont gardées. Ce dossier est ignoré par git (fichier `.gitignore` interne) : l'historique est local au serveur. Les JSON courants, eux, se committent comme du code.

## Page d'édition (`/admin/balance.html`)

Accessible depuis le tableau de bord admin (carte « Éditeur d'équilibrage »).

- **Un onglet par table.** Chaque table s'affiche en grille éditable, avec les colonnes groupées (vitalité, moral, attaque, défense…) et l'infobulle de chaque en-tête (bornes, aide). Les modificateurs positifs sont en vert, les négatifs en rouge.
- **Validation en direct.** Une case invalide est encadrée de rouge. La liste des erreurs est dans le panneau de droite, et l'onglet concerné est souligné en rouge.
- **Différences avec la version enregistrée.** Une case modifiée est surlignée et son infobulle donne la valeur enregistrée. Le panneau « Modifications non enregistrées » liste chaque changement avec un bouton ↺, et un clic droit sur la case l'annule aussi. Le badge de l'onglet compte les changements.
- **Annuler / Rétablir** (Ctrl+Z / Ctrl+Maj+Z) et **Abandonner les modifications** de la table.
- **Enregistrer** (Ctrl+S) envoie toutes les tables modifiées. Les erreurs du serveur s'affichent sur les cases. En cas de conflit (409), un bouton propose de recharger la table. Le navigateur prévient avant de quitter la page s'il reste des modifications.
- **Historique.** Liste des versions archivées avec un résumé des différences avec la version actuelle. « Voir » affiche le détail champ par champ, « Restaurer » rétablit la version (après confirmation).
- **Simulation** (voir ci-dessous).

## Simulations depuis l'interface

L'onglet *Simulation* lance `simulation/run.js` dans un **processus séparé** (`child_process.fork`, priorité réduite avec `os.setPriority`). Le serveur de jeu n'est donc pas bloqué. Une seule simulation tourne à la fois, avec au plus `min(8, nombre de cœurs − 2)` threads. Les paramètres sont bornés : 1 à 500 parties par affrontement, budget de 500 à 50 000.

- Paramètres : parties par affrontement (11 × 11 = 121 affrontements), budget, threads, initiative (désactivée = `--no-initiative`).
- La simulation utilise les **données enregistrées**. La page prévient s'il reste des modifications non enregistrées.
- Progression : `worker.js` envoie un message après chaque partie, `run.js` les regroupe et les transmet au serveur par IPC (au plus 4 fois par seconde). La page interroge `GET /api/balance/sim` chaque seconde (barre, nombre de parties, temps écoulé et restant, journal). Le bouton *Annuler* tue le processus. Si le serveur s'arrête, le processus de simulation se termine aussi (déconnexion IPC).
- Le rapport est écrit comme avant dans `simulation/results/report_<date>.json`. Il contient désormais aussi `params` (paramètres de la simulation) et `balance` (`version` et copie des tables utilisées).

Affichage d'un rapport :

- **Taux de victoire par général**, avec l'intervalle de confiance à 95 % calculé par le simulateur, une ligne à 50 % et un repère pour le rapport de comparaison. Les généraux au-dessus de 60 % ou sous 40 % sont signalés.
- **Matrice des affrontements** (joueur 1 en ligne, joueur 2 en colonne, nul = ½) en échelle divergente gris (50 %) / bleu / rouge. Le survol donne le taux ± IC et le nombre de parties. Un second mode affiche l'écart avec le rapport de comparaison.
- **Unités** : survie ± IC, PV perdus en moyenne, nombre moyen par armée gagnante et perdante, et leur ratio.
- **Comparaison** avec un rapport précédent : par défaut le plus récent qui a le même budget et la même initiative, sinon le précédent. La page montre l'écart en points, marqué ★ quand il dépasse l'incertitude combinée √(IC₁² + IC₂²). Elle liste aussi les **données modifiées entre les deux rapports** quand ils contiennent tous deux une copie des tables (les anciens rapports n'en ont pas et sont affichés « paramètres inconnus »). Un avertissement apparaît si le budget ou l'initiative diffèrent.

La ligne de commande ne change pas : `node simulation/run.js --games 50 --budget 5000 --threads 4 [--no-initiative]`.

## Pour le client

Le client 2D garde encore ses copies en dur : `SEGMENT_DEFS_CLIENT`, `TERRAINS_DATA` et `STANCES_DATA` dans `public/js/game.js`, `UNITS_DATA` et `GENERALS_DATA` dans `public/js/lobby.js`. Pour que les modifications d'équilibrage y apparaissent, il suffit de charger `GET /api/balance` au démarrage et d'utiliser `tables.units`, `tables.generals`, `tables.terrains`, `tables.segments` et `tables.stances`, qui ont la même forme que les modules serveur. En hébergement statique (S3/CloudFront), il faut publier une copie de ces JSON à côté du site ou les envoyer par le WebSocket.
