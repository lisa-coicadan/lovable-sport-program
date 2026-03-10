import { useState } from 'react';
import { SessionLog } from '@/lib/types';
import { ArrowLeft, ChevronRight } from 'lucide-react';

interface SessionSummaryProps {
  session: SessionLog;
  onSave: (session: SessionLog) => void;
  onBack: () => void;
}

const SessionSummary = ({ session, onSave, onBack }: SessionSummaryProps) => {
  const [duration, setDuration] = useState(session.duration || 0);
  const [difficulty, setDifficulty] = useState(session.difficulty || 5);
  const [notes, setNotes] = useState(session.notes || '');

  const completedSets = session.sets.filter(s => s.completed);
  const totalVolume = completedSets.reduce((acc, s) => acc + s.weight * s.reps, 0);

  const handleSave = () => {
    onSave({ ...session, duration, difficulty, notes });
  };

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground touch-target p-1">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-foreground">Session Complete! 🎉</h1>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-primary">{completedSets.length}</p>
          <p className="text-[10px] text-muted-foreground">Sets Done</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{Math.round(totalVolume)}</p>
          <p className="text-[10px] text-muted-foreground">Total kg</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{duration}</p>
          <p className="text-[10px] text-muted-foreground">Minutes</p>
        </div>
      </div>

      {/* Duration */}
      <div className="glass-card p-4 mb-4">
        <label className="text-xs text-muted-foreground mb-1.5 block">Duration (minutes)</label>
        <input
          type="number"
          value={duration || ''}
          onChange={e => setDuration(e.target.value === '' ? 0 : parseInt(e.target.value))}
          className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono text-center text-lg"
        />
      </div>

      {/* Difficulty 1-10 */}
      <div className="glass-card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <label className="text-xs text-muted-foreground">How did you feel?</label>
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
        className="w-full bg-primary text-primary-foreground font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
      >
        Save Session <ChevronRight size={20} />
      </button>
    </div>
  );
};

export default SessionSummary;
