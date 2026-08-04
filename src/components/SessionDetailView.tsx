import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { SessionLog, SetLog, AppData, calculate1RM, resolveProgramName } from '@/lib/types';
import { isBodyweightOptionalExercise, weightFieldValue } from '@/lib/exerciseNormalize';
import { computeSetTonnage, resolveBodyWeightAtDate } from '@/lib/tonnage';
import { Trash2, Pencil, Share2, Plus, X, TrendingUp, TrendingDown, Minus, Check } from 'lucide-react';

interface SessionDetailViewProps {
  session: SessionLog;
  data: AppData;
  onClose: () => void;
  onUpdate: (updated: SessionLog) => void;
  onDelete?: (sessionId: string) => void;
}

// The app's fixed brand hues (same trio BrandMark.tsx draws) — a stable identity constant,
// not a themeable token, so hardcoded here exactly as there. Module-level (not rebuilt
// per share) since it never changes.
const BRAND_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="flow" x1="10" y1="10" x2="90" y2="90" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="hsl(189 94% 55%)" />
      <stop offset="50%" stop-color="hsl(262 83% 66%)" />
      <stop offset="100%" stop-color="hsl(322 100% 60%)" />
    </linearGradient>
    <linearGradient id="bar" x1="19" y1="50" x2="81" y2="50" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="hsl(189 94% 55%)" />
      <stop offset="100%" stop-color="hsl(322 100% 60%)" />
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="none" stroke="url(#flow)" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 9.4" opacity="0.85" />
  <circle cx="50" cy="4.3" r="2.8" fill="hsl(189 94% 55%)" />
  <circle cx="90.5" cy="65" r="2.8" fill="hsl(322 100% 60%)" />
  <path d="M 30 48 C 35 23, 46 13, 50 30 C 54 13, 65 23, 70 48" fill="none" stroke="url(#flow)" stroke-width="4.5" stroke-linecap="round" />
  <rect x="28" y="47" width="44" height="6" rx="3" fill="url(#bar)" />
  <rect x="15" y="41" width="6" height="18" rx="2.5" fill="hsl(189 94% 55%)" opacity="0.65" />
  <rect x="19" y="36" width="9" height="28" rx="3" fill="hsl(189 94% 55%)" />
  <rect x="72" y="36" width="9" height="28" rx="3" fill="hsl(322 100% 60%)" />
  <rect x="79" y="41" width="6" height="18" rx="2.5" fill="hsl(322 100% 60%)" opacity="0.65" />
