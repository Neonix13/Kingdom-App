# Mode simultané — proposition de règles (v1)

Objectif : tous les joueurs planifient en même temps, puis tous les ordres se résolvent ensemble. Les règles ci-dessous sont des valeurs par défaut **configurables** (réglages de salle) pour pouvoir les ajuster après essais.

## Déroulé d'un tour
1. **Planification** (minuteur optionnel, défaut 90 s) : chaque joueur donne des ordres à ses unités. Les ordres sont secrets.
2. **Engagement** : chaque joueur valide (« Ordres prêts »). Quand tous ont validé, ou que le minuteur expire, la résolution démarre. Un joueur déconnecté = ses unités tiennent leur position.
3. **Résolution** côté serveur, en **ticks** ; le serveur produit une chronologie d'événements (déplacements, contacts, tirs, combats, fuites).
4. **Lecture** : les clients rejouent la chronologie (animation 2D/3D), puis un nouveau tour commence.

## Ordres
- **Points de commandement** : nombre d'unités pouvant recevoir un ordre par tour = `2 + ⌈Stratégie du général / 3⌉` (configurable). Les unités sans ordre **tiennent** (restent sur place, réagissent selon leur posture).
- Types d'ordre : **Déplacer** (chemin dans la limite de vitesse), **Attaquer** une unité (mêlée : se déplace jusqu'au contact puis frappe ; tir : à portée), **Charger** (déplacement + attaque avec bonus de charge si ≥ 2 cases parcourues), **Tenir** (ne bouge pas), **Changer de posture**, **Pivoter**, **Capacité du général**, **Motiver**.
- Un ordre vise une **unité** (suivie si elle bouge) ou une **case**.

## Résolution en ticks
- Chaque tick, chaque unité en mouvement avance d'**une case** si son budget de vitesse le permet (coût de terrain/segments identique au mode classique ; la cavalerie dispose donc de plus de ticks).
- Ordre de traitement d'un tick : (1) tirs de réaction, (2) déplacements simultanés, (3) détection des contacts, (4) combats de mêlée.
- **Conflits de case** :
  - Deux unités **ennemies** visent la même case au même tick : aucune n'y entre, elles restent sur leur case précédente et **s'affrontent** (mêlée de rencontre).
  - Deux unités **alliées** : priorité à la plus rapide (puis à l'initiative du joueur), l'autre attend un tick.
  - **Croisement** (A va sur la case de B pendant que B va sur celle de A) : elles se rencontrent à mi-chemin → mêlée de rencontre, chacune reste sur sa case.
  - Entrer sur la case d'un ennemi immobile : impossible ; l'unité s'arrête au contact et l'attaque (avec bonus de charge si elle chargeait).
- **Zone de contrôle** : une unité qui arrive au contact d'un ennemi s'arrête (sauf posture *Percée* qui peut continuer d'un tick si elle remporte la mêlée).
- **Tirs** : résolus au tick où la cible est à portée et en vue ; si la cible sort de portée avant, le tir est perdu (« tir manqué »). Une unité qui tire ne se déplace pas ce tour.

## Postures (réactions)
| Posture | Réaction pendant la résolution |
|---|---|
| Marche | +1 vitesse ; malus en défense si elle est engagée en mouvement |
| Combat | Standard |
| Charge | Bonus de puissance au premier contact après ≥ 2 cases ; vulnérable aux lanciers (annule le bonus, malus) |
| Percée | Peut poursuivre d'une case après une mêlée gagnée ; défense réduite |
| Déf. combat | Riposte gratuite contre toute unité qui l'attaque en mêlée ; annule le bonus de charge adverse |
| Déf. distance | Dégâts de tir réduits ; tireurs en Déf. distance font un **tir de réaction** sur la première unité ennemie qui entre à portée |

## Brouillard et information
- Les ordres adverses ne sont jamais envoyés avant la résolution.
- La chronologie envoyée à chaque joueur est **filtrée par sa vision** (il ne voit que les événements dans ses cases visibles, à chaque tick).
- Les unités en forêt/bâtiment restent cachées tant qu'aucune unité ennemie n'est adjacente (embuscades) ; une unité cachée qui attaque se révèle.

## Fin de partie
Identique au mode classique (général tué, ou objectifs si la carte en définit), avec une limite de tours configurable.

## Réglages de salle proposés
`mode: 'sequential' | 'simultaneous'`, `planningTimer` (s, 0 = aucun), `commandPoints` (formule ou nombre fixe), `maxTurns`.
