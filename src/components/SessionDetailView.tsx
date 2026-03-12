import { useState } from 'react';
import { SessionLog, AppData } from '@/lib/types';
import SessionSummary from './SessionSummary';
import { Trash2 } from 'lucide-react';

interface SessionDetailViewProps {
  session: SessionLog;
  data: AppData;
  onClose: () => void;
  onUpdate: (updated: SessionLog) => void;
  onDelete?: (sessionId: string) => void;
}

const SessionDetailView = ({ session, data, onClose, onUpdate, onDelete }: SessionDetailViewProps) => {
  const [showConfirm, setShowConfirm] = useState(false);

  // Filter session to only show completed sets
  const filteredSession: SessionLog = {
    ...session,
    sets: session.sets.filter(s => s.completed),
  };

  return (
    <div className="relative">
      {onDelete && (
        <div className="absolute top-12 right-4 z-10">
          <button
            onClick={() => setShowConfirm(true)}
            className="p-2 text-destructive hover:bg-destructive/10 rounded-xl transition-colors"
          >
            <Trash2 size={20} />
          </button>
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in">
          <div className="glass-card p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-foreground mb-2">Delete session?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to delete this session? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDelete?.(session.id);
                  onClose();
                }}
                className="flex-1 bg-destructive text-destructive-foreground font-medium py-2.5 rounded-xl text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <SessionSummary
        session={filteredSession}
        previousSessions={data.sessions}
        onSave={(updated) => {
          onUpdate(updated);
          onClose();
        }}
        onBack={onClose}
        readOnly
      />
    </div>
  );
};

export default SessionDetailView;
