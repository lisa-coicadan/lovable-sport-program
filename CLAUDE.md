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
`src/pages/Index.tsx` détient tout `AppData` dans un simple `useState`, le repasse en props à chaque onglet (`CalendarTab`/`WorkoutTab`/`StatsTab`), et le persiste en entier dans `localStorage` à chaque changement (`useEffect` → `saveData`). `WorkoutTab` reste monté en permanence (`display: none` plutôt que démonté) quand on bascule d'onglet, pour ne pas perdre le timer ni les séries en cours d'une séance active. Les écrans secondaires (détail/édition/partage d'une séance passée, historique par exercice, récap de fin de séance) sont des vues conditionnelles pilotées par du state local (`SessionDetailView`/`ExerciseHistory`/`SessionSummary`), pas des routes — il n'y a aucun routing applicatif malgré `react-router-dom` et `@tanstack/react-query` présents dans `src/App.tsx` : c'est du boilerplate du scaffold Lovable (une seule route catch-all vers `Index`, `QueryClientProvider` sans aucune query réelle), pas une architecture à suivre pour de nouveaux écrans.

### Schéma des données (`src/lib/types.ts`)
`AppData.workoutTypes[].exercises[]` — chaque `Exercise` peut avoir un `method?: ExerciseMethod` optionnel, union discriminée `'531' | 'cluster' | 'emom'`. Les champs propres à chaque méthode sont presque tous optionnels, avec un getter de fallback (`getClusterConfig`/`getEmomConfig` dans `src/lib/cluster.ts`/`emom.ts`) qui applique les valeurs par défaut si absentes — ce pattern permet de faire évoluer le schéma sans jamais écrire de migration. `storage.ts` migre au chargement l'ancien format global (`AppData.fiveThreeOne` + `squatSessionId`) vers ce modèle par-exercice, de façon idempotente ; ces deux champs ne sont plus jamais écrits par du code neuf.

### Logique métier isolée dans `src/lib/*.ts`
Chaque règle non triviale vit dans un module pur (aucune dépendance React), avec son `*.test.ts` à côté : `531.ts` (séries par semaine), `cluster.ts`/`emom.ts` (presets, calcul du %TM), `dropset.ts` (cascade calculée depuis la série ancrée réellement faite en séance, pas depuis une TM — chaque palier est relatif à l'ancre d'origine, pas au palier précédent), `superset.ts` (lie deux exercices en un bloc qui partage son nombre de séries), `exerciseNormalize.ts` (regroupe les variantes d'orthographe/abréviation pour les stats — volontairement AUCUNE conversion de charge entre variantes d'équipement, gardées strictement séparées), `notesParser.ts` (notes libres → séance structurée, réutilisé à l'onboarding et dans Réglages), `weightRounding.ts` (arrondi par palier selon l'ampleur de la charge), `trainingMax.ts` (1RM de Brzycki + TM à 90%, distinct du 1RM d'Epley déjà dans `types.ts` qui sert au suivi de progression des séances — ne pas les confondre), `cardio.ts` (allure/durée cardio, `durationMinutes` stocké en minutes décimales), `strengthStandards.ts` (barèmes de référence France/records statiques fournis par l'utilisatrice, comparés localement à son poids/genre — comparaison uniquement sur la variante barre/poids de corps via `exerciseNormalize.ts`, jamais machine/assisté). Toute nouvelle règle de calcul doit suivre ce pattern plutôt qu'être codée en dur dans un composant.

### `WorkoutTab.tsx` — le composant le plus dense
Machine à états locale (`mode: 'select' | 'recap' | 'summary' | 'settings' | 'history'`). Cluster/EMOM/Normal peut être changé pour la séance en cours sans toucher à la config par défaut de l'exercice (`methodOverrides`, state React pur, jamais persisté dans `AppData`) — voir `getEffectiveMethod`/`resolveOverrideMethod`/`applyMethodOverride`/`buildSetsForExercise`. Le 5/3/1 reste toujours un programme permanent, jamais overridable en séance (contrairement à Cluster/EMOM, il a un vrai cycle/semaine qui avance et se persiste). L'écran le plus dense en usage réel (mid-set, une main, au gym) : soigner les zones de clic (44px min) et ne pas ajouter de friction y compris quand on est tenté de « juste nettoyer » un peu la densité.

### `SortableBlock.tsx` — partagé entre `WorkoutTab` et `SettingsPanel`
`DragHandle` et `SortableList` (réordonnancement tactile) sont un seul composant importé par les deux écrans — toucher à sa taille, son style ou son comportement affecte l'un ET l'autre. Vérifier les deux avant de modifier.

### Image de séance partagée (`SessionDetailView.tsx`, `handleShare`)
Générée via un `<canvas>`, donc aucune classe Tailwind ni variable CSS (`var(--primary)`) n'est utilisable directement dans les `fillStyle` — les couleurs sont lues en direct via `getComputedStyle(document.documentElement).getPropertyValue('--xxx')` pour rester synchronisées avec le thème réel. Piège vécu : `` `hsla(${color}, 0.12)` `` où `color` est déjà un triplet espace (`"189 94% 55%"`) lève une exception silencieuse dans `canvas` (mélange syntaxe legacy virgule / moderne espace) — utiliser `` `hsl(${color} / 0.12)` `` (slash, pas virgule) pour l'alpha. Toujours tester ce flow en conditions réelles (clic sur Partager) après une modif, l'erreur ne remonte que dans la console, pas visuellement.

### UI
- `src/components/ui/` = shadcn/ui vendored — ne pas modifier à la main sauf besoin réel ; quelques erreurs/warnings ESLint pré-existants y vivent (interfaces vides, exports non-composants), c'est un baseline connu du boilerplate shadcn, pas une régression à corriger en passant.
- Thème sombre uniquement (identité « Cyber-Performance » : trio néon cyan/violet/magenta), tokens de couleur en HSL dans `src/index.css` (`--primary`, `--accent-purple`, `--accent-blue`, `--success`/`--destructive` réservés à la progression/régression dans les récaps), coquille mobile-first (`max-w-lg mx-auto`).
- `:focus-visible` est déclaré volontairement hors de tout `@layer` en tête de `src/index.css` (juste après les `@tailwind`) : les cascade layers Tailwind font perdre n'importe quelle règle `@layer base` face à l'utilitaire `outline-none` (layer utilities), même avec moins de spécificité — ne pas re-déplacer cette règle dans `@layer base` sans revérifier que le focus clavier survit sur tous les inputs.
- PWA via `vite-plugin-pwa` — nom/icônes du manifest configurés dans `vite.config.ts` (pas de fichier `manifest.json` séparé à éditer).

### Workflow de design (`/impeccable`)
Le repo utilise le skill `impeccable` (`.claude/skills/impeccable/`) pour tout le travail de design/UX — `PRODUCT.md` à la racine est sa source de vérité produit (persona, positionnement, principes), généré et maintenu par `/impeccable init`. Pas de `DESIGN.md` séparé à ce jour : le système visuel vit dans le code (`src/index.css`, `tailwind.config.ts`) et fait foi. Un hook de détection tourne après les édits de fichiers UI (config dans `.impeccable/config.json`) ; ses ignores enregistrés (ex. `overused-font: space grotesk`) sont des faux positifs déjà tranchés, pas des règles à réappliquer.

## Données utilisateur
- Stockage 100% local (`localStorage`, clé `fitness-tracker-data`, voir `src/lib/storage.ts`). Pas de backend.
- L'utilisatrice a des séances réelles enregistrées sur son iPhone (PWA). De plus en plus de ses amis utilisent désormais l'applications, chacuns ont dont des données personnelles sur leur iphone (PWA). Ne jamais risquer ces données.
- **Avant toute modification qui touche `AppData`, `SessionLog`, `storage.ts`, ou toute logique de migration/format de données : s'arrêter et rappeler explicitement d'exporter un JSON de sauvegarde (bouton export existant dans Settings) avant de déployer.** Attendre confirmation. Il ne faut jamais push sur main sans demander cette confirmation s'il y a un risque pour les données JSON. 
- **Un `git push` sur `main` NE suffit PAS à mettre à jour le site en ligne.** Lovable reçoit bien le commit (visible dans son historique de chat) mais ne le publie pas automatiquement — il faut cliquer sur **"Publish" dans l'interface Lovable** pour que la build en attente parte en production. Sans ce clic, `musculisa.lovable.app` (et donc la PWA sur iPhone) reste bloqué sur l'ancienne version, même après plusieurs commits. Toujours rappeler à l'utilisatrice de publier après un push si elle veut voir les changements sur son téléphone. Le code déployé ne touche jamais au `localStorage` existant, sauf bug de migration — d'où la prudence sur l'export JSON ci-dessus.

## Architecture multi-utilisateurs
- Décision actée : pas de comptes/auth pour l'instant. Le partage avec des amis se fait via l'isolation naturelle du `localStorage` par appareil/navigateur (chaque ami installe la PWA sur son propre téléphone = données déjà séparées, zéro backend nécessaire).
- Si une vraie synchronisation multi-appareils par utilisateur est demandée un jour, c'est un chantier à part (auth + DB, ex. Supabase) — ne pas l'improviser dans une petite modif.
