# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Strength & Calisthenics Tracker — notes projet

## Commandes
- `npm run dev` — serveur de dev (Vite, port 8080)
- `npm run build` — build de prod ; `npm run build:dev` — build en mode dev
- `npm run lint` — ESLint (`@typescript-eslint/no-unused-vars` est désactivé, et `noUnusedLocals`/`noUnusedParameters`/`strictNullChecks`/`noImplicitAny` sont tous `false` dans les tsconfig — le typage est volontairement permissif, ne pas compter sur `tsc`/ESLint pour rattraper ce genre d'erreurs)
- `npm test` — Vitest (run once) ; `npm run test:watch` — mode watch ; un seul fichier : `npx vitest run src/lib/cluster.test.ts`
- **Vérification de types : `npx tsc -p tsconfig.app.json --noEmit`.** ⚠️ `npx tsc --noEmit` à la racine ne détecte RIEN (le `tsconfig.json` racine a `"files": []` avec de simples project references) — toujours passer `-p tsconfig.app.json` explicitement, sinon des erreurs de type (import cassé, etc.) passent inaperçues.
- Playwright est configuré (`playwright.config.ts`, via le package `lovable-agent-playwright-config` fourni par Lovable) mais il n'y a aucun fichier de spec `.spec.ts` dans le repo à ce jour — la suite de tests réelle est Vitest.
- Trois lockfiles committés (`bun.lock`, `bun.lockb`, `package-lock.json`) — gérés par le pipeline Lovable. Ne pas en supprimer sans vérifier que ça ne casse pas le build côté Lovable.

## Architecture

### État global : une seule source de vérité, pas de Context/Redux
`src/pages/Index.tsx` détient tout `AppData` dans un simple `useState`, le repasse en props à chaque onglet (`CalendarTab`/`WorkoutTab`/`StatsTab`), et le persiste en entier dans `localStorage` à chaque changement (`useEffect` → `saveData`). `WorkoutTab` reste monté en permanence (`display: none` plutôt que démonté) quand on bascule d'onglet, pour ne pas perdre le timer ni les séries en cours d'une séance active.

### Schéma des données (`src/lib/types.ts`)
`AppData.workoutTypes[].exercises[]` — chaque `Exercise` peut avoir un `method?: ExerciseMethod` optionnel, union discriminée `'531' | 'cluster' | 'emom'`. Les champs propres à chaque méthode sont presque tous optionnels, avec un getter de fallback (`getClusterConfig`/`getEmomConfig` dans `src/lib/cluster.ts`/`emom.ts`) qui applique les valeurs par défaut si absentes — ce pattern permet de faire évoluer le schéma sans jamais écrire de migration. `storage.ts` migre au chargement l'ancien format global (`AppData.fiveThreeOne` + `squatSessionId`) vers ce modèle par-exercice, de façon idempotente ; ces deux champs ne sont plus jamais écrits par du code neuf.

### Logique métier isolée dans `src/lib/*.ts`
Chaque règle non triviale vit dans un module pur (aucune dépendance React), avec son `*.test.ts` à côté : `531.ts` (séries par semaine), `cluster.ts`/`emom.ts` (presets, calcul du %TM), `superset.ts` (lie deux exercices en un bloc qui partage son nombre de séries), `exerciseNormalize.ts` (regroupe les variantes d'orthographe/abréviation pour les stats — volontairement AUCUNE conversion de charge entre variantes d'équipement, gardées strictement séparées), `notesParser.ts` (notes libres → séance structurée, réutilisé à l'onboarding et dans Réglages), `weightRounding.ts` (arrondi par palier selon l'ampleur de la charge), `trainingMax.ts` (1RM de Brzycki + TM à 90%, distinct du 1RM d'Epley déjà dans `types.ts` qui sert au suivi de progression des séances — ne pas les confondre). Toute nouvelle règle de calcul doit suivre ce pattern plutôt qu'être codée en dur dans un composant.

### `WorkoutTab.tsx` — le composant le plus dense
Machine à états locale (`mode: 'select' | 'recap' | 'summary' | 'settings' | 'history'`). Cluster/EMOM/Normal peut être changé pour la séance en cours sans toucher à la config par défaut de l'exercice (`methodOverrides`, state React pur, jamais persisté dans `AppData`) — voir `getEffectiveMethod`/`resolveOverrideMethod`/`applyMethodOverride`/`buildSetsForExercise`. Le 5/3/1 reste toujours un programme permanent, jamais overridable en séance (contrairement à Cluster/EMOM, il a un vrai cycle/semaine qui avance et se persiste).

### UI
- `src/components/ui/` = shadcn/ui vendored — ne pas modifier à la main sauf besoin réel ; quelques erreurs/warnings ESLint pré-existants y vivent (interfaces vides, exports non-composants), c'est un baseline connu du boilerplate shadcn, pas une régression à corriger en passant.
- Thème sombre uniquement, tokens de couleur en HSL dans `src/index.css` (`--primary`, `--accent-purple`, `--accent-blue`, `--success`/`--destructive` réservés à la progression/régression dans les récaps), coquille mobile-first (`max-w-lg mx-auto`).
- PWA via `vite-plugin-pwa` — nom/icônes du manifest configurés dans `vite.config.ts` (pas de fichier `manifest.json` séparé à éditer).

## Données utilisateur
- Stockage 100% local (`localStorage`, clé `fitness-tracker-data`, voir `src/lib/storage.ts`). Pas de backend.
- L'utilisatrice a des séances réelles enregistrées sur son iPhone (PWA). Ne jamais risquer cette donnée.
- **Avant toute modification qui touche `AppData`, `SessionLog`, `storage.ts`, ou toute logique de migration/format de données : s'arrêter et rappeler explicitement d'exporter un JSON de sauvegarde (bouton export existant dans Settings) avant de déployer.** Attendre confirmation.
- **Un `git push` sur `main` NE suffit PAS à mettre à jour le site en ligne.** Lovable reçoit bien le commit (visible dans son historique de chat) mais ne le publie pas automatiquement — il faut cliquer sur **"Publish" dans l'interface Lovable** pour que la build en attente parte en production. Sans ce clic, `musculisa.lovable.app` (et donc la PWA sur iPhone) reste bloqué sur l'ancienne version, même après plusieurs commits. Toujours rappeler à l'utilisatrice de publier après un push si elle veut voir les changements sur son téléphone. Le code déployé ne touche jamais au `localStorage` existant, sauf bug de migration — d'où la prudence sur l'export JSON ci-dessus.
- Ne jamais pousser sur `main` sans confirmation explicite de l'utilisatrice, même si le commit local est fait.

## Architecture multi-utilisateurs
- Décision actée : pas de comptes/auth pour l'instant. Le partage avec des amis se fait via l'isolation naturelle du `localStorage` par appareil/navigateur (chaque ami installe la PWA sur son propre téléphone = données déjà séparées, zéro backend nécessaire).
- Si une vraie synchronisation multi-appareils par utilisateur est demandée un jour, c'est un chantier à part (auth + DB, ex. Supabase) — ne pas l'improviser dans une petite modif.
