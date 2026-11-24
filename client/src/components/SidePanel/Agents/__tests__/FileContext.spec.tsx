import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import { EModelEndpoint, mergeFileConfig } from 'librechat-data-provider';
import type { TEndpointsConfig } from 'librechat-data-provider';
import type { AgentForm } from '~/common';
import FileContext from '../FileContext';

const mockEndpointsConfig: TEndpointsConfig = {
  [EModelEndpoint.agents]: { userProvide: false, order: 1 },
  Moonshot: { type: EModelEndpoint.custom, userProvide: false, order: 9999 },
};

let mockFileConfig = mergeFileConfig({ endpoints: { default: { fileLimit: 10 } } });

let mockPendingFiles: { id: string; file: File }[] = [];
const mockSetPendingFiles = jest.fn();

jest.mock('~/Providers', () => ({
  useAgentPanelContext: () => ({
    pendingContextFiles: mockPendingFiles,
    setPendingContextFiles: mockSetPendingFiles,
  }),
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: mockEndpointsConfig }),
  useGetFileConfig: ({ select }: { select?: (d: unknown) => unknown }) => ({
    data: select != null ? select(mockFileConfig) : mockFileConfig,
  }),
  useGetStartupConfig: () => ({ data: { sharePointFilePickerEnabled: false } }),
}));

jest.mock('~/hooks', () => ({
  useAgentFileConfig: jest.requireActual('~/hooks/Agents/useAgentFileConfig').default,
  useLocalize: () => (key: string) => key,
  useLazyEffect: () => {},
}));

const mockUseFileHandlingNoChatContext = jest.fn().mockReturnValue({
  handleFileChange: jest.fn(),
});

jest.mock('~/hooks/Files/useFileHandling', () => ({
  useFileHandlingNoChatContext: (...args: unknown[]) => mockUseFileHandlingNoChatContext(...args),
}));

jest.mock('~/hooks/Files/useSharePointFileHandling', () => ({
  useSharePointFileHandlingNoChatContext: () => ({
    handleSharePointFiles: jest.fn(),
    isProcessing: false,
    downloadProgress: 0,
  }),
}));

jest.mock('~/components/SharePoint', () => ({
  SharePointPickerDialog: () => null,
}));

jest.mock('~/components/Chat/Input/Files/FileRow', () => () => null);

jest.mock('@ariakit/react', () => ({
  MenuButton: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: jest.fn() }),
  SharePointIcon: () => <span />,
  DropdownPopup: () => null,
  TooltipAnchor: ({ render }: { render: React.ReactElement }) => render,
  CircleHelpIcon: () => <span />,
  HoverCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  HoverCardPortal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  HoverCardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  HoverCardTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function Wrapper({ provider, children }: { provider?: string; children: React.ReactNode }) {
  const methods = useForm<AgentForm>({
    defaultValues: { provider: provider as AgentForm['provider'] },
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
}

describe('FileContext', () => {
  it('renders upload UI when file uploads are not disabled', () => {
    mockFileConfig = mergeFileConfig({ endpoints: { default: { fileLimit: 10 } } });
    render(
      <Wrapper provider="Moonshot">
        <FileContext agent_id="agent-1" />
      </Wrapper>,
    );
    expect(screen.getByText('com_agents_file_context_label')).toBeInTheDocument();
  });

  it('returns null when file config is disabled', () => {
    mockFileConfig = mergeFileConfig({
      endpoints: { Moonshot: { disabled: true }, default: { fileLimit: 10 } },
    });
    const { container } = render(
      <Wrapper provider="Moonshot">
        <FileContext agent_id="agent-1" />
      </Wrapper>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('returns null when agents endpoint config is disabled and provider has no specific config', () => {
    mockFileConfig = mergeFileConfig({
      endpoints: { [EModelEndpoint.agents]: { disabled: true }, default: { fileLimit: 10 } },
    });
    const { container } = render(
      <Wrapper>
        <FileContext agent_id="agent-1" />
      </Wrapper>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('passes provider as endpointOverride and resolved type as endpointTypeOverride', () => {
    mockFileConfig = mergeFileConfig({ endpoints: { default: { fileLimit: 10 } } });
    mockUseFileHandlingNoChatContext.mockClear();
    render(
      <Wrapper provider="Moonshot">
        <FileContext agent_id="agent-1" />
      </Wrapper>,
    );
    const params = mockUseFileHandlingNoChatContext.mock.calls[0][0];
    expect(params.endpointOverride).toBe('Moonshot');
    expect(params.endpointTypeOverride).toBe(EModelEndpoint.custom);
  });

  it('passes a host document limit to the upload handler', () => {
    mockFileConfig = mergeFileConfig({ endpoints: { default: { fileLimit: 10 } } });
    mockUseFileHandlingNoChatContext.mockClear();
    render(
      <Wrapper provider="Moonshot">
        <FileContext agent_id="agent-1" fileLimit={50} />
      </Wrapper>,
    );
    expect(mockUseFileHandlingNoChatContext.mock.calls[0][0].fileLimit).toBe(50);
  });

  it('falls back to agents for endpointOverride when no provider', () => {
    mockFileConfig = mergeFileConfig({ endpoints: { default: { fileLimit: 10 } } });
    mockUseFileHandlingNoChatContext.mockClear();
    render(
      <Wrapper>
        <FileContext agent_id="agent-1" />
      </Wrapper>,
    );
    const params = mockUseFileHandlingNoChatContext.mock.calls[0][0];
    expect(params.endpointOverride).toBe(EModelEndpoint.agents);
    expect(params.endpointTypeOverride).toBe(EModelEndpoint.agents);
  });

  it('renders when provider has no specific config and agents config is enabled', () => {
    mockFileConfig = mergeFileConfig({
      endpoints: {
        [EModelEndpoint.agents]: { fileLimit: 20 },
        default: { fileLimit: 10 },
      },
    });
    render(
      <Wrapper provider="Moonshot">
        <FileContext agent_id="agent-1" />
      </Wrapper>,
    );
    expect(screen.getByText('com_agents_file_context_label')).toBeInTheDocument();
  });

  describe('before the agent is created', () => {
    const pdfs = (count: number) =>
      Array.from(
        { length: count },
        (_, i) => new File(['x'], `doc${i}.pdf`, { type: 'application/pdf' }),
      );
    const stage = (files: File[]) => {
      const { container } = render(
        <Wrapper>
          <FileContext agent_id="ephemeral" fileLimit={100} />
        </Wrapper>,
      );
      fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
        target: { files },
      });
    };

    beforeEach(() => {
      mockFileConfig = mergeFileConfig({ endpoints: { default: { fileLimit: 10 } } });
      mockSetPendingFiles.mockClear();
      mockPendingFiles = [];
    });

    it('stages more than the endpoint limit in one pick when the host allows it', () => {
      stage(pdfs(40));
      expect(mockSetPendingFiles).toHaveBeenCalledTimes(1);
    });

    it('counts already staged files against the host limit', () => {
      mockPendingFiles = pdfs(95).map((file, i) => ({ id: String(i), file }));
      stage(pdfs(6));
      expect(mockSetPendingFiles).not.toHaveBeenCalled();
    });
  });
});
