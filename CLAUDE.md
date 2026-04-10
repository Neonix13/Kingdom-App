# Kingdom App — Instructions Claude

## Git
- Faire un `git add -A && git commit && git push` régulièrement après chaque groupe de changements significatifs.
- Ne jamais force-push sur main.

## Serveur
- Redémarrer le serveur après toute modification sans demander.
- Utiliser PowerShell pour tuer le process node : `Stop-Process -Id <PID> -Force`

## Général
- Ne pas faire de changements non demandés.
- Ne pas ajouter de commentaires ou docstrings inutiles.
- Quand l'utilisateur dit "screenshot", chercher le fichier le plus récent (par date) dans `~/Downloads/`.
