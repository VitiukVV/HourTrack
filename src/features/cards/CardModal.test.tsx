import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n/i18n';
import { withUnhandledRejections } from '@/test-utils/withUnhandledRejections';

const createMutateAsync = vi.fn();
vi.mock('./useCards', () => ({
  useCreateCardMutation: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateCardMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (msg: string) => toastError(msg) } }));

import { CardModal } from './CardModal';

/** Spec 009 — only a failed write is reported as "couldn't save". */

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function fillAndSave() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Name/i), 'Raquel');
  const rate = screen.getByLabelText(/Hourly rate/i);
  await user.clear(rate);
  await user.type(rate, '25');
  await user.click(screen.getByRole('button', { name: /^Save$/i }));
}

describe('CardModal — save', () => {
  it('a failed create toasts and keeps the dialog open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    createMutateAsync.mockRejectedValueOnce(new Error('disk full'));
    const onOpenChange = vi.fn();
    render(<CardModal open mode="create" onOpenChange={onOpenChange} />);

    await fillAndSave();

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('a throw from the parent after a successful create is not "couldn\'t save"', async () => {
    await withUnhandledRejections(async (unhandled) => {
      createMutateAsync.mockResolvedValueOnce({ id: 'c1' });
      const onOpenChange = vi.fn(() => {
        throw new Error('parent broke');
      });
      render(<CardModal open mode="create" onOpenChange={onOpenChange} />);

      await fillAndSave();

      await waitFor(() => expect(unhandled).toHaveBeenCalledTimes(1));
      expect(createMutateAsync).toHaveBeenCalledTimes(1);
      expect(toastError).not.toHaveBeenCalled();
    });
  });
});
