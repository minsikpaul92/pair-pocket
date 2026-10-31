"use client";

import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Maximize2, Minimize2 } from "lucide-react";
import type { EventHandler, ReactNode, SyntheticEvent } from "react";

export interface GridItem {
  id: string;
  half?: boolean;
  node: ReactNode;
}

interface Props {
  items: GridItem[];
  handleLabel: string;
  expandLabel: string;
  shrinkLabel: string;
  onReorder: (orderedIds: string[]) => void;
  onToggleSize: (id: string) => void;
}

type Handlers = Partial<
  Record<"onMouseDown" | "onTouchStart" | "onKeyDown", EventHandler<SyntheticEvent>>
>;

function SortableCard({
  item,
  handleLabel,
  expandLabel,
  shrinkLabel,
  onToggleSize,
}: {
  item: GridItem;
  handleLabel: string;
  expandLabel: string;
  shrinkLabel: string;
  onToggleSize: (id: string) => void;
}) {
  const sizeLabel = item.half ? expandLabel : shrinkLabel;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  const { onMouseDown, onTouchStart, onKeyDown } = (listeners ?? {}) as Handlers;

  return (
    <div
      ref={setNodeRef}
      // Touch: long-press anywhere on the card picks it up. Mouse: grip only.
      onTouchStart={onTouchStart}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        WebkitTouchCallout: "none",
      }}
      className={`relative min-w-0 select-none ${
        item.half ? "col-span-1" : "col-span-2"
      } ${isDragging ? "z-20 opacity-90 shadow-xl" : ""}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
        aria-label={handleLabel}
        title={handleLabel}
        className="absolute -right-2 -top-2 z-10 flex h-6 w-6 cursor-grab items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm hover:text-gray-600 active:cursor-grabbing dark:border-gray-700 dark:bg-gray-900"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onToggleSize(item.id)}
        aria-label={sizeLabel}
        title={sizeLabel}
        className="absolute -top-2 right-5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm hover:text-gray-600 dark:border-gray-700 dark:bg-gray-900"
      >
        {item.half ? (
          <Maximize2 className="h-3 w-3" />
        ) : (
          <Minimize2 className="h-3 w-3" />
        )}
      </button>
      {item.node}
    </div>
  );
}

export default function SortableCardGrid({
  items,
  handleLabel,
  expandLabel,
  shrinkLabel,
  onReorder,
  onToggleSize,
}: Props) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 350, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const ids = items.map((i) => i.id);

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => (
            <SortableCard
              key={item.id}
              item={item}
              handleLabel={handleLabel}
              expandLabel={expandLabel}
              shrinkLabel={shrinkLabel}
              onToggleSize={onToggleSize}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
