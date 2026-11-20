"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

import type { TutorialModuleId } from "@/lib/api";
import { onSignal } from "@/lib/tour/signals";
import {
  getTour,
  stepTargets,
  type TourModule,
  type TourSetup,
  type TourSetupAction,
  type TourStep,
} from "@/lib/tour/steps";

import TourOverlay from "./TourOverlay";

const STORAGE_KEY = "pairpocket.tour";

/** Where to go back to when a tour that was opened from somewhere else ends. */
export interface TourReturnTo {
  view: string;
  tab?: string;
  showOlder?: boolean;
}

interface ActiveTour {
  tourId: string;
  stepIndex: number;
  returnTo: TourReturnTo | null;
}

/** One handler per setup action, filled by `AppShell`. */
export type TourSetupHandlers = {
  [A in TourSetupAction]?: (setup: Extract<TourSetup, { action: A }>) => void;
};

export interface TourStartOptions {
  returnTo?: TourReturnTo | null;
}

export interface TourApi {
  start: (tourId: string, options?: TourStartOptions) => boolean;
  exit: () => void;
  next: () => void;
  back: () => void;
  /** Skips the current step (the last one finishes the tour). */
  skip: () => void;
}

export interface TourContextValue extends TourApi {
  tour: TourModule | null;
  step: TourStep | null;
  stepIndex: number;
  returnTo: TourReturnTo | null;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const value = useContext(TourContext);
  if (!value) throw new Error("useTour must be used inside TourProvider");
  return value;
}

function readStored(): ActiveTour | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveTour>;
    const tour = getTour(parsed.tourId);
    const index = parsed.stepIndex;
    if (!tour || typeof index !== "number" || !Number.isInteger(index)) return null;
    if (index < 0 || index >= tour.steps.length) return null;
    return { tourId: tour.id, stepIndex: index, returnTo: parsed.returnTo ?? null };
  } catch {
    return null;
  }
}

function writeStored(active: ActiveTour | null) {
  try {
    if (active) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(active));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: the tour still runs, it just will not resume */
  }
}

interface Props {
  children?: ReactNode;
  /** Runs the `setup` of each step. Read on every step, so it may change each render. */
  setup: TourSetupHandlers;
  /** Called once when the user reaches the end of a tour (not when they exit early). */
  onComplete?: (moduleId: TutorialModuleId) => void;
  /** For the parent, which cannot read the context it renders. */
  ref?: Ref<TourApi>;
}

/**
 * Holds the running tour and its step, keeps them in sessionStorage so a
 * reload resumes, runs each step's setup and draws the overlay.
 */
export default function TourProvider({ children, setup, onComplete, ref }: Props) {
  const [active, setActive] = useState<ActiveTour | null>(readStored);
  const activeRef = useRef(active);
  // Element focused before the tour started; focus goes back there on exit.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const commit = useCallback((next: ActiveTour | null) => {
    activeRef.current = next;
    setActive(next);
    writeStored(next);
  }, []);

  const finishWithFocus = useCallback(() => {
    const el = returnFocusRef.current;
    returnFocusRef.current = null;
    // Only take focus back from the tour itself. When the last step ended
    // because the user pressed a real control (the add button opening the
    // entry form), focus stays where that left it.
    const now = document.activeElement;
    const onTour = !now || now === document.body || now.closest("[data-tour-overlay]");
    if (onTour && el && el.isConnected) el.focus({ preventScroll: true });
  }, []);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const exit = useCallback(() => {
    if (!activeRef.current) return;
    commit(null);
    finishWithFocus();
  }, [commit, finishWithFocus]);

  const goTo = useCallback(
    (index: number) => {
      const current = activeRef.current;
      if (!current) return;
      const tour = getTour(current.tourId);
      if (!tour) {
        commit(null);
        finishWithFocus();
        return;
      }
      if (index >= tour.steps.length) {
        commit(null);
        finishWithFocus();
        onCompleteRef.current?.(tour.id);
        return;
      }
      commit({ ...current, stepIndex: Math.max(0, index) });
    },
    [commit, finishWithFocus]
  );

  const next = useCallback(() => {
    const current = activeRef.current;
    if (current) goTo(current.stepIndex + 1);
  }, [goTo]);

  const back = useCallback(() => {
    const current = activeRef.current;
    if (current && current.stepIndex > 0) goTo(current.stepIndex - 1);
  }, [goTo]);

  const start = useCallback(
    (tourId: string, options?: TourStartOptions) => {
      const tour = getTour(tourId);
      if (!tour) return false;
      if (!activeRef.current && document.activeElement instanceof HTMLElement) {
        returnFocusRef.current =
          document.activeElement === document.body ? null : document.activeElement;
      }
      commit({ tourId: tour.id, stepIndex: 0, returnTo: options?.returnTo ?? null });
      return true;
    },
    [commit]
  );

  const api = useMemo<TourApi>(
    () => ({ start, exit, next, back, skip: next }),
    [start, exit, next, back]
  );
  useImperativeHandle(ref, () => api, [api]);

  const tour = active ? getTour(active.tourId) : null;
  const step = tour && active ? (tour.steps[active.stepIndex] ?? null) : null;
  const stepKey = active && step ? `${active.tourId}:${active.stepIndex}` : null;

  const runSetup = useEffectEvent((current: TourStep) => {
    for (const item of current.setup ?? []) {
      const handler = setup[item.action] as ((s: TourSetup) => void) | undefined;
      if (handler) handler(item);
      else if (process.env.NODE_ENV !== "production") {
        console.warn(`[tour] no handler for setup "${item.action}" (${current.id})`);
      }
    }
  });

  const advance = useEffectEvent(() => next());

  // Each step: run its setup, then wait for whatever advances it.
  useEffect(() => {
    if (!stepKey || !step) return;
    runSetup(step);

    const advanceOn = step.advanceOn;
    if (typeof advanceOn === "object") {
      return onSignal(advanceOn.signal, () => advance());
    }
    if (advanceOn !== "click") return;

    const selector = stepTargets(step)
      .map((id) => `[data-tour="${CSS.escape(id)}"]`)
      .join(",");
    let timer: number | undefined;
    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(selector)) return;
      // Let the control's own handler run first, then move on.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => advance(), 0);
    }
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.clearTimeout(timer);
    };
    // `step` is fully described by `stepKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  const value = useMemo<TourContextValue>(
    () => ({
      ...api,
      tour,
      step,
      stepIndex: active?.stepIndex ?? 0,
      returnTo: active?.returnTo ?? null,
    }),
    [api, tour, step, active]
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {tour && step && active && (
        <TourOverlay
          key={stepKey}
          step={step}
          stepIndex={active.stepIndex}
          total={tour.steps.length}
          onNext={next}
          onBack={back}
          onSkip={next}
          onExit={exit}
        />
      )}
    </TourContext.Provider>
  );
}
