import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { useModalBackButton } from '@/lib/hooks/useModalBackButton';
import { cn } from '@/lib/utils';

/**
 * S22 — Thin wrapper around Radix `Dialog.Root` that wires the OS / browser
 * back-button (Android system back, iOS swipe-from-edge, desktop browser
 * back) to the dialog's `onOpenChange(false)`. Every modal in the app uses
 * this primitive, so a single integration here gives universal back-button
 * dismissal without touching the dozen call-sites.
 *
 * The hook runs only while `open === true`, and routes through `onOpenChange`
 * rather than calling Radix `setOpen` directly — that means a back press is
 * treated identically to clicking the overlay / pressing Esc, including any
 * "should we really close?" logic in the consumer (e.g. `EntryEditModal`'s
 * dirty-discard confirm). Nested modals (parent + confirm-on-confirm) are
 * handled by the hook's per-instance history marker.
 *
 * Uncontrolled callers (no `open` prop) skip the hook entirely — there's no
 * controlled state for the back-button to drive.
 */
type DialogRootProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>;

function Dialog({ open, onOpenChange, ...rest }: DialogRootProps) {
  const handleBack = React.useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);
  useModalBackButton(open === true, handleBack);
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} {...rest} />;
}

const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * S18 — `variant` controls positioning + animation:
 *
 *   - `centered` (default): the existing behaviour — fixed at viewport
 *     center with the zoom-in/out animation. Every pre-S18 caller renders
 *     this without changing.
 *
 *   - `bottom-sheet`: on phones (`< sm`) the dialog slides up from the
 *     bottom edge of the viewport, anchored full-width with rounded top
 *     corners; on `sm:+` it falls back to the centered variant. Used by
 *     `EntryEditModal`, `CardModal`, and `DayPickerModal` so the small-
 *     screen UX is a native-feeling bottom sheet without introducing a
 *     new bottom-sheet library — Radix Dialog's positioning is pure
 *     className, so the variant is a 1-file primitive change.
 *
 * Locked decision: do NOT add a separate primitive. The variant prop
 * keeps focus management / Escape / overlay behaviour from Radix Dialog
 * (free a11y); only the placement classes differ.
 */
export type DialogContentVariant = 'centered' | 'bottom-sheet';

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  variant?: DialogContentVariant;
}

const dialogContentBaseClasses =
  'z-50 grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0';

// `centered` — original positioning, original animation.
const dialogContentCenteredClasses =
  'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg';

// `bottom-sheet` — on `< sm` the dialog is anchored to the bottom edge
// (full-width, rounded-top); on `sm:+` it falls back to the centered
// classes so the layout stays familiar on tablet / desktop.
//
// Slide-up animation via Tailwind animate utilities. `data-[state=open]:
// slide-in-from-bottom` is the bottom-sheet-specific entrance; centered's
// `zoom-in-95` is suppressed on `< sm` and re-applied on `sm:+`.
//
// IMPORTANT: do NOT add `sm:inset-x-auto` to the `sm:+` overrides — it is
// the longhand parent of `left/right`, so it cancels the `sm:left-1/2`
// centering and leaves the dialog at left:auto with `-translate-x-1/2`,
// which shifts it ~256px off-screen to the LEFT on desktop. `sm:right-auto`
// is the only longhand we need to unset the base `inset-x-0` on the X axis;
// `sm:left-1/2` then takes effect cleanly.
const dialogContentBottomSheetClasses =
  'fixed inset-x-0 bottom-0 top-auto translate-x-0 translate-y-0 rounded-t-lg rounded-b-none data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom max-h-[85vh] overflow-y-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:right-auto sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:max-h-none sm:overflow-y-visible sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95';

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, variant = 'centered', ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-variant={variant}
      className={cn(
        dialogContentBaseClasses,
        variant === 'bottom-sheet' ? dialogContentBottomSheetClasses : dialogContentCenteredClasses,
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
