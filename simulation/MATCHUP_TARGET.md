# Tableau de Matchup Cible — Référence Design

Créé par l'auteur du jeu. Référence pour calibrer les stats des unités.

**Légende :**
- `gagne` = cette unité gagne clairement
- `perd` = cette unité perd clairement
- `close` = combat serré, peut aller des deux côtés
- `init+` = l'initiative donne un avantage décisif
- `dist+` = la distance / portée donne un avantage (pour les archers)

**Lecture :** Ligne = unité qui initie / a l'initiative. Colonne = adversaire.

| Initiative \ Second | Piétaille | Soldats | Espion | Archer | Phalange | Lancier | Assassin | Cav. Léger | Arch. Élite | Bâtisseurs | Cav. Lourd | Char |
|---------------------|-----------|---------|--------|--------|----------|---------|----------|------------|-------------|------------|------------|------|
| **Piétaille**       | close     | perd    | gagne  | gagne  | perd     | perd    | perd     | perd       | close init+ | gagne      | perd       | perd |
| **Soldats**         | gagne     | close   | gagne  | gagne  | close init+ | close init+ | gagne | close init+ | gagne   | gagne      | close      | perd |
| **Espion**          | close init+ | perd  | close init+ | close init+ | perd | perd | perd    | perd       | perd        | close init+ | perd      | perd |
| **Archer**          | gagne     | close init+ dist+ | gagne | close | perd | perd close init+ | perd close init+ | perd | perd | gagne | perd | perd |
| **Phalange**        | gagne     | close init+ | gagne | gagne | close    | close init+ | gagne | perd close init+ | gagne | gagne  | close init+ | perd close init+ |
| **Lancier**         | gagne     | gagne   | gagne  | gagne  | close init+ | close | close init+ | gagne    | gagne       | gagne      | gagne init+ | gagne init+ |
| **Assassin**        | gagne     | gagne init+ | gagne | gagne | gagne init+ | gagne init+ | initiative gagne | gagne init+ | gagne | gagne | gagne init+ | close init+ |
| **Cav. Léger**      | gagne     | gagne init+ | gagne | gagne | close init+ | perd  | gagne    | close init+ | gagne      | gagne      | perd       | perd |
| **Arch. Élite**     | gagne     | gagne init+ | gagne | gagne | perd      | close init+ | perd | perd       | close       | gagne      | perd       | perd |
| **Bâtisseurs**      | perd      | perd    | perd   | perd   | perd     | perd    | perd     | perd       | perd        | close      | perd       | perd |
| **Cav. Lourd**      | gagne     | gagne   | gagne  | gagne  | gagne init+ | perd close init+ | gagne | gagne | gagne      | gagne      | close init+ | close init+ |
| **Char**            | gagne     | gagne   | gagne  | gagne  | close init+ | close init+ | gagne | gagne     | gagne       | gagne      | gagne init+ | close init+ |

## Observations clés

- **Lancier** : bat presque tout le monde, surtout la cavalerie. Référence offensive.
- **Assassin** : gagne ou a init+ sur tout le monde — unité très forte avec l'initiative.
- **Cavalier Lourd** : très solide, perd seulement contre Lancier (close init+).
- **Char** : écrase tout sauf Lancier (close init+) et Phalange (close init+).
- **Phalange** : tank défensif, perd contre Lancier, Char, et Cavalier Léger avec init.
- **Bâtisseurs** : perd tout sauf close vs lui-même — utilitaire pur.
- **Piétaille** : faible en duel, rôle de masse.
- **Espion** : fragile, n'a l'avantage que sur lui-même et via l'initiative.
