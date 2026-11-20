# Éditeur de cartes — guide rapide

Accès : `http://localhost:3000/admin/` → connexion avec le mot de passe admin (`ADMIN_PASSWORD` ou `config.local.json`) → **Ouvrir l'éditeur**.

## Tableau de bord (`/admin/`)
- Liste des cartes : **Éditer**, **3D** (vue `map3d.html`), **Dupliquer**, **Renommer** (nom + description ; l'identifiant ne change pas), **Supprimer** (sauf `default`).
- **Nouvelle carte** ouvre l'éditeur sur l'assistant de création.
- **Brouillons locaux** : cartes modifiées ou créées dans ce navigateur mais pas encore enregistrées (Reprendre / Supprimer).

## Navigation
| Action | Commande |
|---|---|
| Déplacer la vue | clic droit ou clic molette + glisser, Espace + glisser, flèches |
| Zoom | molette, `+` / `−` |
| Recadrer | `F` (outil Terrain : `F` bascule pinceau/remplissage) ou bouton ⤢ |
| Afficher terrain / hauteurs / calque | `M` |
| Grille, étiquettes (hauteur, coordonnées), fond | `G`, `L`, `B` |

## Outils (touches 1 à 9)
1. **Terrain** : plaines, forêts, fleuves, routes, bâtiments, ponts. Pinceau (taille `[` `]`) ou remplissage de la zone contiguë. Maj = repeindre en plaine.
2. **Hauteur** (−2 à 20) : Élever / Abaisser (+1/−1 une fois par passage, Maj inverse), Fixer (valeur), Aplanir (hauteur du point de départ), Lisser (moyenne des voisins). Boutons « Tout +1 / −1 ».
3. **Cases** : ajouter / supprimer des cases (forme de la carte). Supprimer une case retire aussi son terrain, ses champs, sa zone, ses objectifs et les segments qui n'ont plus aucune case.
4. **Segments** : cliquer ou glisser le long des bords de cases (falaise, mur, rivière, barrière, passerelle, pont, échelle, chevaux de frise). Gomme ou Maj = effacer. Seuls les bords entre deux cases de la carte sont peints.
5. **Décor** : champs de blé (visuel, sur plaines) ou **remparts** (chemin de ronde). En 3D comme en 2D, les cases de remparts voisines forment une seule muraille continue qui passe par leurs centres (droite quand les cases sont alignées, sans suivre les contours des hexagones) : corps épais, glacis côté extérieur (le côté le plus bas), chemin de ronde dallé, parapet crénelé et créneaux réguliers ; la muraille suit la pente quand les cases montent. Une tour de guet posée sur un rempart devient un bastion (plateforme au niveau du chemin de ronde, pavillon ouvert). Purement visuel : les règles viennent de la hauteur (remparts plus hauts que leurs abords) et des segments (falaise sur la face extérieure, barrières sur les portes, échelle pour l'assaut à pied).
6. **Zones** : zones de déploiement fixes (facultatif ; sans zone, le jeu les génère). « + Zone », choisir la zone puis peindre. Maj = gomme.
7. **Objectifs** : clic sur une case = nouvel objectif ; clic sur un objectif = sélection (nom, type, points dans le panneau) ; glisser pour déplacer ; `Suppr` pour supprimer.
8. **Fond** : image peinte sous la grille et calibration. Glisser = déplacer l'image, Maj + glisser vertical = changer la taille d'hex. Réglages fins (taille d'hex, origine X/Y) dans le panneau. « Mode calque » rend les cases transparentes pour décalquer la peinture ; « Ajouter les cases couvertes par l'image » crée les cases manquantes.
9. **Éléments** (`9`) : tour de guet, porte fortifiée (plusieurs portes posées côte à côte dans la muraille forment une seule grande porte à plusieurs passages, avec contreforts, arcs, battants et pavillon à deux toits ; une porte seule fait une poterne), tente, tente de commandement, bannière (texte de 8 caractères max, ex. 秦), escalier de pierre, feu de camp. Clic sur une case vide = poser l'élément choisi ; clic sur un élément = le sélectionner (glisser pour déplacer) ; `R` = tourner (6 orientations, pour la porte : axe du passage ; tente : entrée ; escalier : sens de la montée) ; `Suppr` ou Maj+clic = supprimer ; « Changer le type » dans le panneau. Purement visuels, dessinés en 2D (jeu et éditeur) et en 3D.

Communs : **pipette** = Alt + clic ou `I` puis clic (reprend le terrain, la hauteur, le segment, la zone… de la case visée). **Annuler / rétablir** : Ctrl/Cmd+Z, Ctrl/Cmd+Maj+Z ou Ctrl+Y. La barre du bas affiche la case survolée (coordonnées, terrain, hauteur, segments par direction, zone, champ, objectif). `?` affiche tous les raccourcis.

## Format du décor
`decor.fields` (champs), `decor.ramparts` (cases de remparts) et `decor.props` (`[{ type, q, r, rot, label }]`, types dans `public/js/mapProps.js`) ; vérifiés par `validateMap` (cases hors carte, type ou orientation inconnus). Le rendu 3D est dans `public/js/map3d/fortifications.js`, le 2D dans `public/js/mapProps.js`.

## Col de Kankoku
`node scripts/maps/kankoku.mjs` régénère `data/maps/kankoku.json` (large passe barrée par la muraille de Qin, qui traverse toute la vallée et grimpe sur les premières pentes ; grande porte double sur la route et deux poternes ; ligne de falaises continue à travers les deux massifs : les portes à double barrière et l'échelle du sentier sud sont les seuls passages ; hauteur du guet au nord, rivière et pont dans la plaine, camp de la coalition à l'est, 4 zones fixes dans l'ordre Qin forteresse / coalition camp / coalition nord / Qin arrière). Les retouches faites ensuite dans l'éditeur sont perdues si on relance le script. `tests/kankoku.test.js` vérifie les passages, les zones et une partie IA contre IA.

## Créer une carte
**Nouveau** → identifiant (a-z, 0-9, `-`, `_`) + nom, puis :
- **Rectangle** : colonnes × lignes ;
- **Depuis une image** : chemin de l'image + calibration (taille d'hex en pixels image, origine = pixel du centre de la case 0,0). Les cases dont le centre tombe dans l'image sont créées (avec `/assets/img/map.webp`, 101.5 / 137 / 190, on retrouve exactement les 2337 cases de la carte d'origine).

Les images de fond se placent dans `public/assets/maps/` (ou se téléversent depuis l'outil Fond si la route `/api/editor` est active).

## Validation et statistiques
L'onglet **Validation** se met à jour en continu :
- **Erreurs** (bloquent l'enregistrement) : exactement les règles du serveur (`validateMap`) — id/nom, clés et hauteurs invalides, terrain hors carte ou inconnu, segment mal formé ou de type inconnu.
- **Avertissements** : segments entre cases non adjacentes ou hors carte, cases isolées / îlots, falaises sans dénivelé, dénivelés ≥ 2 sans falaise/échelle/mur, zones trop petites (minimum du jeu : 10 cases pour un budget de 2 500), inégales, sur forêt/fleuve, objectifs hors carte ou incomplets, champs hors plaine, calibration incomplète.

Cliquer un élément centre la vue dessus ; certains groupes ont un bouton de correction automatique (annulable). L'onglet **Stats** donne les répartitions (terrains, segments, histogramme des hauteurs, zones…).

## Enregistrer
- **Enregistrer** (Ctrl/Cmd+S) : PUT sur `/api/maps/<id>`. Si la session admin a expiré, une connexion est proposée puis l'enregistrement reprend.
- **Enregistrer sous…** (Ctrl/Cmd+Maj+S) : nouvel identifiant ; confirmation avant d'écraser une carte existante.
- **Brouillon automatique** : chaque modification est gardée dans le navigateur (localStorage) et restaurée au rechargement (« Version serveur » pour l'abandonner).
- **Exporter / Importer** un fichier JSON (format 2) ; on peut aussi glisser un `.json` sur la carte.

## Aperçu 3D
**Aperçu 3D** (`P`) ouvre un panneau à droite :
- **Brouillon** : rendu 3D de l'état actuel, sans enregistrer ;
- **Version enregistrée** : `map3d.html?map=<id>`.
**↻ Actualiser** après des modifications ; fermer le panneau libère la 3D.
