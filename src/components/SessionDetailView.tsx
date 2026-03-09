import { useState } from 'react';
import { SessionLog } from '@/lib/types';
import { ArrowLeft, Star, Clock } from 'lucide-react';

interface SessionDetailViewProps {
  session: SessionLog;
  onClose: () => void;
  onUpdate: (updated: SessionLog) => void;
}

const SessionDetailView = ({ session, onClose, onUpdate }: SessionDetailViewProps) => {
  const [date, setDate] = useState(session.date);
  const [difficulty, setDifficulty] = useState(session.difficulty || 0);
  const [notes, setNotes] = useState(session.notes || '');

  const handleSave = () => {
    onUpdate({ ...session, date, difficulty, notes });
    onClose();
  };

  // Group sets by exercise
  const groupedSets: Record<string, typeof session.sets> = {};
  session.sets.forEach(s => {
    if (!groupedSets[s.exerciseName]) groupedSets[s.exerciseName] = [];
    groupedSets[s.exerciseName].push(s);
  });

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onClose} className="text-muted-foreground touch-target p-1">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-foreground">{session.workoutTypeName}</h1>
      </div>

      {/* Date */}
      <div className="glass-card p-4 mb-4">
        <label className="text-xs text-muted-foreground mb-1.5 block">Date</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none"
        />
      </div>

      {/* Duration */}
      {session.duration !== undefined && (
        <div className="glass-card p-4 mb-4 flex items-center gap-3">
          <Clock size={16} className="text-muted-foreground" />
          <span className="text-sm text-foreground">{session.duration} minutes</span>
        </div>
      )}

      {/* Exercises */}
      <div className="space-y-3 mb-4">
        {Object.entries(groupedSets).map(([name, sets]) => (
          <div key={name} className="glass-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">{name}</h3>
            <div className="space-y-1.5">
              {sets.map((s, i) => (
                <div key={i} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                  <span className="text-xs text-muted-foreground">Set {i + 1}</span>
                  <span className="text-sm text-foreground font-mono">{s.weight} kg × {s.reps}</span>
                  <span className={`text-xs ${s.completed ? 'text-primary' : 'text-muted-foreground'}`}>
                    {s.completed ? '✓' : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Difficulty */}
      <div className="glass-card p-4 mb-4">
        <label className="text-xs text-muted-foreground mb-2 block">Difficulty</label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map(star => (
            <button
              key={star}
              onClick={() => setDifficulty(star)}
              className="touch-target p-1"
            >
              <Star
                size={24}
                className={star <= difficulty ? 'text-warning fill-warning' : 'text-muted-foreground'}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="glass-card p-4 mb-6">
        <label className="text-xs text-muted-foreground mb-1.5 block">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="How did the session go?"
          className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none resize-none min-h-[80px]"
        />
      </div>

      <button
        onClick={handleSave}
        className="w-full bg-primary text-primary-foreground font-semibold py-4 rounded-2xl touch-target text-lg transition-transform active:scale-95"
      >
        Save Changes
      </button>
    </div>
  );
};

export default SessionDetailView;
