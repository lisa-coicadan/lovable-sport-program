export type RangeFilter = '1m' | '3m' | 'all';

const RANGE_OPTIONS: { value: RangeFilter; label: string }[] = [
  { value: '1m', label: '1 mois' },
  { value: '3m', label: '3 mois' },
  { value: 'all', label: 'Tout' },
];

export const rangeWeeks = (range: RangeFilter): number | null => (range === '1m' ? 4 : range === '3m' ? 13 : null);

export const rangeCutoffDate = (range: RangeFilter): Date | null => {
  const weeks = rangeWeeks(range);
  if (weeks === null) return null;
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7);
  d.setHours(0, 0, 0, 0);
  return d;
};

const RangeButtons = ({ value, onChange }: { value: RangeFilter; onChange: (v: RangeFilter) => void }) => (
  <div className="flex gap-1">
    {RANGE_OPTIONS.map(opt => (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        className={`touch-target inline-flex items-center justify-center px-2 rounded-lg text-[10px] font-medium transition-colors ${
          value === opt.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

export default RangeButtons;
