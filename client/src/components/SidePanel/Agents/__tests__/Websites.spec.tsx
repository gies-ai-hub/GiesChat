import React from 'react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TFile } from 'librechat-data-provider';
import Websites from '../Websites';

const mockPreview = jest.fn();
const mockSave = jest.fn();
const mockAgentFiles = jest.fn();
const mockSetPending = jest.fn();
let mockPending: string[] = [];

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      previewAdminWebsite: (url: string) => mockPreview(url),
      saveAdminAgentWebsite: (agentId: string, url: string) => mockSave(agentId, url),
      getAgentFiles: (agentId: string) => mockAgentFiles(agentId),
    },
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

jest.mock('~/Providers', () => ({
  useAgentPanelContext: () => ({
    pendingWebsites: mockPending,
    setPendingWebsites: mockSetPending,
  }),
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('recoil', () => ({ ...jest.requireActual('recoil'), useRecoilValue: () => true }));

const URL_A = 'https://badm350.web.illinois.edu/schedule/';
const copy = {
  file_id: 'site_1',
  filename: 'Website · badm350.web.illinois.edu/schedule',
  filepath: URL_A,
  embedded: true,
  source: 'text',
  metadata: { sourceUrl: URL_A, pages: 14, checkedAt: '2026-10-12T02:00:00.000Z' },
} as unknown as TFile;
const syllabus = { file_id: 'pdf_1', filename: 'Syllabus.pdf' } as TFile;

function renderWebsites(agentId = 'agent_prod') {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Websites agent_id={agentId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  [mockPreview, mockSave, mockAgentFiles, mockSetPending].forEach((mock) => mock.mockReset());
  mockAgentFiles.mockResolvedValue([copy, syllabus]);
  mockPending = [];
});

describe('Websites', () => {
  it('lists saved copies only, with page count', async () => {
    renderWebsites();

    expect(await screen.findByText('badm350.web.illinois.edu/schedule/')).toBeInTheDocument();
    expect(screen.getByText('com_agents_websites_saved_badge {"0":14}')).toBeInTheDocument();
    expect(screen.queryByText('Syllabus.pdf')).not.toBeInTheDocument();
  });

  it('Test shows pages and skipped links without saving; Add from the panel saves', async () => {
    const url = 'https://badm350.web.illinois.edu/readings/';
    mockPreview.mockResolvedValue({
      url,
      pages: [{ url, title: 'Week 5', text: '## Week 5', words: 3, cleaned: true }],
      skipped: [{ url: 'https://youtube.com/', reason: 'offsite' }],
    });
    mockSave.mockResolvedValue({
      website: { file_id: 'site_2', url, pages: 1, checkedAt: '2026-10-13T00:00:00.000Z' },
    });
    renderWebsites();

    await userEvent.type(screen.getByLabelText('com_agents_websites_label'), url);
    await userEvent.click(screen.getByRole('button', { name: 'com_agents_websites_test' }));

    expect(await screen.findByText('Week 5')).toBeInTheDocument();
    expect(screen.getByText('com_agents_websites_skip_offsite · 1')).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'com_agents_websites_add_this' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('agent_prod', url));
  });

  it('groups skipped links by reason with a count, so site menus do not flood the panel', async () => {
    const url = 'https://badm350.web.illinois.edu/readings/';
    mockPreview.mockResolvedValue({
      url,
      pages: [{ url, title: 'Readings', text: 'text', words: 1, cleaned: true }],
      skipped: [
        { url: 'https://badm350.web.illinois.edu/schedule/', reason: 'outside' },
        { url: 'https://badm350.web.illinois.edu/apply/', reason: 'outside' },
        { url: 'https://youtube.com/', reason: 'offsite' },
      ],
    });
    renderWebsites();

    await userEvent.type(screen.getByLabelText('com_agents_websites_label'), url);
    await userEvent.click(screen.getByRole('button', { name: 'com_agents_websites_test' }));

    expect(await screen.findByText('com_agents_websites_skip_outside · 2')).toBeInTheDocument();
    expect(screen.getByText('com_agents_websites_skip_offsite · 1')).toBeInTheDocument();
    expect(screen.getByText('badm350.web.illinois.edu/apply/')).toBeInTheDocument();
  });

  it('rejects a bad or duplicate address without calling the server', async () => {
    renderWebsites();
    await screen.findByText('badm350.web.illinois.edu/schedule/');
    const input = screen.getByLabelText('com_agents_websites_label');

    await userEvent.type(input, 'badm350 schedule');
    await userEvent.click(screen.getByRole('button', { name: 'com_agents_websites_add' }));
    expect(screen.getByText('com_agents_websites_invalid')).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, URL_A);
    await userEvent.click(screen.getByRole('button', { name: 'com_agents_websites_add' }));
    expect(screen.getByText('com_agents_websites_duplicate')).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('saves once even when Add is clicked twice', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockSave.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderWebsites();
    await userEvent.type(
      screen.getByLabelText('com_agents_websites_label'),
      'https://fin300.web.illinois.edu/',
    );
    const add = screen.getByRole('button', { name: 'com_agents_websites_add' });

    await userEvent.click(add);
    await userEvent.click(add);

    expect(mockSave).toHaveBeenCalledTimes(1);
    finish({
      website: {
        file_id: 'x',
        url: 'https://fin300.web.illinois.edu/',
        pages: 2,
        checkedAt: '2026-10-13T00:00:00.000Z',
      },
    });
  });

  it('stages addresses for an agent that is not created yet', async () => {
    renderWebsites('');

    await userEvent.type(
      screen.getByLabelText('com_agents_websites_label'),
      'https://fin300.web.illinois.edu/lectures/',
    );
    await userEvent.click(screen.getByRole('button', { name: 'com_agents_websites_add' }));

    expect(mockSave).not.toHaveBeenCalled();
    expect(mockSetPending).toHaveBeenCalled();
  });
});
