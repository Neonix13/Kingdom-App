# Postures et combat — ce qui se passe quand une unité en attaque une autre

Référence tirée du code : `GameRoom._resolveCombat` / `_applyCombat` (calcul commun aux deux modes), `game/protocol.js` (`defenseOptions`, choix du défenseur en mode séquentiel), `game/rules/resolve.js` (`reactionOf`, `chargeExtra`, mode simultané). Les valeurs viennent de `data/balance/stances.json` (éditables dans `/admin/balance.html`) et de `RULES.combat`, `RULES.night` et `RULES.simultaneous` dans `public/js/rules.js`.

## 1. Réponse du défenseur selon sa posture

| Posture du défenseur | Mode séquentiel (choix du joueur) | Mode simultané (automatique) | Particularités |
|---|---|---|---|
| **Marche** | Contre-attaquer / Encaisser / Rien | **Encaisser** ; **Rien** si l'unité a déjà avancé ce tour | angle 2 sur les 4 flancs, 4 de dos |
| **Combat** | idem | **Contre-attaquer** | posture neutre (tout à 0) |
| **Charge** | idem | **Contre-attaquer** | même de face, l'attaquant a +2 d'angle |
| **Repos** | idem | **Rien** | régénération maximale |
| **Défense de combat** | idem | **Contre-attaquer** + annule le bonus de charge | seul le dos est faible (4) |
| **Défense à distance** | idem | **Encaisser** ; un tireur qui tient tire en réaction | esquive au tir +4 |
| **Général** (pas de posture) | idem ; duel contre un général au contact | **Contre-attaquer** ; duel contre un général | aucun angle contre lui |
| **Rencontre** (simultané) | — | toujours **Contre-attaquer** | voir mode-simultane.md |

