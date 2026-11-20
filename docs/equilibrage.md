# Équilibrage — données de jeu, éditeur et simulations

## Où sont les données

Les tables d'équilibrage sont des fichiers JSON dans `data/balance/` :

| Fichier | Forme | Contenu |
|---|---|---|
| `units.json` | objet `{ id: unité }` | statistiques des unités (vitalité, moral, attaque, puissance, défense, armure, intimidation, vitesse, portée, coût, catégorie, texte du bonus), capacité (`bonusType`) et ses réglages facultatifs `bonusValue` / `bonusRange` / `bonusCost` (voir `docs/regles.md` §10 bis) |
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

## Passe d'équilibrage (novembre 2026)

Mesures : `node simulation/run.js --budget 4000` (11 × 11 généraux), en séquentiel (IA du simulateur) et en simultané (`--simultaneous`, IA Vétéran de `game/bots`) ; avant = 3 parties par affrontement (363), après = 12 (1 452). Taux de victoire = victoires / parties (un nul n'est pas une victoire).

### Constat

- **L'armure annulait presque tous les dégâts.** Dégâts = (dés de l'attaquant − vitalité × armure de la cible) / 10 : à pleine santé, aucune paire d'unités ne se blessait au corps à corps en posture Combat ; 43 à 56 % des coups qui touchaient faisaient 0 dégât (70 à 88 % contre les généraux, la cavalerie lourde, l'assassin, la phalange), et 78 à 89 % des ripostes aussi. Les batailles se jouaient au moral et les généraux (armure 17 à 20) étaient presque intuables : d'où les nuls et la domination des généraux à forte Force.
- **Généraux** : le taux de victoire suivait la Force (en séquentiel, Mou Bu 79 %, Gai Mou 73 %, Go Hou Mei 15 %).
- **Unités** : en combats à coût égal (`_resolveCombat`, 4 800 or par camp, mêlée), les Soldats battaient tout (99 %) ; les Bâtisseurs (moral 75) et le Char ne gagnaient presque jamais. Les capacités décrites dans `bonus` ne sont pas implémentées par le moteur (`bonusType` n'est lu nulle part).

### Changements

| Règle / donnée | Avant | Après | Pourquoi |
|---|---|---|---|
| `RULES.combat.maxArmorAbsorb` (nouveau, `public/js/rules.js`) | absorption illimitée | l'armure absorbe au plus 75 % des dégâts (riposte comprise) | un coup qui touche blesse toujours ; les généraux deviennent tuables |
| Vitesse de début de tour | minimum 0 | minimum 1 | Soldats et Phalange (vitesse 2) au Repos, ou en Combat en forêt, tombaient à 0 et ne pouvaient plus jamais changer de posture |
| Mou Bu | Vit 130, Arm 20, Force 18, arme 21 | 120, 19, 17, 20 | le plus fort ; reste en tête des brutes |
| Gai Mou | Vit 130, Force 18 | 125, 17 | idem |
| Shi Ba Shou / Ren Pa | Vit 130 / 120 | 125 / 115 | au-dessus de 55 % |
| Ou Sen / Go Kei | Vit 110 / 90 | 120 / 100 | sous 40 % |
| Ri Boku | Vit 100, Force 11 | 105, 12 | sous 40 % |
| Kei Sha | Vit 100, Charisme 14 | 105, 15 | sous 40 % |
| Go Hou Mei | Vit 80, Arm 17, Force 10, Charisme 14 | 105, 18, 12, 15 | 15 % ; reste le plus faible combattant |
| Bâtisseurs | moral 75, 1 000 or | 150, 800 | brisés au premier coup, aucune capacité implémentée |
| Cavalier lourd | Vit 100, 1 200 or | 130, 1 100 | son armure ne suffit plus à le protéger |
| Cavalier léger / Assassin | 900 / 800 or | 800 / 700 | survie la plus basse, perdants des combats à coût égal |
| Char | Vit 75, 1 600 or | 100, 1 300 | idem |

### Résultats

| | Séquentiel avant | Séquentiel après | Simultané avant | Simultané après |
|---|---|---|---|---|
| Parties nulles | 8,3 % | 2,7 % | 55 % | 0,8 % |
| Taux de victoire des généraux (min – max) | 15 – 79 % | 39 – 59 % | 11 – 41 % (nuls) | 42 – 58 % |

| Général | Séq. avant | Séq. après | Simul. avant | Simul. après |
|---|---|---|---|---|
| Mou Bu | 79 | 57 | 21 | 52 |
| Gai Mou | 73 | 59 | 24 | 58 |
| Ren Pa | 65 | 52 | 33 | 57 |
| Shi Ba Shou | 59 | 59 | 24 | 52 |
| Ou Ki | 44 | 51 | 41 | 56 |
| Go Kei | 39 | 46 | 11 | 42 |
| Ou Sen | 36 | 45 | 23 | 50 |
| Kan Ki | 33 | 46 | 18 | 46 |
| Kei Sha | 32 | 39 | 18 | 48 |
| Ri Boku | 29 | 42 | 15 | 44 |
| Go Hou Mei | 15 | 40 | 18 | 42 |

Intervalle de confiance après : environ ± 6 points par général et par mode. Les nuls du mode simultané « avant » viennent de l'IA (voir `docs/ia-et-tutoriel.md`) . Avec l'IA corrigée mais les règles et données d'origine (726 parties par mode) : simultané Mou Bu 72 %, Go Hou Mei 22 %, aucun nul ; séquentiel Mou Bu 80 %, Go Hou Mei 16 %, 2,6 % de nuls.

Combats à coût égal après : les infanteries s'équilibrent (victoires moyennes : Phalange 84 %, Piétaille 80 %, Soldats 76 %, Espion 70 %, Lancier 67 %) ; la cavalerie et l'assassin restent en dessous (34 à 41 %), le Char à 14 % : leur intérêt est la vitesse et la charge, que ce test ne mesure pas.

### Limites

- La plupart des capacités de généraux ne sont pas implémentées (les capacités d'unités le sont depuis, voir ci-dessous).
- Le simulateur séquentiel ne recrute jamais de Char (le budget de sa catégorie est inférieur à son coût).
- La Force reste la statistique la plus forte (attaque, défense et duel des généraux) ; la Stratégie ne compte que pour l'initiative, la vision et les points de commandement.

## Capacités des unités (novembre 2026)

Les capacités décrites dans `bonus` sont maintenant appliquées par le moteur (règles dans `docs/regles.md` §10 bis, réglages `bonusValue` / `bonusRange` / `bonusCost` dans `units.json`). Mesures avec le même protocole que ci-dessus (2 904 parties par mode, 24 par affrontement, budget 4 000), avant / après :

| | Séquentiel avant | Séquentiel après | Simultané avant | Simultané après |
|---|---|---|---|---|
| Parties nulles | 1,9 % | 2,5 % | 0,3 % | 0 % |
| Taux de victoire des généraux (min – max) | 38 – 59 % | 40 – 60 % | 42 – 58 % | 40 – 59 % |

| Unité | Survie séq. | Survie simul. | Rapport gagnant / perdant simul. |
|---|---|---|---|
| Bâtisseurs | 33 → 33 % | 12 → 16 % | 0,86 → 1,00 |
| Assassin | 30 → 30 % | 10 → 13 % | 0,84 → 0,90 |
| Lancier | 47 → 48 % | 19 → 17 % | 0,97 → 0,95 |
| Phalange | 65 → 66 % | 29 → 29 % | 1,08 → 1,11 |
| Cavalier léger | 22 → 20 % | 11 → 10 % | 1,16 → 1,09 |
| Cavalier lourd | 27 → 26 % | 10 → 11 % | 1,00 → 0,94 |
| autres | ± 1 point | ± 2 points | |

Combats à coût égal (mêlée, 4 800 or par camp) : les lanciers battent maintenant la cavalerie à 92 – 97 % (82 – 88 % avant) ; le reste ne bouge pas au-delà du bruit.

Aucun coût n'a été modifié : les écarts restent dans l'intervalle de confiance (± 4 à 6 points), sauf les Bâtisseurs et l'Assassin du mode simultané qui remontent (l'IA du mode simultané pose des chevaux de frise et fait disparaître ses assassins ; le simulateur séquentiel, `simulation/AIAgent.js`, n'utilise pas les capacités actives). Le Char n'est toujours jamais recruté par le simulateur : son piétinement et sa traversée ne sont mesurés que par les tests (`tests/abilities.test.js`).
