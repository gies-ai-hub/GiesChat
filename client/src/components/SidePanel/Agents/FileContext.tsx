import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { v4 } from 'uuid';
import * as Ariakit from '@ariakit/react';
import { Folder, Plus, Info, X } from 'lucide-react';
import { EModelEndpoint, EToolResources, mergeFileConfig } from 'librechat-data-provider';
import { DropdownPopup, SharePointIcon, TooltipAnchor, useToastContext } from '@librechat/client';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { ExtendedFile } from '~/common';
import { useSharePointFileHandlingNoChatContext } from '~/hooks/Files/useSharePointFileHandling';
import { useFileHandlingNoChatContext } from '~/hooks/Files/useFileHandling';
import { useGetFileConfig, useGetStartupConfig } from '~/data-provider';
import { useAgentFileConfig, useLocalize, useLazyEffect } from '~/hooks';
import { SharePointPickerDialog } from '~/components/SharePoint';
import FileRow from '~/components/Chat/Input/Files/FileRow';
import { useAgentPanelContext } from '~/Providers';
import { isEphemeralAgent } from '~/common';
import { validateFiles, cn } from '~/utils';

const addButtonClassName = cn(
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary transition-colors',
  'hover:bg-surface-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary',
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-secondary',
);

function FileContext({
  agent_id,
  files: _files,
  showHeader = true,
}: {
  agent_id: string;
  files?: [string, ExtendedFile][];
  showHeader?: boolean;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Map<string, ExtendedFile>>(new Map());
  const fileHandlingState = useMemo(() => ({ files, setFiles, conversation: null }), [files]);
  const [isPopoverActive, setIsPopoverActive] = useState(false);
  const [isSharePointDialogOpen, setIsSharePointDialogOpen] = useState(false);
  const { data: startupConfig } = useGetStartupConfig();
  const { data: fileConfig = null } = useGetFileConfig({ select: (data) => mergeFileConfig(data) });
  const sharePointEnabled = startupConfig?.sharePointFilePickerEnabled;
  const { endpointFileConfig, providerValue, endpointType } = useAgentFileConfig();
  const endpointOverride = providerValue || EModelEndpoint.agents;
  const agentExists = !isEphemeralAgent(agent_id);
  /**
   * Held in panel context, not here: `AgentConfig` unmounts while the newly created
   * agent is fetched and the form is reset from it, either of which would discard
   * files picked before the agent existed.
   */
  const { pendingContextFiles: pendingFiles, setPendingContextFiles } = useAgentPanelContext();

  const { handleFileChange } = useFileHandlingNoChatContext(
    {
      additionalMetadata: { agent_id, tool_resource: EToolResources.context },
      endpointOverride,
      endpointTypeOverride: endpointType,
      fileSetter: setFiles,
    },
    fileHandlingState,
  );
  const { handleSharePointFiles, isProcessing, downloadProgress } =
    useSharePointFileHandlingNoChatContext(
      {
        additionalMetadata: { agent_id, tool_resource: EToolResources.context },
        endpointOverride,
        endpointTypeOverride: endpointType,
        fileSetter: setFiles,
      },
      fileHandlingState,
    );
  useLazyEffect(
    () => {
      if (_files) {
        setFiles(new Map(_files));
      }
    },
    [_files],
    750,
  );

  const stageFiles = useCallback(
    (fileList: File[]) => {
      const errors: string[] = [];
      const filesAreValid = validateFiles({
        files,
        fileList,
        setError: (error) => errors.push(error),
        fileConfig,
        endpointFileConfig,
      });
      if (!filesAreValid) {
        const error = errors[0] ?? 'com_error_files_validation';
        showToast({ message: localize(error as TranslationKeys) || error, status: 'error' });
        return;
      }
      const staged = fileList.map((file) => ({ id: v4(), file }));
      setPendingContextFiles((current) => [...current, ...staged]);
    },
    [files, fileConfig, endpointFileConfig, setPendingContextFiles, showToast, localize],
  );

  const removePendingFile = useCallback(
    (id: string) => {
      setPendingContextFiles((current) => current.filter((pending) => pending.id !== id));
    },
    [setPendingContextFiles],
  );

  const isUploadDisabled = endpointFileConfig?.disabled ?? false;
  const handleSharePointFilesSelected = async (sharePointFiles: any[]) => {
    try {
      await handleSharePointFiles(sharePointFiles);
      setIsSharePointDialogOpen(false);
    } catch (error) {
      console.error('SharePoint file processing error:', error);
    }
  };
  if (isUploadDisabled) {
    return null;
  }

  const handleLocalFileClick = () => {
    // necessary to reset the input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    fileInputRef.current?.click();
  };
  const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (agentExists) {
      handleFileChange(event);
      return;
    }
    event.stopPropagation();
    const selected = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (selected.length > 0) {
      stageFiles(selected);
    }
  };
  const dropdownItems = [
    {
      label: localize('com_files_upload_local_machine'),
      onClick: handleLocalFileClick,
      icon: <Folder className="icon-md" />,
    },
    {
      label: localize('com_files_upload_sharepoint'),
      onClick: () => setIsSharePointDialogOpen(true),
      icon: <SharePointIcon className="icon-md" />,
    },
  ];

  const addLabel = localize('com_ui_upload_file_context');
  const fileCount = files.size + pendingFiles.length;

  /** SharePoint downloads upload immediately, so they need a saved agent to attach to */
  const addControl =
    sharePointEnabled && agentExists ? (
      <DropdownPopup
        gutter={2}
        menuId="file-context-upload-menu"
        isOpen={isPopoverActive}
        setIsOpen={setIsPopoverActive}
        trigger={
          <Ariakit.MenuButton aria-label={addLabel} className={addButtonClassName}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            {localize('com_ui_add')}
          </Ariakit.MenuButton>
        }
        items={dropdownItems}
        modal={true}
        unmountOnHide={true}
      />
    ) : (
      <button
        type="button"
        aria-label={addLabel}
        className={addButtonClassName}
        onClick={handleLocalFileClick}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
        {localize('com_ui_add')}
      </button>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {showHeader ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[11px] font-medium uppercase tracking-wide text-text-secondary">
              {localize('com_agents_file_context_label')}
            </span>
            <TooltipAnchor
              description={localize('com_agents_file_context_description')}
              side="top"
              render={
                <button
                  type="button"
                  aria-label={localize('com_agents_file_context_description')}
                  className="flex size-4 shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
                >
                  <Info className="size-3.5" aria-hidden="true" />
                </button>
              }
            />
            {fileCount > 0 && (
              <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-surface-tertiary px-1.5 text-[10px] font-medium text-text-secondary">
                {fileCount}
              </span>
            )}
          </div>
        ) : (
          <span />
        )}
        {addControl}
      </div>
      {files.size > 0 && (
        <FileRow
          files={files}
          setFiles={setFiles}
          agent_id={agent_id}
          tool_resource={EToolResources.context}
          Wrapper={({ children }) => <div className="flex flex-wrap gap-2">{children}</div>}
        />
      )}
      {pendingFiles.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((pending) => (
              <div
                key={pending.id}
                className="flex max-w-full items-center gap-1.5 rounded-lg border border-dashed border-border-medium bg-surface-secondary px-2 py-1"
              >
                <span className="truncate text-xs text-text-primary">{pending.file.name}</span>
                <button
                  type="button"
                  aria-label={`${localize('com_ui_delete')} ${pending.file.name}`}
                  onClick={() => removePendingFile(pending.id)}
                  className="flex size-4 shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <p className="text-[11px] leading-snug text-text-secondary">
            {localize('com_agents_file_context_pending')}
          </p>
        </div>
      )}
      <input
        multiple={true}
        type="file"
        style={{ display: 'none' }}
        tabIndex={-1}
        ref={fileInputRef}
        onChange={onFileInputChange}
      />
      <SharePointPickerDialog
        isOpen={isSharePointDialogOpen}
        onOpenChange={setIsSharePointDialogOpen}
        onFilesSelected={handleSharePointFilesSelected}
        isDownloading={isProcessing}
        downloadProgress={downloadProgress}
        maxSelectionCount={endpointFileConfig?.fileLimit}
      />
    </div>
  );
}

const MemoizedFileContext = memo(FileContext);
MemoizedFileContext.displayName = 'FileContext';

export default MemoizedFileContext;
