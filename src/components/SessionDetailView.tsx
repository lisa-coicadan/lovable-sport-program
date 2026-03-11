import { SessionLog, AppData } from '@/lib/types';
import SessionSummary from './SessionSummary';

interface SessionDetailViewProps {
  session: SessionLog;
  data: AppData;
  onClose: () => void;
  onUpdate: (updated: SessionLog) => void;
}

const SessionDetailView = ({ session, data, onClose, onUpdate }: SessionDetailViewProps) => {
  return (
    <SessionSummary
      session={session}
      previousSessions={data.sessions}
      onSave={(updated) => {
        onUpdate(updated);
        onClose();
      }}
      onBack={onClose}
      readOnly
    />
  );
};

export default SessionDetailView;
