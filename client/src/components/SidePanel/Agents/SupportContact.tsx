import { useRef, useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { Input, Button } from '@librechat/client';
import { Controller, useWatch, useFormContext } from 'react-hook-form';
import type { AgentForm } from '~/common';
import { useLocalize, useAuthContext } from '~/hooks';
import { validateEmail, cn } from '~/utils';

type Contact = { name: string; email: string };

type Choice = 'me' | 'other' | 'none';

const EMPTY: Contact = { name: '', email: '' };
const fieldClass = 'h-9';
const NAME_ID = 'support-contact-name';
const EDIT_ID = 'support-contact-edit';
const QUESTION_ID = 'support-contact-question';
const choiceId = (choice: Choice) => `support-contact-${choice}`;

const initials = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/**
 * Who students should contact about the agent, asked as a question. Writes the same
 * `support_contact` field the old name/email inputs did; with none set, students see
 * the agent's author (`AgentContact`'s owner fallback), which is what "Not now" says.
 */
export default function SupportContact() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { control, setValue, trigger, clearErrors } = useFormContext<AgentForm>();
  const contact = useWatch({ control, name: 'support_contact' });
  const agentId = useWatch({ control, name: 'id' });
  const [editing, setEditing] = useState(false);
  const [notNow, setNotNow] = useState(false);
  const [problem, setProblem] = useState(false);
  const beforeEdit = useRef<Contact>(EMPTY);
  /** Each choice swaps the view, so the control that had focus is gone; land focus on its successor. */
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    if (focusNext.current != null) {
      document.getElementById(focusNext.current)?.focus();
      focusNext.current = null;
    }
  });

  useEffect(() => {
    setEditing(false);
    setNotNow(false);
    setProblem(false);
  }, [agentId]);

  const name = contact?.name?.trim() ?? '';
  const email = contact?.email?.trim() ?? '';
  const me: Contact = { name: user?.name ?? user?.username ?? '', email: user?.email ?? '' };

  const write = (next: Contact) =>
    setValue('support_contact', next, { shouldDirty: true, shouldValidate: false });

  const startEditing = (from: Contact) => {
    beforeEdit.current = { name, email };
    write(from);
    setProblem(false);
    setEditing(true);
    focusNext.current = NAME_ID;
  };

  const cancel = () => {
    const previous = beforeEdit.current;
    write(previous);
    clearErrors('support_contact');
    setProblem(false);
    setEditing(false);
    focusNext.current = previous.name !== '' || previous.email !== '' ? EDIT_ID : choiceId('other');
  };

  const done = async () => {
    const valid = await trigger(['support_contact.name', 'support_contact.email']);
    if (!valid) {
      return;
    }
    if (name === '' && email === '') {
      setProblem(true);
      return;
    }
    write({ name, email });
    setProblem(false);
    setEditing(false);
    focusNext.current = EDIT_ID;
  };

  const remove = () => {
    write(EMPTY);
    setNotNow(false);
    focusNext.current = choiceId('me');
  };

  if (editing) {
    return (
      <div className="space-y-2">
        <Controller
          name="support_contact.name"
          control={control}
          rules={{
            minLength: {
              value: 3,
              message: localize('com_ui_support_contact_name_min_length', { minLength: 3 }),
            },
          }}
          render={({ field, fieldState: { error } }) => (
            <div className="flex flex-col">
              <Input
                {...field}
                value={field.value ?? ''}
                className={cn(fieldClass, error && 'border-2 border-red-500')}
                id={NAME_ID}
                type="text"
                placeholder={localize('com_ui_support_contact_other_name')}
                aria-label={localize('com_ui_support_contact_name')}
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={error ? 'support-contact-name-error' : undefined}
              />
              {error && (
                <span
                  id="support-contact-name-error"
                  className="mt-1 text-xs text-red-500"
                  role="alert"
                >
                  {error.message}
                </span>
              )}
            </div>
          )}
        />
        <Controller
          name="support_contact.email"
          control={control}
          rules={{
            validate: (value) =>
              validateEmail(value ?? '', localize('com_ui_support_contact_email_invalid')),
          }}
          render={({ field, fieldState: { error } }) => (
            <div className="flex flex-col">
              <Input
                {...field}
                value={field.value ?? ''}
                className={cn(fieldClass, error && 'border-2 border-red-500')}
                id="support-contact-email"
                type="email"
                placeholder={localize('com_ui_support_contact_other_email')}
                aria-label={localize('com_ui_support_contact_email')}
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={error ? 'support-contact-email-error' : undefined}
              />
              {error && (
                <span
                  id="support-contact-email-error"
                  className="mt-1 text-xs text-red-500"
                  role="alert"
                >
                  {error.message}
                </span>
              )}
            </div>
          )}
        />
        {problem && (
          <span className="text-xs text-red-500" role="alert">
            {localize('com_ui_support_contact_empty')}
          </span>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={cancel}>
            {localize('com_ui_cancel')}
          </Button>
          <Button type="button" size="sm" onClick={() => void done()}>
            {localize('com_ui_support_contact_done')}
          </Button>
        </div>
      </div>
    );
  }

  if (name !== '' || email !== '') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border-light bg-surface-secondary p-3">
        <span
          aria-hidden="true"
          className="grid size-8 flex-none place-items-center rounded-full bg-[#13294b] text-xs font-bold text-white"
        >
          {initials(name || email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium text-text-primary">
            {name || email}
          </span>
          <span className="block break-words text-xs text-text-secondary">
            {localize('com_ui_support_contact_card_hint', {
              email: name && email ? `${email} · ` : '',
            })}
          </span>
        </span>
        <Button
          id={EDIT_ID}
          type="button"
          size="sm"
          variant="outline"
          onClick={() => startEditing({ name, email })}
        >
          {localize('com_ui_edit')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={remove}>
          {localize('com_ui_support_contact_remove')}
        </Button>
      </div>
    );
  }

  const options: { value: Choice; title: string; hint: string; pick: () => void }[] = [
    {
      value: 'me',
      title: localize('com_ui_support_contact_me'),
      hint: [me.name, me.email].filter(Boolean).join(' · '),
      pick: () => {
        write(me);
        setNotNow(false);
        focusNext.current = EDIT_ID;
      },
    },
    {
      value: 'other',
      title: localize('com_ui_support_contact_other'),
      hint: localize('com_ui_support_contact_other_hint'),
      pick: () => {
        setNotNow(false);
        startEditing(EMPTY);
      },
    },
    {
      value: 'none',
      title: localize('com_ui_support_contact_none'),
      hint: localize('com_ui_support_contact_none_hint'),
      pick: () => setNotNow(true),
    },
  ];

  /** Buttons, not radios: arrowing through radios would act on every choice it lands on. */
  return (
    <div className="flex flex-col gap-1.5">
      <p id={QUESTION_ID} className="mb-1 text-sm font-medium text-text-primary">
        {localize('com_ui_support_contact_question')}
      </p>
      <div role="group" aria-labelledby={QUESTION_ID} className="flex flex-col gap-1.5">
        {options.map((option) => {
          const id = choiceId(option.value);
          const pressed = option.value === 'none' && notNow;
          return (
            <button
              key={option.value}
              id={id}
              type="button"
              aria-pressed={pressed}
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-hint`}
              onClick={option.pick}
              className={cn(
                'flex w-full items-start rounded-xl border p-2.5 text-left hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary',
                pressed ? 'border-border-heavy bg-surface-secondary' : 'border-border-light',
              )}
            >
              <span className="min-w-0">
                <span id={`${id}-title`} className="block text-sm text-text-primary">
                  {option.title}
                </span>
                <span id={`${id}-hint`} className="block break-words text-xs text-text-secondary">
                  {option.hint}
                </span>
              </span>
              {pressed && <Check className="ml-auto size-4 flex-none" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
