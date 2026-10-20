import { create } from 'zustand';

/**
 * Open state of the header bell's popover, lifted out of `ReminderBell` so a
 * tap on a reminder notification (spec 013, `NotificationBridge`) can open the
 * list from outside the component.
 */
interface ReminderBellState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useReminderBellStore = create<ReminderBellState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
