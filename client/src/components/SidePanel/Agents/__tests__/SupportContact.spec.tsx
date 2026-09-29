import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import '@testing-library/jest-dom/extend-expect';
import type { AgentForm } from '~/common';
import SupportContact from '../SupportContact';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  useAuthContext: () => ({ user: { name: 'Ellen Hart', email: 'ehart@illinois.edu' } }),
}));

let latest: AgentForm['support_contact'];

function Harness({ initial }: { initial?: { name: string; email: string } }) {
  const methods = useForm<AgentForm>({
    defaultValues: { id: 'agent_1', support_contact: initial } as Partial<AgentForm>,
  });
  latest = methods.watch('support_contact');
  return (
    <FormProvider {...methods}>
      <SupportContact />
    </FormProvider>
  );
}

describe('SupportContact', () => {
  it('fills in the signed-in professor when they pick Me', async () => {
    render(<Harness />);
    expect(screen.getByText('com_ui_support_contact_question')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/^com_ui_support_contact_me/));
    expect(screen.getByText('Ellen Hart')).toBeInTheDocument();
    expect(latest).toEqual({ name: 'Ellen Hart', email: 'ehart@illinois.edu' });
  });

  it('takes someone else, validates the email, then shows the card', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText(/^com_ui_support_contact_other/));
    await userEvent.type(screen.getByLabelText('com_ui_support_contact_name'), 'Jordan Kim');
    await userEvent.type(screen.getByLabelText('com_ui_support_contact_email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_support_contact_done' }));
    expect(await screen.findByText('com_ui_support_contact_email_invalid')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('com_ui_support_contact_email'));
    await userEvent.type(
      screen.getByLabelText('com_ui_support_contact_email'),
      'jkim42@illinois.edu',
    );
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_support_contact_done' }));
    expect(await screen.findByText('Jordan Kim')).toBeInTheDocument();
    expect(latest).toEqual({ name: 'Jordan Kim', email: 'jkim42@illinois.edu' });
  });

  it('refuses Done with both fields empty', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText(/^com_ui_support_contact_other/));
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_support_contact_done' }));
    expect(await screen.findByText('com_ui_support_contact_empty')).toBeInTheDocument();
  });

  it('opens an existing contact as a card; Edit then Cancel keeps it, Remove clears it', async () => {
    render(<Harness initial={{ name: 'Jordan Kim', email: 'jkim42@illinois.edu' }} />);
    expect(screen.getByText('Jordan Kim')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_edit' }));
    const nameInput = screen.getByLabelText('com_ui_support_contact_name');
    expect(nameInput).toHaveValue('Jordan Kim');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Someone Else');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));
    expect(screen.getByText('Jordan Kim')).toBeInTheDocument();
    expect(latest).toEqual({ name: 'Jordan Kim', email: 'jkim42@illinois.edu' });

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_support_contact_remove' }));
    expect(screen.getByText('com_ui_support_contact_question')).toBeInTheDocument();
    expect(latest).toEqual({ name: '', email: '' });
  });
});
