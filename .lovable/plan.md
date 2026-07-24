# Plan — corrections fines et multi-programmes

⚠️ **Avant déploiement** : ce plan modifie `AppData` (ajout d'un champ `programs` + `activeProgramId`, migration à partir de `workoutTypes` existant) et `Exercise` (nouveaux attributs `unilateral`, `equipment`). **Exporte un JSON de sauvegarde depuis Réglages > Sauvegarde avant de publier.** Toutes les migrations seront idempotentes et testées.

## 1. Normalisation stricte des variantes Squat

**`src/lib/exerciseNormalize.ts`**
- Retirer `front squat` de la règle "Squat" et créer des règles séparées non-PR pour : Front Squat, Hack Squat, Split Squat, Bulgarian Split Squat, Goblet Squat.
- `Squat` reste PR-tracked (barbell back squat uniquement).
- `RDL` : garder l'équivalence existante (barre + haltère fusionnés — spécifiquement demandé).
- `DC / Bench` : équivalence conservée (déjà en place).
- Ajouter tests dans `exerciseNormalize.test.ts` pour chaque variante Squat isolée.

## 2. Attributs d'exercice (unilateral + équipement)

**`src/lib/types.ts`** :
```ts
Exercise += {
  unilateral?: boolean;
  equipment?: 'barre' | 'halteres' | 'machine' | 'smith' | 'poulie';
}
```
- Badges affichés dans WorkoutTab et SettingsPanel (petits chips à côté du nom).
- **Non fusionnés** dans l'historique : c'est purement de l'affichage. `normalizeExerciseName` continue de gérer l'équipement via le nom (comportement inchangé).

## 3. Multi-programmes

**`src/lib/types.ts`** :
```ts
interface Program { id: string; name: string; workoutTypeIds: string[]; }
AppData += { programs: Program[]; activeProgramId: string | null; }
```

**Migration (`storage.ts`)** : au chargement, si `programs` absent → créer un programme "Mon programme" contenant tous les `workoutTypes` existants et le marquer actif.

**Onboarding (`SetupWizard.tsx`)** : première étape ajoutée "Nom du programme".

**Réglages (`SettingsPanel.tsx`)** : nouvelle section en haut "Programme actif" avec sélecteur + boutons *Créer nouveau* / *Renommer* / *Supprimer*.

**Filtrage** : `WorkoutTab` et `CalendarTab` ne montrent que les workoutTypes du programme actif. Les sessions historiques restent visibles partout (elles ne sont pas filtrées par programme, sinon on perd l'historique en changeant).

## 4. Tonnage 5/3/1 / Cluster / EMOM

**Vérification** : le tonnage est déjà calculé depuis `session.sets` (Poids × Reps). Bug identifié : Cluster/EMOM génèrent les sets via `buildSetsForExercise` — vérifier que **chaque mini-série cluster et chaque minute EMOM produit bien un `SetLog` persisté** avec le bon poids. Corriger si besoin dans `WorkoutTab.tsx`.

## 5. Graphique 1RM par exercice 5/3/1/Cluster/EMOM

**`StatsTab.tsx`** : nouvelle section "Progression 1RM (méthodes structurées)" — un mini line chart par exercice qui a une `method` définie, montrant l'e1RM max par séance (formule Epley déjà utilisée).

## 6. Comparatif tonnage enrichi

**`SessionSummary.tsx`** : sous le comparatif "vs dernière séance", ajouter une ligne "vs moyenne (N séances)" — moyenne du tonnage de toutes les sessions passées du même `workoutTypeId`.

## 7. Config souple EMOM/Cluster

**`SettingsPanel.tsx`** — dans le modal méthode :
- Nouveau toggle en haut : `◯ Paramétrer à chaque séance` / `◉ Créer un pattern par défaut`.
- Mode "à chaque séance" : ne persiste que `{ type, trainingMax }` (fields optionnels laissés vides). `getClusterConfig` / `getEmomConfig` gèrent déjà les defaults — comportement inchangé côté runtime.
- Mode "pattern" : UI actuelle inchangée.

## 8. Correctifs UI/UX

- **Bouton "+ Méthode"** : remplacer le grand bandeau par un petit bouton texte discret aligné en bas à droite du bloc exercice, dans SetupWizard et SettingsPanel.
- **Presets Cluster** : le bouton preset sélectionné doit avoir un état visuel évident (bg-primary + text-primary-foreground + ring). Fix dans SettingsPanel modal.
- **TM = 0** : retirer l'alerte "Sans Training Max…". À la place :
  - Désactiver le bouton *Enregistrer* du modal méthode si `trainingMax <= 0`.
  - Mettre en avant le lien vers le calculateur TM (déjà présent) avec un style plus visible (bouton plein, pas juste un lien).

## Détails techniques

**Ordre d'exécution des edits (parallélisable)** :
1. `types.ts` + `storage.ts` (migration programs + attributs Exercise)
2. `exerciseNormalize.ts` + tests (variantes Squat)
3. `SetupWizard.tsx` (nom du programme en étape 1)
4. `SettingsPanel.tsx` (sélecteur programme, badges attributs, bouton méthode discret, presets cluster surlignés, toggle pattern/à-la-séance, gating TM=0)
5. `WorkoutTab.tsx` (filtrage par programme actif, badges attributs, vérif SetLog pour cluster/EMOM)
6. `CalendarTab.tsx` (filtrage workoutTypes du programme actif pour l'ajout)
7. `StatsTab.tsx` (nouveau graphique 1RM par exercice 5/3/1/cluster/emom)
8. `SessionSummary.tsx` (comparatif vs moyenne)

**Vérification** : `npm test` + `npx tsc -p tsconfig.app.json --noEmit` après implémentation.

**Non touché** :
- Format existant des SessionLog (rétro-compat totale)
- Stockage localStorage (clé et structure existante préservées + champs ajoutés)
- Logique 5/3/1 cycle/increment (déjà correcte)
