# Plan : Ajout des Supersets

## 1. Modèle de données (`src/lib/types.ts`)

Étendre `Exercise` avec un champ optionnel `superset` pour lier deux exercices :

```ts
export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weight?: number;
  supersetWithId?: string; // id du partenaire (B pointe vers A ou inverse)
  supersetRole?: 'A' | 'B'; // rôle dans le superset
  supersetGroupId?: string; // identifiant partagé A+B
}
```

Étendre `SetLog` :
```ts
supersetGroupId?: string;
supersetRole?: 'A' | 'B';
```

Ainsi chaque sous-exercice conserve son propre `exerciseName` → l'historique et les stats agrègent naturellement par nom (Tractions lestées normales + celles en superset ensemble).

## 2. Réglage / Édition programme (`SettingsPanel.tsx`)

- Bouton **« Lier en Superset »** sur un exercice → sélection d'un second exercice de la même séance pour former la paire.
- Rendu groupé : les deux items rendus dans une carte encadrée avec badge **SUPERSET**, un champ commun `sets` (nombre de séries global), et pour chaque sous-exercice ses propres champs `reps` + `weight`.
- Bouton **« Délier »** pour casser le lien.
- Contraintes : `sets` de A et B toujours synchronisés lorsqu'ils sont liés.

## 3. Exécution séance (`WorkoutTab.tsx`)

- Génération des `SetLog` : pour un superset de N séries, créer N paires (A série k, B série k) partageant `supersetGroupId`.
- Rendu : au lieu de deux cartes séparées, une **carte SUPERSET** avec, pour chaque série k, un bloc affichant A au-dessus de B (nom + charge + reps + case validée) et un bouton **« Valider la série »** qui coche les deux d'un coup.
- La propagation de charge (onBlur) reste par exercice individuel (A propage sur les A, B sur les B).
- Rest timer déclenché après validation de la paire.

## 4. Historique & Analytics

- Aucun changement de logique : `StatsTab`, `ExerciseHistory`, PR tracking, `SessionDetailView` et `SessionSummary` regroupent déjà par `exerciseName` normalisé. Les sets en superset apparaissent naturellement dans les stats de leur exercice individuel.
- `SessionDetailView` : afficher un petit badge « Superset » à côté des exercices concernés pour info, sans changer l'agrégation.

## 5. Détails techniques

- Migration douce : champs optionnels, pas de reset du localStorage. Anciennes données restent valides.
- `supersetGroupId` généré via `crypto.randomUUID()`.
- Helper `getSupersetPartner(exercises, exerciseId)` dans `src/lib/superset.ts` pour centraliser la logique de regroupement/rendu.
- Aucune modification du normaliseur d'exercices ni des règles PR.

## Fichiers modifiés
- `src/lib/types.ts` (extension)
- `src/lib/superset.ts` (nouveau — helpers)
- `src/components/SettingsPanel.tsx` (UI lier/délier + rendu groupé)
- `src/components/WorkoutTab.tsx` (génération sets + rendu carte SUPERSET)
- `src/components/SessionDetailView.tsx` (badge visuel superset, optionnel)
