import { useRef, useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import { AI_MENTION_PATTERN } from 'librechat-data-provider';
import { TextareaAutosize } from '@librechat/client';
import { useLocalize } from '~/hooks';
import {
  useSendRoomMessageMutation,
  useCreateRoomPollMutation,
  useRoomTypingMutation,
} from '~/data-provider';
import AttachFileButton from './AttachFileButton';
import { cn } from '~/utils';

export const parsePollCommand = (text: string): { question: string; options: string[] } | null => {
  if (!text.toLowerCase().startsWith('/poll ')) {
    return null;
  }
  const [question, ...options] = text
    .slice(6)
    .split('|')
    .map((part) => part.trim());
  return { question: question ?? '', options };
};

export const splitAiMentions = (text: string): { text: string; mention: boolean }[] => {
  const pattern = new RegExp(AI_MENTION_PATTERN.source, 'gi');
  const segments: { text: string; mention: boolean }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[1].length;
    const end = (match.index ?? 0) + match[0].length;
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), mention: false });
    }
    segments.push({ text: text.slice(start, end), mention: true });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), mention: false });
  }
  return segments;
};

const MESSAGE_CAP = 8000;
const TYPING_THROTTLE_MS = 2000;

export default function MessageInput({ roomId, disabled }: { roomId: string; disabled: boolean }) {
  const localize = useLocalize();
  const [text, setText] = useState('');
  const lastTypingAt = useRef(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sendMessage = useSendRoomMessageMutation(roomId);
  const createPoll = useCreateRoomPollMutation(roomId);
  const sendTyping = useRoomTypingMutation(roomId);

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > MESSAGE_CAP || sendMessage.isLoading) {
      return;
    }
    const poll = parsePollCommand(trimmed);
    if (poll) {
      createPoll.mutate(poll);
    } else {
      sendMessage.mutate(trimmed);
    }
    setText('');
  };

  const onChange = (value: string) => {
    setText(value);
    const now = Date.now();
    if (!disabled && now - lastTypingAt.current >= TYPING_THROTTLE_MS) {
      lastTypingAt.current = now;
      sendTyping.mutate();
    }
  };

  const aiWillRespond = !disabled && AI_MENTION_PATTERN.test(text);

  return (
    <div className="px-4 pb-4 pt-2">
      {aiWillRespond && (
        <div className="pb-2" role="status">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-tertiary px-2 py-[3px] text-xs font-semibold text-text-secondary">
            <span className="size-1.5 rounded-full bg-surface-submit" aria-hidden="true" />
            {localize('com_ui_brainstorm_ai_will_respond')}
          </span>
        </div>
      )}
      <div className="flex items-end gap-2">
        <AttachFileButton roomId={roomId} disabled={disabled} />
        <div
          className={cn(
            'relative flex-1 rounded-2xl border bg-surface-primary transition-[border-color,box-shadow] duration-150',
            aiWillRespond
              ? 'border-[var(--illini-orange)] shadow-[0_0_0_3px_rgba(255,95,5,0.15)]'
              : 'border-[var(--illini-blue-border)] focus-within:border-[var(--illini-orange)] focus-within:shadow-[0_0_0_3px_rgba(255,95,5,0.15)]',
          )}
        >
          <div
            ref={overlayRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-sm text-text-primary"
          >
            {splitAiMentions(text).map((segment, i) =>
              segment.mention ? (
                <span
                  key={i}
                  className="text-[color:var(--illini-orange-deep)] [-webkit-text-stroke:0.5px_var(--illini-orange-deep)] dark:text-[color:var(--illini-orange)] dark:[-webkit-text-stroke:0.5px_var(--illini-orange)]"
                >
                  {segment.text}
                </span>
              ) : (
                <span key={i}>{segment.text}</span>
              ),
            )}
          </div>
          <TextareaAutosize
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onScroll={(e) => {
              if (overlayRef.current) {
                overlayRef.current.scrollTop = e.currentTarget.scrollTop;
              }
            }}
            disabled={disabled}
            maxLength={MESSAGE_CAP}
            maxRows={6}
            placeholder={localize('com_ui_brainstorm_input_placeholder')}
            aria-label={localize('com_ui_brainstorm_input_placeholder')}
            className="relative block w-full resize-none bg-transparent px-3 py-2 text-sm text-transparent caret-[color:var(--text-primary)] placeholder:text-text-secondary focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || text.trim().length === 0}
          aria-label={localize('com_ui_brainstorm_send')}
          className="flex items-center gap-2 rounded-lg bg-surface-submit px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-surface-submit-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendHorizontal className="size-4" aria-hidden="true" />
          {localize('com_ui_brainstorm_send')}
        </button>
      </div>
    </div>
  );
}
