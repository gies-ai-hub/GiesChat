import React from 'react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { AdminModelTestRequest } from 'librechat-data-provider';
import ModelTest from '../ModelTest';

const mockRun = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      runAdminModelTest: (payload: AdminModelTestRequest) => mockRun(payload),
    },
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const models = ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.4'];

function renderTest(agentId = 'agent_prod') {
  const onUse = jest.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ModelTest
        provider="Azure OpenAI"
        models={models}
        current="gpt-6-luna"
        agentId={agentId}
        instructions="You coach BADM 350 students."
        onUse={onUse}
      />
    </QueryClientProvider>,
  );
  return onUse;
}

beforeEach(() => mockRun.mockReset());

describe('ModelTest', () => {
  it('runs both models on the typed questions and hands the pick back to the form', async () => {
    mockRun.mockResolvedValue({
      results: [
        {
          question: 'What is the late policy?',
          answers: [
            { model: 'gpt-6-luna', text: 'Ten percent a day.', ms: 1200 },
            {
              model: 'gpt-6-sol',
              text: 'Late work loses 10% per day, per the syllabus.',
              ms: 2400,
            },
          ],
        },
      ],
    });
    const onUse = renderTest();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_model_test' }));
    expect(screen.getByLabelText('com_ui_model_test_a')).toHaveValue('gpt-6-luna');
    expect(screen.getByLabelText('com_ui_model_test_b')).toHaveValue('gpt-6-sol');
    expect(screen.queryByRole('option', { name: 'gpt-5.4' })).not.toBeInTheDocument();

    await userEvent.type(
      screen.getByLabelText('com_ui_model_test_question {"n":1}'),
      'What is the late policy?',
    );
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_model_test_run' }));

    await waitFor(() => expect(screen.getByText('Ten percent a day.')).toBeInTheDocument());
    expect(mockRun).toHaveBeenCalledWith({
      agent_id: 'agent_prod',
      instructions: 'You coach BADM 350 students.',
      models: ['gpt-6-luna', 'gpt-6-sol'],
      questions: ['What is the late policy?'],
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'com_ui_model_test_use {"model":"gpt-6-sol"}' }),
    );
    expect(onUse).toHaveBeenCalledWith('gpt-6-sol');
  });

  it('refuses to run without a question and never calls the server', async () => {
    renderTest();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_model_test' }));
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_model_test_run' }));
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_model_test_no_questions');
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('shows an error when the test fails', async () => {
    mockRun.mockRejectedValue(new Error('503'));
    renderTest();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_model_test' }));
    await userEvent.type(screen.getByLabelText('com_ui_model_test_question {"n":1}'), 'Hi');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_model_test_run' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('com_ui_model_test_error'),
    );
  });

  it('sends no agent id for an agent that has not been created', async () => {
    mockRun.mockResolvedValue({ results: [] });
    renderTest('');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_model_test' }));
    expect(screen.getByText('com_ui_model_test_intro_new')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('com_ui_model_test_question {"n":1}'), 'Hi');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_model_test_run' }));
    await waitFor(() => expect(mockRun).toHaveBeenCalled());
    expect(mockRun.mock.calls[0][0].agent_id).toBeUndefined();
  });
});
