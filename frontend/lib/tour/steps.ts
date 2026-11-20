import type { SettingsTab } from "@/components/SettingsView";
import type { AccountType, LedgerScope, TutorialModuleId } from "@/lib/api";

import type { TourSignal } from "./signals";

/**
 * Module ids. Must match `TUTORIAL_MODULE_IDS` in
 * `backend/app/models/user_settings.py` and `TutorialModuleId` in `lib/api.ts`.
 */
export const TUTORIAL_MODULE_IDS = [
  "basics",
  "concepts",
  "subs",
  "stocks",
  "partner",
  "country",
] as const satisfies readonly TutorialModuleId[];

// Fails to compile if `TutorialModuleId` gains an id that is not listed above.
type MissingModuleIds = Exclude<
  TutorialModuleId,
  (typeof TUTORIAL_MODULE_IDS)[number]
>;
const _allModuleIdsListed: MissingModuleIds extends never ? true : false = true;
void _allModuleIdsListed;

/** Screens a step can open. Same values as `View` in `AppShell`. */
export type TourView =
  | "calendar"
  | "list"
  | "dashboard"
  | "subscriptions"
  | "stocks"
  | "settings"
  | "import"
  | "notifications";

export type TourEntryType = "expense" | "income" | "move";

/** Something the app does before a step is shown, so its target is on screen. */
export type TourSetup =
  | { action: "openView"; view: TourView }
  | { action: "setAccountType"; accountType: AccountType }
  | { action: "setScope"; scope: LedgerScope }
  | { action: "openSettingsTab"; tab: SettingsTab }
  | { action: "expandFab" }
  | { action: "openEntryModal" }
  | { action: "setEntryType"; entryType: TourEntryType }
  | { action: "closeModals" };

export type TourSetupAction = TourSetup["action"];

/** What moves the tour to the next step. */
export type TourAdvance =
  /** The Next button on the card. */
  | "next"
  /** A click on the highlighted control. */
  | "click"
  /** A signal fired by the app (see `signals.ts`). */
  | { signal: TourSignal };

export interface TourStep {
  /** Stable id, also the i18n key under `tutorial.steps` ("basics.add"). */
  id: string;
  /**
   * `data-tour` value of the control to highlight. With several values the
   * highlight covers the first visible match of each.
   */
  target: string | string[];
  setup?: TourSetup[];
  advanceOn: TourAdvance;
}

export interface TourModule {
  id: TutorialModuleId;
  steps: TourStep[];
}

const basics: TourModule = {
  id: "basics",
  steps: [
    {
      id: "basics.nav",
      target: "nav",
      setup: [{ action: "closeModals" }],
      advanceOn: "next",
    },
    {
      id: "basics.ledger",
      target: ["ledger-type", "ledger-month"],
      setup: [{ action: "closeModals" }, { action: "openView", view: "calendar" }],
      advanceOn: "next",
    },
    {
      id: "basics.add",
      target: "fab-add",
      setup: [{ action: "closeModals" }, { action: "expandFab" }],
      advanceOn: { signal: "entryModalOpened" },
    },
  ],
};

export const TOURS: Partial<Record<TutorialModuleId, TourModule>> = {
  basics,
};

export function getTour(id: string | null | undefined): TourModule | null {
  if (!id) return null;
  const tour = TOURS[id as TutorialModuleId];
  return tour && tour.steps.length > 0 ? tour : null;
}

export function stepTargets(step: TourStep): string[] {
  return Array.isArray(step.target) ? step.target : [step.target];
}
