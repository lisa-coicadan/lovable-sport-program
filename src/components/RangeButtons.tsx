export type RangeFilter = '1m' | '3m' | '6m' | 'all';

const RANGE_LABELS: Record<RangeFilter, string> = {
  '1m': '1 mois',
  '3m': '3 mois',
  '6m': '6 mois',
  all: 'Tout',
};

// '6m' is opt-in via the `options` prop (see the monthly-time chart in StatsTab) rather
// than always shown — every other chart using this component (weekly volume, difficulty,
// pace...) keeps its existing 3-button layout unless it explicitly asks for more.
const DEFAULT_OPTIONS: RangeFilter[] = ['1m', '3m', 'all'];

export const rangeWeeks = (range: RangeFilter): number | null => (
  range === '1m' ? 4 : range === '3m' ? 13 : range === '6m' ? 26 : null
);

export const rangeCutoffDate = (range: RangeFilter): Date | null => {
  const weeks = rangeWeeks(range);
  if (weeks === null) return null;
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7);
  d.setHours(0, 0, 0, 0);
  return d;
};

const RangeButtons = ({
  value, onChange, options = DEFAULT_OPTIONS,
}: { value: RangeFilter; onChange: (v: RangeFilter) => void; options?: RangeFilter[] }) => (
  <div className="flex gap-1">
    {options.map(opt => (
      <button
        key={opt}
        onClick={() => onChange(opt)}
        className={`touch-target inline-flex items-center justify-center px-2 rounded-lg text-[10px] font-medium transition-colors ${
          value === opt ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
        }`}
      >
        {RANGE_LABELS[opt]}
      </button>
    ))}
  </div>
);

export default RangeButtons;
