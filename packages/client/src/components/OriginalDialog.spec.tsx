import React, { useState } from 'react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { OGDialog, OGDialogTitle, OGDialogContent, OGDialogTrigger } from './OriginalDialog';

/** A controlled dialog opened from a plain button, the way the dashboard's row actions open theirs. */
function Controlled({ swapped = false }: { swapped?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <OGDialog open={open} onOpenChange={setOpen}>
        <OGDialogContent>
          <OGDialogTitle>Settings</OGDialogTitle>
          {swapped ? <p>Saved</p> : <input aria-label="Name" />}
        </OGDialogContent>
      </OGDialog>
    </>
  );
}

function Nested() {
  const [inner, setInner] = useState(false);
  return (
    <OGDialog open>
      <OGDialogContent>
        <OGDialogTitle>Builder</OGDialogTitle>
        <button type="button" onClick={() => setInner(true)}>
          Test models
        </button>
        <OGDialog open={inner} onOpenChange={setInner}>
          <OGDialogContent>
            <OGDialogTitle>Compare</OGDialogTitle>
            <input aria-label="Question" />
          </OGDialogContent>
        </OGDialog>
      </OGDialogContent>
    </OGDialog>
  );
}

describe('OGDialogContent focus', () => {
  it('returns focus to the control that opened a dialog with no trigger', async () => {
    render(<Controlled />);
    const opener = screen.getByRole('button', { name: 'Open' });

    await userEvent.click(opener);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('leaves focus to Radix when the dialog has a trigger', async () => {
    render(
      <OGDialog>
        <OGDialogTrigger>Edit</OGDialogTrigger>
        <OGDialogContent>
          <OGDialogTitle>Edit</OGDialogTitle>
        </OGDialogContent>
      </OGDialog>,
    );
    const trigger = screen.getByRole('button', { name: 'Edit' });

    await userEvent.click(trigger);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps focus inside when the focused control is swapped out after open', async () => {
    const { rerender } = render(<Controlled />);

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus());
    rerender(<Controlled swapped />);

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
  });

  it('returns focus inside the still-open parent when a nested dialog closes', async () => {
    render(<Nested />);
    const opener = screen.getByRole('button', { name: 'Test models' });

    await userEvent.click(opener);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Question' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.getByRole('dialog', { name: 'Builder' })).toBeInTheDocument();
  });
});