- **Séquentiel** : contre une attaque de mêlée, le défenseur a toujours les trois choix, **quelle que soit sa posture**. Il a 20 s pour répondre ; sans réponse, c'est « Rien ». La posture ne change que les chiffres. L'IA répond Contre-attaquer si (défense + posture + terrain) / 20 ≥ 0,45 et vitalité > 40 %, sinon Encaisser (avec une part d'erreurs selon son niveau).
- **Contre une attaque à distance ≥ 2**, dans les deux modes : pas de défense ni de riposte, et le tir est résolu tout de suite, sans fenêtre de choix. Seule la **phalange** peut encaisser, et jamais face à des archers. En séquentiel, la seule attaque à distance qui ne vient pas d'un archer est celle d'une unité de mêlée placée plus haut que sa cible (portée +1 par niveau, §5). La phalange a alors le choix Encaisser / Rien. En simultané, ce cas n'existe pas : la mêlée frappe toujours au contact.

### Effet des réponses

| Réponse | Jet du défenseur | Dégâts et moral reçus | Riposte (mêlée seulement) | Autres effets |
|---|---|---|---|---|
| **Rien** | aucun | entiers | aucune | ne se tourne pas |
| **Contre-attaquer** | NGO d20 ≤ défense effective | **entiers** | réussites × puissance effective × ratio d'armure de l'attaquant ; moral = réussites × intimidation de riposte | se tourne vers l'attaquant, révélé |
| **Encaisser** | même jet | **÷ 2** (arrondi au-dessus), même sans réussite | **÷ 2** | idem |

Chaque attaque reçue use **1 point d'armure** de la cible. L'attaquant perd aussi 1 point d'armure s'il subit des dégâts de riposte.

## 2. Modificateurs des postures (`stances.json`)

La colonne `cac` sert quand la distance est de 1 (y compris pour un archer au contact), la colonne `tir` quand la distance est de 2 ou plus.

| Champ (cac / tir) | Marche | Combat | Charge | Repos | Déf. combat | Déf. distance | S'applique à… |
|---|---|---|---|---|---|---|---|
| Vitesse | +1 | 0 | +2 | −1 | −1 | 0 | début du tour suivant (vitesse ≥ 1) |
| Attaque | −1 / −2 | 0 | **+3** / −2 | −2 / −2 | −2 / −1 | −3 / 0 | l'unité **qui attaque** |
| Puissance | 0 / −1 | 0 | +1 / −1 | −2 / −1 | −1 / 0 | −2 / 0 | dégâts en attaque **et** en riposte |
| Intimidation | +1 / 0 | 0 | +2 / −1 | −2 / −1 | 0 / +1 | −2 / −1 | moral infligé en attaque et en riposte |
| Précision | 0 / −2 | 0 | +2 / −2 | −1 / −1 | 0 / −2 | −2 / −1 | attaquant : réduit la défense adverse quand celle-ci riposte ou encaisse (un bonus la baisse, un malus l'augmente) |
| Défense | −2 / −1 | 0 | −1 / −2 | −2 / −2 | **+3** / −2 | −2 / 0 | défenseur qui contre-attaque ou encaisse |
| Esquive | 0 / +2 | 0 | +1 / +3 | 0 / −2 | +1 / −1 | +2 / **+4** | défenseur : retranchée de l'attaque adverse (toujours) |
| Courage | −1 / −1 | 0 | +1 / +1 | −1 / −1 | +1 / −1 | −1 / +1 | retranché de l'intimidation adverse (attaque reçue ou riposte reçue) |
| Armure | −1 | 0 | 0 | 0 | +1 | 0 | défenseur toujours ; attaquant face à une riposte |
| Armure / tour | 0 | 0 | 0 | +1 | 0 | 0 | régénération au début du tour |
| Moral / tour | 0 | 0 | **−10** | +10 | 0 | 0 | idem |
| Vitalité / tour | 0 | 0 | 0 | +5 | 0 | 0 | idem |
| Bonus de nuit / tour | — | — | — | +20 moral, +5 vitalité | +5 moral | — | `RULES.night.restStances` |

Changer de posture coûte 2 de vitesse, que l'on peut dépenser à tout moment en séquentiel et qui est payée au tick 0 en simultané. Les généraux n'ont pas de posture : aucun modificateur de posture ne s'applique à eux. Une unité dont le moral tombe à 0 passe en **Marche** et fuit. `RULES.extraStances.repos` (dans `rules.js`) n'est qu'une valeur de secours, ignorée tant que `stances.json` définit le Repos.

## 3. Angle d'attaque (`RULES.combat.angleMods`)

L'angle se lit dans la table de la **posture du défenseur**, selon la direction d'où vient l'attaquant par rapport à l'orientation du défenseur (y compris pour un tir). Il vaut 0 si le défenseur est un général.

| Posture du défenseur | face | avant-flanc | arrière-flanc | dos |
|---|---|---|---|---|
| Marche | 0 | 2 | 2 | 4 |
| Combat | 0 | 0 | 2 | 4 |
| Charge | 2 | 2 | 4 | 4 |
| Repos | 0 | 2 | 4 | 4 |
| Défense de combat | 0 | 0 | 0 | 4 |
| Défense à distance | 0 | 2 | 4 | 4 |

La valeur d'angle `a` est ajoutée à l'attaque, à la puissance et à l'intimidation de l'attaquant, et retranchée de l'armure du défenseur. Si le défenseur riposte ou encaisse, `a` est aussi retranché de sa défense, de sa puissance de riposte et de son intimidation de riposte, et ajouté à l'armure de l'attaquant face à la riposte. Le journal affiche « flanc » pour 2 et « dos » pour 4. Ainsi, un arrière-flanc à 4 est affiché comme « dos ».

## 4. Formules (unités)

- **Attaque effective** = attaque + posture A + terrain A + segment − esquive (posture D + terrain D) + (hauteur A − hauteur D) + angle + nuit (−2 cac, −3 tir) + charge (simultané).
- **Réussites** : NGO = ⌊vitalité / 5⌋ d20 (au moins 1) ; chaque d20 ≤ attaque effective est une réussite.
- **Armure du défenseur** = armure + posture + terrain + segment + phalange ou lancier (+20 contre les tirs) − angle − malus Mou Bu ; AR = NGO du défenseur × armure ; ratio = 1 − AR / (AR + 100).
- **Dégâts** = réussites × (puissance + effets + posture + terrain + segment + lanciers + angle + charge) × ratio. **Moral** = réussites × (intimidation + posture + terrain + segment − courage du défenseur + angle).
- **Défense effective** (riposte) = défense + posture D + terrain D + segment − précision de A − hauteur − angle.
- **Généraux** : un seul d20, ils touchent toujours. Dégâts = (Force − d20 + 80) × Puissance / 5 × ratio / 2 ; moral = (Charisme − d20 + 80) × Intimidation / 100. En riposte, mêmes formules (÷ 2 de plus s'il encaisse).

## 5. Cas particuliers

| Cas | Règle |
|---|---|
| **Charge** (simultané seulement) | **+2 attaque, +3 puissance** au premier combat de mêlée du tour, après **≥ 2 cases** parcourues, avec l'ordre Charger ou la posture Charge. Contre des **lanciers** : **−2 attaque** à la place (vérifié en premier). Contre la **Défense de combat** : annulée. Une fois par tour. Le mode séquentiel n'a pas de bonus de charge : seuls comptent les modificateurs de la posture Charge (+3 attaque cac…). |
| **Lanciers** | +6 puissance contre Chevaux et Chars, en attaque **et** en riposte ; +20 armure contre les tirs ; retournent le bonus de charge (simultané). |
| **Phalange** | +20 armure contre les tirs ; peut encaisser une attaque à distance sauf d'archers (en pratique : une unité de mêlée qui frappe d'en haut, mode séquentiel seulement). N'annule pas la charge. |
| **Tir contre mêlée** | Distance ≥ 2 : pas de riposte, pas de défense (sauf phalange), colonnes `tir`. Un tireur **au contact** combat en mêlée : colonnes `cac`, la cible peut riposter. |
| **Mêlée depuis une hauteur** (séquentiel) | La portée vaut 1 + (hauteur A − hauteur D). Une unité de mêlée un niveau au-dessus de sa cible peut donc frapper à 2 cases. Cette attaque compte comme un **tir** : colonnes `tir`, aucune riposte possible. |
| **Généraux** | Pas de posture, angle 0 contre eux. En simultané, ils contre-attaquent toujours. Un général contre un général au contact livre un **duel** (3 passes de d20 + Force, sans choix de défense). |
| **Unité qui a bougé** | Simultané : une unité en **Marche** qui a avancé d'au moins une case pendant la résolution ne se défend pas (Rien). Séquentiel : aucun effet. |
| **Unité en fuite** | Posture forcée en Marche. En simultané, elle n'agit plus et encaisse ; si elle a été mise en fuite après avoir avancé pendant la résolution, elle ne répond pas (Rien). En séquentiel, son propriétaire choisit toujours. Elle peut être remotivée par son général. |
| **Soldats** | Après **leur** attaque (pas en riposte), une cible sous 10 % de sa vitalité max est exécutée (jamais un général). |
| **Cavalier lourd** | 50 % du moral qu'il inflige frappe aussi les ennemis adjacents à sa cible (pas les généraux). |
| **Char** (séquentiel) | Traverse et frappe chaque ennemi traversé, sans riposte (réponse « Rien »). En simultané, il combat normalement. |
| **Cavalier léger** | Séquentiel : attaquer coûte 2 de vitesse et il peut encore bouger. Simultané : il s'arrête après sa frappe. |

## 6. Incohérences relevées (code et docs)

- **Tir en simultané** : la cible d'un tir dont la posture répondrait Contre-attaquer ou Encaisser se tourne vers le tireur. Le journal affiche ce choix alors que le calcul a utilisé « Rien » (`resolve.js`, `resolveStrikes`). En séquentiel, elle ne se tourne pas.
- **Archers** : « la cible ne fait aucun jet de défense » ne vaut qu'à distance ≥ 2. Au contact, la cible riposte normalement.
- **Phalange contre les tirs** : avec les unités actuelles, « encaisser un tir sauf d'archers » ne sert que contre une unité de mêlée qui frappe d'en haut, en séquentiel. En simultané, jamais.
- **Mêlée à 2 cases depuis une hauteur** (séquentiel) : elle est traitée comme un tir, sans riposte. regles.md ne le dit pas (§5 : « 1 case (mêlée) … +1 par niveau »).
- **regles.md §4–§5** : l'usure d'armure (−1 par attaque reçue) et le bonus d'angle sur l'armure de l'attaquant face à la riposte n'y figurent pas.
