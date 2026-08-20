import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkoutTab from './WorkoutTab';
import { AppData, WorkoutType, DEFAULT_APP_DATA } from '@/lib/types';

// Modeled on src/lib/deload.test.ts's data(overrides) helper — DEFAULT_APP_DATA already
// satisfies every non-optional AppData field, so tests only override what they exercise.
function appData(overrides: Partial<AppData>): AppData {
  return { ...DEFAULT_APP_DATA, ...overrides };
}

function workoutType(overrides: Partial<WorkoutType> & Pick<WorkoutType, 'exercises'>): WorkoutType {
  return {
    id: 'wt1',
    name: 'Push',
    color: '189 94% 55%',
    ...overrides,
  };
}

describe('WorkoutTab — démarrage de séance et validation de séries', () => {
  it('démarre une séance et affiche un bouton Valider par série prescrite', () => {
    const data = appData({
      workoutTypes: [workoutType({ exercises: [{ id: 'ex1', name: 'Développé couché', sets: 3, reps: 8 }] })],
    });
    render(<WorkoutTab data={data} onSaveSession={vi.fn()} onUpdateData={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /démarrer la séance/i }));

    expect(screen.getByLabelText('Valider Série 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Valider Série 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Valider Série 3')).toBeInTheDocument();
  });

  it('valider une série la marque comme complétée et met à jour la progression rapportée au parent', () => {
    const onProgressChange = vi.fn();
    const data = appData({
      workoutTypes: [workoutType({ exercises: [{ id: 'ex1', name: 'Développé couché', sets: 2, reps: 8 }] })],
    });
    render(
      <WorkoutTab data={data} onSaveSession={vi.fn()} onUpdateData={vi.fn()} onProgressChange={onProgressChange} />
    );

    fireEvent.click(screen.getByRole('button', { name: /démarrer la séance/i }));
    onProgressChange.mockClear();

    fireEvent.click(screen.getByLabelText('Valider Série 1'));

    const validated = screen.getByLabelText('Série 1 validée');
    expect(validated).toHaveAttribute('aria-pressed', 'true');
    expect(onProgressChange).toHaveBeenCalledWith(0.5);
  });
});

describe('WorkoutTab — changement de méthode en cours de séance (override, jamais persisté)', () => {
  it('repasser un exercice Cluster en Normal régénère ses séries sans toucher la config par défaut de l\'exercice', () => {
    const data = appData({
      workoutTypes: [
        workoutType({
          exercises: [
            {
              id: 'ex1',
              name: 'Tractions',
              sets: 3,
              reps: 5,
              method: { type: 'cluster', trainingMax: 60 },
            },
          ],
        }),
      ],
    });
    render(<WorkoutTab data={data} onSaveSession={vi.fn()} onUpdateData={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /démarrer la séance/i }));

    // En Cluster : les mini-séries sont des boutons poids×reps, pas de "Valider Série N".
    expect(screen.queryByLabelText(/valider série/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Normal' }));

    // Repassé en Normal : buildSetsForExercise régénère ex.sets (3) séries classiques.
    expect(screen.getByLabelText('Valider Série 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Valider Série 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Valider Série 3')).toBeInTheDocument();

    // L'override est un state React local à la séance (methodOverrides) — la méthode
    // par défaut de l'exercice dans AppData ne doit jamais être modifiée par ce switch.
    expect(data.workoutTypes[0].exercises[0].method?.type).toBe('cluster');
  });
});