</svg>`;

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

// Turns a data: URL (from canvas.toDataURL, itself synchronous) into a Blob without any
// async step — see the `logoImgRef` comment in the component for why this matters.
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const SessionDetailView = ({ session, data, onClose, onUpdate, onDelete }: SessionDetailViewProps) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const recapRef = useRef<HTMLDivElement>(null);
  // Pre-loaded ahead of the share click (see the effect below) so handleShare has zero
  // `await` before it can call navigator.share — iOS Safari only allows the Web Share API
  // within the synchronous tail of a user gesture; any real async wait first (an image
  // load, canvas.toBlob's callback) silently expires that window, and the code's own
  // catch-all then reads the resulting rejection as "she cancelled the share sheet" even
  // though she never saw a share sheet at all. This was the actual bug behind "ça ne
  // marche pas" — no error ever surfaced because the failure looked identical to a cancel.
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    loadImage(`data:image/svg+xml;base64,${btoa(BRAND_MARK_SVG)}`)
      .then(img => { logoImgRef.current = img; })
      .catch(() => { /* share falls back to loading it inline if this never resolved */ });
  }, []);

  // Edit state
  const [editSets, setEditSets] = useState<SetLog[]>([]);
  const [editDuration, setEditDuration] = useState(0);
  const [editDifficulty, setEditDifficulty] = useState(5);
  const [editNotes, setEditNotes] = useState('');
  const [editDate, setEditDate] = useState('');

  const completedSets = useMemo(() => session.sets.filter(s => s.completed), [session.sets]);
  const sessionBodyWeight = useMemo(
    () => resolveBodyWeightAtDate(data.bodyWeightLogs, session.date),
    [data.bodyWeightLogs, session.date]
  );
  const totalVolume = completedSets.reduce((acc, s) => acc + computeSetTonnage(s, sessionBodyWeight), 0);

  const getLastPerformance = useCallback((exerciseName: string, excludeSessionId: string) => {
    for (let i = data.sessions.length - 1; i >= 0; i--) {
      const s = data.sessions[i];
      if (s.id === excludeSessionId) continue;
      const matchingSets = s.sets.filter(set => set.exerciseName === exerciseName && set.completed && (set.weight > 0 || isBodyweightOptionalExercise(exerciseName)));
      if (matchingSets.length > 0) {
        const best = matchingSets.reduce((b, set) => set.weight > b.weight ? set : b, matchingSets[0]);
        return { weight: best.weight, reps: best.reps, date: s.date };
      }
    }
    return null;
  }, [data.sessions]);

  const groupSets = (sets: SetLog[]) => {
    const map: Record<string, SetLog[]> = {};
    sets.forEach(s => {
      if (!map[s.exerciseName]) map[s.exerciseName] = [];
      map[s.exerciseName].push(s);
    });
    return Object.entries(map);
  };

  const groupedExercises = useMemo(() => groupSets(completedSets), [completedSets]);

  // Progression vs last session of same type
  const progressions = useMemo(() => {
    const lastSession = data.sessions
      .filter(s => s.workoutTypeId === session.workoutTypeId && s.id !== session.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!lastSession) return {};

    const result: Record<string, { weightDiff: number; repDiff: number; e1rmDiff: number; e1rmPct: number }> = {};
    groupedExercises.forEach(([name, sets]) => {
      const bestSet = sets.reduce((best, s) => calculate1RM(s.weight, s.reps) > calculate1RM(best.weight, best.reps) ? s : best, sets[0]);
      const lastSets = lastSession.sets.filter(s => s.exerciseName === name && s.completed && (s.weight > 0 || isBodyweightOptionalExercise(name)));
      if (lastSets.length === 0) return;
      const lastBest = lastSets.reduce((best, s) => calculate1RM(s.weight, s.reps) > calculate1RM(best.weight, best.reps) ? s : best, lastSets[0]);
      const current1RM = calculate1RM(bestSet.weight, bestSet.reps);
      const last1RM = calculate1RM(lastBest.weight, lastBest.reps);
      result[name] = {
        weightDiff: bestSet.weight - lastBest.weight,
        repDiff: bestSet.reps - lastBest.reps,
        e1rmDiff: Math.round((current1RM - last1RM) * 10) / 10,
        e1rmPct: last1RM > 0 ? Math.round(((current1RM - last1RM) / last1RM) * 1000) / 10 : 0,
      };
    });
    return result;
  }, [data.sessions, session, groupedExercises]);

  // Overall session comparison
  const overallComparison = useMemo(() => {
    const lastSession = data.sessions
      .filter(s => s.workoutTypeId === session.workoutTypeId && s.id !== session.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!lastSession) return null;

    const lastCompleted = lastSession.sets.filter(s => s.completed);
    const lastSessionBodyWeight = resolveBodyWeightAtDate(data.bodyWeightLogs, lastSession.date);
    const lastVolume = lastCompleted.reduce((acc, s) => acc + computeSetTonnage(s, lastSessionBodyWeight), 0);
    const volDiff = lastVolume > 0 ? ((totalVolume - lastVolume) / lastVolume) * 100 : 0;

    const progValues = Object.values(progressions);
    const avg1RMDiff = progValues.length > 0
      ? progValues.reduce((sum, p) => sum + p.e1rmPct, 0) / progValues.length
      : 0;

    let verdict: 'better' | 'similar' | 'below' = 'similar';
    if (volDiff > 2 || avg1RMDiff > 1) verdict = 'better';
    else if (volDiff < -2 || avg1RMDiff < -1) verdict = 'below';

    return { volDiff: Math.round(volDiff * 10) / 10, avg1RMDiff: Math.round(avg1RMDiff * 10) / 10, verdict };
  }, [data.sessions, data.bodyWeightLogs, session, totalVolume, progressions]);

  const sessionDate = new Date(session.date + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const getColorForType = () => {
    const wt = data.workoutTypes.find(w => w.id === session.workoutTypeId);
    return wt?.color || '189 94% 55%';
  };

  // --- Edit mode helpers ---
  const enterEditMode = () => {
    setEditSets([...completedSets]);
    setEditDuration(session.duration || 0);
    setEditDifficulty(session.difficulty || 5);
    setEditNotes(session.notes || '');
    setEditDate(session.date);
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = () => {
    onUpdate({
      ...session,
      date: editDate,
      sets: editSets,
      duration: editDuration || 60,
      difficulty: editDifficulty,
      notes: editNotes,
    });
    setEditing(false);
  };

  const updateEditSet = (index: number, field: 'reps' | 'weight', value: string) => {
    const updated = [...editSets];
    updated[index][field] = value === '' ? 0 : (field === 'weight' ? parseFloat(value) || 0 : parseInt(value) || 0);
    setEditSets(updated);
  };

  const removeEditSet = (index: number) => setEditSets(prev => prev.filter((_, i) => i !== index));

  const addEditSet = (exerciseId: string, exerciseName: string) => {
    const existing = editSets.filter(s => s.exerciseId === exerciseId);
    const lastSet = existing[existing.length - 1];
    let insertIndex = editSets.length;
    for (let i = editSets.length - 1; i >= 0; i--) {
      if (editSets[i].exerciseId === exerciseId) { insertIndex = i + 1; break; }
    }
    const newSet: SetLog = {
      exerciseId, exerciseName, setNumber: existing.length + 1,
      reps: lastSet?.reps || 10, weight: lastSet?.weight || 0, completed: true,
    };
    const updated = [...editSets];
    updated.splice(insertIndex, 0, newSet);
    setEditSets(updated);
  };

  const addNewExercise = () => {
    const newId = `edit-${Date.now()}`;
    setEditSets(prev => [...prev, {
      exerciseId: newId, exerciseName: 'Nouvel exercice', setNumber: 1,
      reps: 10, weight: 0, completed: true,
    }]);
  };

  const updateEditExerciseName = (exerciseId: string, name: string) => {
    setEditSets(prev => prev.map(s => s.exerciseId === exerciseId ? { ...s, exerciseName: name } : s));
  };

  const removeExercise = (exerciseId: string) => {
    setEditSets(prev => prev.filter(s => s.exerciseId !== exerciseId));
  };

  // --- Share as image via canvas ---
  const handleShare = async () => {
    // Read the live theme tokens instead of hardcoding a parallel palette, so the one
    // artifact that leaves the app (a shared PNG) never drifts from the in-app neon
    // identity the way the old Apple-system-gray version had. Raw triples (not wrapped in
    // hsl(...)) so card panels below can compose their own alpha, matching how .glass-card
    // itself is a translucent tint over the background rather than a flat opaque fill.
    const raw = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const rawBg = raw('--background');
    const rawCard = raw('--card');
    const rawFg = raw('--foreground');
    const rawMuted = raw('--muted-foreground');
    const rawBorder = raw('--border');
    const rawSuccess = raw('--success');
    const rawDestructive = raw('--destructive');
    const hsl = (t: string, a = 1) => (a === 1 ? `hsl(${t})` : `hsl(${t} / ${a})`);
    const bgColor = hsl(rawBg);
    const fgColor = hsl(rawFg);
    const mutedColor = hsl(rawMuted);
    const borderColor = hsl(rawBorder);
    const successColor = hsl(rawSuccess);
    const destructiveColor = hsl(rawDestructive);

    // Prefer the pre-loaded logo (see the mount effect above) so there is no `await` at
    // all before the canvas is built — only fall back to loading it here (a real async
    // wait) on the rare chance the mount effect hasn't resolved yet.
    const logoImg = logoImgRef.current ?? await loadImage(`data:image/svg+xml;base64,${btoa(BRAND_MARK_SVG)}`);
    // Same reasoning — skip the await entirely when fonts are already loaded (the common
    // case, since the app has been rendering text in them since first paint).
    if (document.fonts.status !== 'loaded') await document.fonts.ready;

    const canvas = document.createElement('canvas');
    const w = 1080;
    const padding = 56;
    const cardGap = 20;
    const cardPad = 32;
    const cardRadius = 24;
    const color = getColorForType();
    const left = padding;
    const right = w - padding;

    const accentBarGradient = (ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number) => {
      const grad = ctx.createLinearGradient(x0, y, x1, y);
      grad.addColorStop(0, 'hsl(189 94% 55%)');
      grad.addColorStop(0.5, 'hsl(262 83% 66%)');
      grad.addColorStop(1, 'hsl(322 100% 60%)');
      return grad;
    };
    // Manual arc-based rounded rect (not ctx.roundRect) for compatibility with older
    // in-app WebViews the PWA may run under.
    const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + width, y, x + width, y + height, r);
      ctx.arcTo(x + width, y + height, x, y + height, r);
      ctx.arcTo(x, y + height, x, y, r);
      ctx.arcTo(x, y, x + width, y, r);
      ctx.closePath();
    };
    const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
      const words = text.split(' ');
      const lines: string[] = [];
      let line = '';
      for (const word of words) {
        const test = line + word + ' ';
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line.trim());
          line = word + ' ';
        } else {
          line = test;
        }
      }
      if (line) lines.push(line.trim());
      return lines;
    };

    // Two-pass layout: `draw=false` against a throwaway context measures the exact height
    // every section needs (word-wrapped notes included) so nothing is ever clipped by a
    // fixed line-count guess; `draw=true` replays the identical sequence for real once the
    // canvas is sized to that exact height. Panel backgrounds are drawn from `panelHeights`
    // (filled during the measure pass) before their content each time, since a card's own
    // height — number of sets, presence of a progression pill — is only known after laying
    // out what goes inside it.
    const panelHeights: number[] = [];
    let finalHeight = 0;

    const runLayout = (ctx: CanvasRenderingContext2D, draw: boolean): number => {
      let y = padding;
      let panelIdx = 0;

      if (draw) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, w, finalHeight);
        const wash = ctx.createLinearGradient(0, 0, 0, 320);
        wash.addColorStop(0, hsl(color, 0.12));
        wash.addColorStop(1, 'transparent');
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, w, 320);
        ctx.fillStyle = accentBarGradient(ctx, 0, w, 0);
        ctx.fillRect(0, 0, w, 6);
      }
      y += 6;

      // Header: logo + wordmark
      y += 30;
      const logoSize = 44;
      if (draw) {
        ctx.save();
        ctx.shadowColor = hsl(color);
        ctx.shadowBlur = 16;
        ctx.drawImage(logoImg, left, y - logoSize + 8, logoSize, logoSize);
        ctx.restore();
        ctx.font = "600 26px 'Space Grotesk', -apple-system, sans-serif";
        ctx.fillStyle = hsl(color);
        ctx.fillText('MUSCULISA', left + logoSize + 18, y);
      }
      y += 56;

      // Session title: workout-type color dot + name, same pairing used everywhere in-app
      ctx.font = "700 46px 'Space Grotesk', -apple-system, sans-serif";
      if (draw) {
        ctx.fillStyle = hsl(color);
        ctx.beginPath();
        ctx.arc(left + 11, y - 15, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = fgColor;
        ctx.fillText(session.workoutTypeName, left + 38, y);
      }
      y += 50;

      ctx.font = "400 26px 'Space Grotesk', -apple-system, sans-serif";
      if (draw) {
        ctx.fillStyle = mutedColor;
        ctx.fillText(sessionDate, left, y);
      }
      y += 52;

      // One glass-card-style panel per exercise
      groupedExercises.forEach(([name, sets]) => {
        const bestSet = sets.reduce((b, s) => calculate1RM(s.weight, s.reps) > calculate1RM(b.weight, b.reps) ? s : b, sets[0]);
        const e1rm = calculate1RM(bestSet.weight, bestSet.reps);
        const prog = progressions[name];

        const panelTop = y;
        const panelH = panelHeights[panelIdx] ?? 0;
        if (draw) {
          ctx.fillStyle = hsl(rawCard, 0.65);
          ctx.strokeStyle = hsl(rawBorder, 0.8);
          ctx.lineWidth = 1.5;
          roundRect(ctx, left, panelTop, right - left, panelH, cardRadius);
          ctx.fill();
          ctx.stroke();
        }

        let cy = panelTop + cardPad + 4;
        const innerLeft = left + cardPad;
        const innerRight = right - cardPad;

        ctx.font = "600 30px 'Space Grotesk', -apple-system, sans-serif";
        if (draw) {
          ctx.fillStyle = fgColor;
          ctx.fillText(name, innerLeft, cy);
          if (e1rm > 0) {
            ctx.font = "600 24px 'Space Grotesk', -apple-system, sans-serif";
            ctx.fillStyle = hsl(color);
            const rmText = `1RM ${e1rm} kg`;
            ctx.fillText(rmText, innerRight - ctx.measureText(rmText).width, cy);
          }
        }
        cy += 42;

        sets.forEach((s, i) => {
          ctx.font = "400 24px 'Space Grotesk', -apple-system, sans-serif";
          if (draw) {
            ctx.fillStyle = mutedColor;
            ctx.fillText(`Série ${i + 1}`, innerLeft, cy);
            ctx.font = "500 24px 'JetBrains Mono', monospace";
            ctx.fillStyle = fgColor;
            const setText = `${s.weight} kg × ${s.reps}`;
            ctx.fillText(setText, innerRight - ctx.measureText(setText).width, cy);
          }
          cy += 34;
        });

        if (prog) {
          cy += 10;
          const pillText = prog.e1rmPct > 0 ? `↑ +${prog.e1rmPct}%` : prog.e1rmPct < 0 ? `↓ ${prog.e1rmPct}%` : '= Stable';
          const pillRaw = prog.e1rmPct > 0 ? rawSuccess : prog.e1rmPct < 0 ? rawDestructive : rawMuted;
          ctx.font = "600 22px 'Space Grotesk', -apple-system, sans-serif";
          const pillH = 40;
          if (draw) {
            const pillW = ctx.measureText(pillText).width + 32;
            ctx.fillStyle = hsl(pillRaw, 0.15);
            roundRect(ctx, innerLeft, cy, pillW, pillH, pillH / 2);
            ctx.fill();
            ctx.fillStyle = hsl(pillRaw);
            ctx.fillText(pillText, innerLeft + 16, cy + 27);
          }
          cy += pillH;
        }

        cy += cardPad;
        if (!draw) panelHeights.push(cy - panelTop);
        panelIdx++;
        y = cy + cardGap;
      });

      // Stats panel: tonnage as the hero figure, duration/RPE as secondary stats beside it
      const statsPanelTop = y;
      const statsPanelH = panelHeights[panelIdx] ?? 0;
      if (draw) {
        ctx.fillStyle = hsl(rawCard, 0.65);
        ctx.strokeStyle = hsl(rawBorder, 0.8);
        ctx.lineWidth = 1.5;
        roundRect(ctx, left, statsPanelTop, right - left, statsPanelH, cardRadius);
        ctx.fill();
        ctx.stroke();
      }
      {
        let cy = statsPanelTop + cardPad + 4;
        const innerLeft = left + cardPad;
        ctx.font = "600 20px 'Space Grotesk', -apple-system, sans-serif";
        if (draw) {
          ctx.fillStyle = mutedColor;
          ctx.fillText('TONNAGE TOTAL', innerLeft, cy);
        }
        cy += 48;
        ctx.font = "700 52px 'JetBrains Mono', monospace";
        if (draw) {
          ctx.fillStyle = hsl(color);
          ctx.fillText(`${Math.round(totalVolume)} kg`, innerLeft, cy);
        }
        cy += 50;

        const secondary: string[] = [];
        if (session.duration) secondary.push(`Durée ${session.duration} min`);
        if (session.difficulty) secondary.push(`RPE ${session.difficulty}/10`);
        if (secondary.length > 0) {
          ctx.font = "500 24px 'Space Grotesk', -apple-system, sans-serif";
          if (draw) {
            ctx.fillStyle = mutedColor;
            ctx.fillText(secondary.join('   •   '), innerLeft, cy);
          }
          cy += 40;
        }
        cy += cardPad - 10;
        if (!draw) panelHeights.push(cy - statsPanelTop);
      }
      panelIdx++;
      y = statsPanelTop + (panelHeights[panelIdx - 1] ?? 0) + cardGap;

      // Notes
      let notesLines: string[] = [];
      if (session.notes) {
        ctx.font = "italic 24px 'Space Grotesk', -apple-system, sans-serif";
        notesLines = wrapText(ctx, `"${session.notes}"`, right - left - cardPad * 2);
        const notesPanelTop = y;
        const notesPanelH = cardPad * 2 + notesLines.length * 34;
        if (draw) {
          ctx.fillStyle = hsl(rawCard, 0.4);
          ctx.strokeStyle = hsl(rawBorder, 0.6);
          ctx.lineWidth = 1.5;
          roundRect(ctx, left, notesPanelTop, right - left, notesPanelH, cardRadius);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = mutedColor;
          let cy = notesPanelTop + cardPad + 4;
          notesLines.forEach(line => {
            ctx.fillText(line, left + cardPad, cy);
            cy += 34;
          });
        }
        y = notesPanelTop + notesPanelH + cardGap;
      }

      // Overall comparison — a verdict pill plus the two deltas that back it up
      if (overallComparison) {
        const verdictLabel = overallComparison.verdict === 'better' ? '📈 Meilleure que la précédente'
          : overallComparison.verdict === 'below' ? '📉 En dessous de la précédente'
          : '📊 Similaire à la précédente';
        const verdictRaw = overallComparison.verdict === 'better' ? rawSuccess
          : overallComparison.verdict === 'below' ? rawDestructive : rawMuted;

        const compPanelTop = y;
        const compPanelH = panelHeights[panelIdx] ?? 0;
        if (draw) {
          ctx.fillStyle = hsl(verdictRaw, 0.1);
          ctx.strokeStyle = hsl(verdictRaw, 0.4);
          ctx.lineWidth = 1.5;
          roundRect(ctx, left, compPanelTop, right - left, compPanelH, cardRadius);
          ctx.fill();
          ctx.stroke();
        }
        let cy = compPanelTop + cardPad + 4;
        const innerLeft = left + cardPad;
        ctx.font = "600 28px 'Space Grotesk', -apple-system, sans-serif";
        if (draw) {
          ctx.fillStyle = hsl(verdictRaw);
          ctx.fillText(verdictLabel, innerLeft, cy);
        }
        cy += 38;
        ctx.font = "400 22px 'Space Grotesk', -apple-system, sans-serif";
        if (draw) {
          ctx.fillStyle = mutedColor;
          ctx.fillText(
            `Volume : ${overallComparison.volDiff > 0 ? '+' : ''}${overallComparison.volDiff}%   •   1RM moy. : ${overallComparison.avg1RMDiff > 0 ? '+' : ''}${overallComparison.avg1RMDiff}%`,
            innerLeft, cy
          );
        }
        cy += cardPad - 6;
        if (!draw) panelHeights.push(cy - compPanelTop);
        panelIdx++;
        y = compPanelTop + (panelHeights[panelIdx - 1] ?? 0) + cardGap;
      }

      y += padding - cardGap;
      return y;
    };

    // Measure pass
    const measureCtx = document.createElement('canvas').getContext('2d')!;
    finalHeight = runLayout(measureCtx, false);

    // Draw pass, at the exact height just measured
    canvas.width = w;
    canvas.height = Math.max(1200, finalHeight);
    const ctx = canvas.getContext('2d')!;
    runLayout(ctx, true);

    // Bottom accent strip, mirroring the top one
    ctx.fillStyle = accentBarGradient(ctx, 0, w, canvas.height - 6);
    ctx.fillRect(0, canvas.height - 6, w, 6);

    // toDataURL is SYNCHRONOUS (unlike canvas.toBlob's callback) — combined with the
    // pre-loaded logo and skipped font wait above, navigator.share below now runs with
    // zero real async gap since the click, which is what iOS Safari requires to honor it
    // as still within the user gesture.
    const blob = dataUrlToBlob(canvas.toDataURL('image/png'));
    const file = new File([blob], `${session.workoutTypeName}-${session.date}.png`, { type: 'image/png' });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (err) {
        // AbortError = she dismissed the share sheet herself, nothing to do. Anything
        // else (e.g. iOS refusing because the gesture window had already lapsed) falls
        // back to a direct download instead of silently doing nothing — see the
        // logoImgRef comment above for the bug this used to cause.
        if (err instanceof Error && err.name !== 'AbortError') {
          downloadBlob(blob, file.name);
        }
      }
    } else {
      downloadBlob(blob, file.name);
    }
  };

  // =========== EDIT MODE ===========
  if (editing) {
    const editGrouped = groupSets(editSets);
    return (
      <div className="px-4 pt-12 pb-24 animate-slide-up">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={cancelEdit} className="text-muted-foreground touch-target p-1">
            <X size={20} />
          </button>
          <h1 className="text-xl font-bold text-foreground flex-1">Modifier la séance</h1>
        </div>

        {/* Date */}
        <div className="glass-card p-4 mb-4">
          <label className="text-xs text-muted-foreground mb-1.5 block">Date</label>
          <input
            type="date"
            value={editDate}
            onChange={e => setEditDate(e.target.value)}
            className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none"
          />
        </div>

        {/* Exercises */}
        <div className="space-y-4 mb-4">
          {editGrouped.map(([name, sets]) => {
            const exerciseId = sets[0].exerciseId;
            const isTemp = exerciseId.startsWith('edit-');
            const globalIndices = sets.map(s => editSets.indexOf(s));

            return (
              <div key={exerciseId} className="glass-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  {isTemp ? (
                    <input
                      value={name}
                      onChange={e => updateEditExerciseName(exerciseId, e.target.value)}
                      className="bg-transparent text-foreground font-semibold outline-none flex-1 text-sm"
                      placeholder="Nom de l'exercice"
                    />
                  ) : (
                    <h3 className="text-sm font-semibold text-foreground flex-1">{name}</h3>
                  )}
                  <button onClick={() => removeExercise(exerciseId)} className="text-destructive p-1">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="space-y-2">
                  {sets.map((s, localIdx) => {
                    const gi = globalIndices[localIdx];
                    return (
                      <div key={gi} className="flex items-center gap-2 bg-secondary/50 rounded-xl px-3 py-2.5">
                        <span className="text-xs text-muted-foreground w-8">S{localIdx + 1}</span>
                        <input
                          type="number"
                          value={weightFieldValue(s.weight, name)}
                          onChange={e => updateEditSet(gi, 'weight', e.target.value)}
                          className="w-16 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                          placeholder="kg"
                        />
                        <span className="text-muted-foreground text-xs">kg ×</span>
                        <input
                          type="number"
                          value={s.reps || ''}
                          onChange={e => updateEditSet(gi, 'reps', e.target.value)}
                          className="w-12 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                          placeholder="reps"
                        />
                        <button onClick={() => removeEditSet(gi)} className="text-muted-foreground p-1 active:text-destructive ml-auto">
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() => addEditSet(exerciseId, name)}
                  className="flex items-center gap-1 text-primary text-xs font-medium py-1.5 mt-2"
                >
                  <Plus size={12} /> Ajouter une série
                </button>
              </div>
            );
          })}
        </div>

        <button
          onClick={addNewExercise}
          className="w-full glass-card p-3 flex items-center justify-center gap-2 text-primary text-sm font-medium mb-4 transition-transform active:scale-95"
        >
          <Plus size={16} /> Ajouter un exercice
        </button>

        {/* Duration */}
        <div className="glass-card p-4 mb-4">
          <label className="text-xs text-muted-foreground mb-1.5 block">Durée (minutes)</label>
          <input
            type="number"
            value={editDuration || ''}
            onChange={e => setEditDuration(e.target.value === '' ? 0 : parseInt(e.target.value))}
            className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono text-center text-lg"
          />
        </div>

        {/* RPE */}
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs text-muted-foreground">RPE</label>
            <span className="text-sm font-bold text-foreground">{editDifficulty}/10</span>
          </div>
          <input
            type="range"
            min={1} max={10}
            value={editDifficulty}
            onChange={e => setEditDifficulty(parseInt(e.target.value))}
            className="w-full accent-primary h-2"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Facile</span><span>Difficile</span>
          </div>
        </div>

        {/* Notes */}
        <div className="glass-card p-4 mb-6">
          <label className="text-xs text-muted-foreground mb-1.5 block">Notes</label>
          <textarea
            value={editNotes}
            onChange={e => setEditNotes(e.target.value)}
            placeholder="Comment s'est passée la séance ?"
            className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none resize-none min-h-[80px]"
          />
        </div>

        <div className="flex gap-3">
          <button onClick={cancelEdit} className="flex-1 bg-secondary text-secondary-foreground font-semibold py-4 rounded-2xl text-sm transition-transform active:scale-95">
            Annuler
          </button>
          <button onClick={saveEdit} className="flex-1 btn-neon font-semibold py-4 rounded-2xl text-sm flex items-center justify-center gap-2 transition-transform active:scale-95">
            Enregistrer <Check size={18} />
          </button>
        </div>
      </div>
    );
  }

  // =========== READ-ONLY MODE ===========
  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      {/* Delete confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in">
          <div className="glass-card p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-foreground mb-2">Supprimer la séance ?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Es-tu sûre de vouloir supprimer cette séance ? Cette action est irréversible.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirm(false)} className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm">
                Annuler
              </button>
              <button onClick={() => { onDelete?.(session.id); onClose(); }} className="flex-1 bg-destructive text-destructive-foreground font-medium py-2.5 rounded-xl text-sm">
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar: Share (left) — Delete (center-left) — Close (right) */}
      <div className="flex items-center gap-3 mb-1">
        <button
          onClick={handleShare}
          className="p-2 text-muted-foreground hover:text-primary rounded-xl transition-colors touch-target"
          title="Partager le récap"
        >
          <Share2 size={20} />
        </button>
        {onDelete && (
          <button
            onClick={() => setShowConfirm(true)}
            className="p-2 text-muted-foreground hover:text-destructive rounded-xl transition-colors touch-target"
            title="Supprimer la séance"
          >
            <Trash2 size={20} />
          </button>
        )}
        <div className="flex-1" />
        <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-xl transition-colors touch-target">
          <X size={20} />
        </button>
      </div>

      {/* Session header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground mb-1">{session.workoutTypeName}</h1>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">{sessionDate}</p>
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: `hsl(${getColorForType()} / 0.15)`,
              color: `hsl(${getColorForType()})`,
            }}
          >
            {session.workoutTypeName}
          </span>
          {(data.programs?.length ?? 0) > 1 && resolveProgramName(session, data) && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
              {resolveProgramName(session, data)}
            </span>
          )}
        </div>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-primary">{completedSets.length}</p>
          <p className="text-[10px] text-muted-foreground">Séries</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{Math.round(totalVolume)}</p>
          <p className="text-[10px] text-muted-foreground">Total kg</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{session.duration || '—'}</p>
          <p className="text-[10px] text-muted-foreground">Minutes</p>
        </div>
      </div>

      {/* Exercises */}
      {groupedExercises.length > 0 && (
        <div className="space-y-3 mb-6">
          {groupedExercises.map(([name, sets]) => {
            const best = sets.reduce((b, s) => calculate1RM(s.weight, s.reps) > calculate1RM(b.weight, b.reps) ? s : b, sets[0]);
            const e1rm = calculate1RM(best.weight, best.reps);
            const prog = progressions[name];
            const lastPerf = getLastPerformance(name, session.id);

            return (
              <div key={name} className="glass-card p-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-foreground">{name}</h3>
                  {e1rm > 0 && (
                    <span className="text-xs text-primary font-medium">1RM: {e1rm} kg</span>
                  )}
                </div>
                {lastPerf && (
                  <p className="text-[10px] text-muted-foreground mb-2">
                    Dernière fois : {lastPerf.weight}kg × {lastPerf.reps} — {new Date(lastPerf.date + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
                  </p>
                )}
                <div className="space-y-1.5 mb-2">
                  {sets.map((s, i) => (
                    <div key={i} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-muted-foreground">Série {i + 1}</span>
                      <span className="text-sm text-foreground font-mono">{s.weight} kg × {s.reps}</span>
                    </div>
                  ))}
                </div>
                {prog && (
                  <div className="flex items-center gap-2 mt-2">
                    {prog.e1rmDiff > 0 ? (
                      <TrendingUp size={12} className="text-success" />
                    ) : prog.e1rmDiff < 0 ? (
                      <TrendingDown size={12} className="text-destructive" />
                    ) : (
                      <Minus size={12} className="text-muted-foreground" />
                    )}
                    <span className={`text-xs font-medium ${
                      prog.e1rmPct > 0 ? 'text-success' : prog.e1rmPct < 0 ? 'text-destructive' : 'text-muted-foreground'
                    }`}>
                      {prog.e1rmPct !== 0 ? `${prog.e1rmPct > 0 ? '+' : ''}${prog.e1rmPct}% vs séance précédente` : 'Identique à la séance précédente'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* RPE & Notes */}
      {session.difficulty && (
        <div className="glass-card p-4 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">RPE</span>
            <span className="text-sm font-bold text-foreground">{session.difficulty}/10</span>
          </div>
        </div>
      )}
      {session.notes && (
        <div className="glass-card p-4 mb-6">
          <p className="text-xs text-muted-foreground mb-1">Notes</p>
          <p className="text-sm text-foreground">{session.notes}</p>
        </div>
      )}

      {/* Overall comparison */}
      {overallComparison && (
        <div className="glass-card p-4 mb-6">
          <div className="flex items-center gap-2">
            {overallComparison.verdict === 'better' ? (
              <TrendingUp size={16} className="text-success" />
            ) : overallComparison.verdict === 'below' ? (
              <TrendingDown size={16} className="text-destructive" />
            ) : (
              <Minus size={16} className="text-muted-foreground" />
            )}
            <span className={`text-sm font-semibold ${
              overallComparison.verdict === 'better' ? 'text-success' : overallComparison.verdict === 'below' ? 'text-destructive' : 'text-muted-foreground'
            }`}>
              {overallComparison.verdict === 'better' ? 'Meilleure que la précédente' : overallComparison.verdict === 'below' ? 'En dessous de la précédente' : 'Similaire à la précédente'}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Volume : {overallComparison.volDiff > 0 ? '+' : ''}{overallComparison.volDiff}% • 1RM moy. : {overallComparison.avg1RMDiff > 0 ? '+' : ''}{overallComparison.avg1RMDiff}%
          </p>
        </div>
      )}

      {/* Bottom: Edit button */}
      <button
        onClick={enterEditMode}
        className="w-full btn-neon font-semibold py-4 rounded-2xl text-sm flex items-center justify-center gap-2 transition-transform active:scale-95"
      >
        <Pencil size={16} /> Modifier la séance
      </button>
    </div>
  );
};

export default SessionDetailView;
