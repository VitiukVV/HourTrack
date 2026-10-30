import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from './dialog';

describe('DialogContent', () => {
  // Spec 014: the content is a CSS grid whose implicit column grew to the
  // min-content of an unbreakable line (a one-line sync error), pushing the
  // sheet past the phone's edge. The column must never outgrow the dialog.
  it.each(['centered', 'bottom-sheet'] as const)(
    'pins the %s grid column to the dialog width',
    (variant) => {
      render(
        <Dialog open>
          <DialogContent variant={variant} aria-describedby={undefined}>
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </Dialog>,
      );
      expect(screen.getByRole('dialog').className).toContain('grid-cols-[minmax(0,1fr)]');
    },
  );
});
