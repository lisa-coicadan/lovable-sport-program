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
  const [duration, setDuration] = useState(session.duration || 0);
  const [difficulty, setDifficulty] = useState(session.difficulty || 0);
  const [notes, setNotes] = useState(session.notes || '');

  const handleSave = () => {
    onUpdate({ ...session, date, duration, difficulty, notes });
    onClose();
  };

  // Only show completed exercises
  const completedSets = session.sets.filter(s => s.completed);
  const groupedSets: Record<string, typeof completedSets> = {};
  completedSets.forEach(s => {
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

      {/* Duration — editable */}
      <div className="glass-card p-4 mb-4">
        <label className="text-xs text-muted-foreground mb-1.5 block">Duration (minutes)</label>
        <div className="flex items-center gap-3">
          <Clock size={16} className="text-muted-foreground" />
          <input
            type="number"
            value={duration || ''}
            onChange={e => setDuration(e.target.value === '' ? 0 : parseInt(e.target.value))}
            className="flex-1 bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono text-center"
          />
        </div>
      </div>

      {/* Exercises — only completed */}
      {Object.keys(groupedSets).length > 0 ? (
        <div className="space-y-3 mb-4">
          {Object.entries(groupedSets).map(([name, sets]) => (
            <div key={name} className="glass-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">{name}</h3>
              <div className="space-y-1.5">
                {sets.map((s, i) => (
                  <div key={i} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                    <span className="text-xs text-muted-foreground">Set {i + 1}</span>
                    <span className="text-sm text-foreground font-mono">{s.weight} kg × {s.reps}</span>
                    <span className="text-xs text-primary">✓</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card p-4 mb-4 text-center">
          <p className="text-sm text-muted-foreground">No exercises completed in this session.</p>
        </div>
      )}

      {/* Difficulty 1-10 */}
      <div className="glass-card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <label className="text-xs text-muted-foreground">Difficulty</label>
          <span className="text-sm font-bold text-foreground">{difficulty}/10</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          value={difficulty}
          onChange={e => setDifficulty(parseInt(e.target.value))}
          className="w-full accent-primary h-2"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>Easy</span>
          <span>Hard</span>
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
