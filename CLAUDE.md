# Strength & Calisthenics Tracker — notes projet

## Données utilisateur
- Stockage 100% local (`localStorage`, clé `fitness-tracker-data`, voir `src/lib/storage.ts`). Pas de backend.
- L'utilisatrice a des séances réelles enregistrées sur son iPhone (PWA). Ne jamais risquer cette donnée.
- **Avant toute modification qui touche `AppData`, `SessionLog`, `storage.ts`, ou toute logique de migration/format de données : s'arrêter et rappeler explicitement d'exporter un JSON de sauvegarde (bouton export existant dans Settings) avant de déployer.** Attendre confirmation.
- **Un `git push` sur `main` NE suffit PAS à mettre à jour le site en ligne.** Lovable reçoit bien le commit (visible dans son historique de chat) mais ne le publie pas automatiquement — il faut cliquer sur **"Publish" dans l'interface Lovable** pour que la build en attente parte en production. Sans ce clic, `musculisa.lovable.app` (et donc la PWA sur iPhone) reste bloqué sur l'ancienne version, même après plusieurs commits. Toujours rappeler à l'utilisatrice de publier après un push si elle veut voir les changements sur son téléphone. Le code déployé ne touche jamais au `localStorage` existant, sauf bug de migration — d'où la prudence sur l'export JSON ci-dessus.
- Ne jamais pousser sur `main` sans confirmation explicite de l'utilisatrice, même si le commit local est fait.

## Architecture multi-utilisateurs
- Décision actée : pas de comptes/auth pour l'instant. Le partage avec des amis se fait via l'isolation naturelle du `localStorage` par appareil/navigateur (chaque ami installe la PWA sur son propre téléphone = données déjà séparées, zéro backend nécessaire).
- Si une vraie synchronisation multi-appareils par utilisateur est demandée un jour, c'est un chantier à part (auth + DB, ex. Supabase) — ne pas l'improviser dans une petite modif.

## Lockfiles
- Trois lockfiles committés (`bun.lock`, `bun.lockb`, `package-lock.json`) — géré par le pipeline Lovable. Ne pas en supprimer sans vérifier que ça ne casse pas le build côté Lovable.
