import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { createContext, useContext, ReactNode, CSSProperties } from 'react';

type Item = { key: string };

const HandleCtx = createContext<{ attributes: any; listeners: any } | null>(null);

interface SortableListProps<T extends Item> {
  items: T[];
  onReorder: (newItems: T[]) => void;
  children: (item: T, index: number) => ReactNode;
}

export function SortableList<T extends Item>({ items, onReorder, children }: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Long-press ~180ms on touch to differentiate from scrolling
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex(i => i.key === active.id);
    const newIndex = items.findIndex(i => i.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(i => i.key)} strategy={verticalListSortingStrategy}>
        {items.map((it, idx) => (
          <SortableItemWrap key={it.key} id={it.key}>
            {children(it, idx)}
          </SortableItemWrap>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableItemWrap({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 20 : 'auto',
    position: 'relative',
  };
  return (
    <div ref={setNodeRef} style={style}>
      <HandleCtx.Provider value={{ attributes, listeners }}>{children}</HandleCtx.Provider>
    </div>
  );
}

export function DragHandle({ className = '' }: { className?: string }) {
  const ctx = useContext(HandleCtx);
  if (!ctx) return null;
  return (
    <button
      type="button"
      {...ctx.attributes}
      {...ctx.listeners}
      // touch-none prevents the browser from consuming the touch as a scroll gesture on the handle only
      className={`touch-none text-muted-foreground active:text-primary p-1.5 -m-1 cursor-grab active:cursor-grabbing shrink-0 ${className}`}
      aria-label="Réorganiser"
      onClick={e => e.preventDefault()}
    >
      <GripVertical size={16} />
    </button>
  );
}
