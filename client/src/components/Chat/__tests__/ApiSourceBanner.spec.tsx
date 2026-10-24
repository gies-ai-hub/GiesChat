import React from 'react';
import { render, screen } from '@testing-library/react';
import ApiSourceBanner from '../ApiSourceBanner';

const mockUseGetConvoIdQuery = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetConvoIdQuery: (...args: unknown[]) => mockUseGetConvoIdQuery(...args),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: { name?: string }) => `${key}:${values?.name ?? ''}`,
}));

it('names the site an API chat started on', () => {
  mockUseGetConvoIdQuery.mockReturnValue({ data: { apiKeyName: 'BADM 350 site' } });
  render(<ApiSourceBanner conversationId="c1" />);
  expect(screen.getByRole('note')).toHaveTextContent('com_ui_api_started_on:BADM 350 site');
});

it('stays out of ordinary chats', () => {
  mockUseGetConvoIdQuery.mockReturnValue({ data: { title: 'x' } });
  const { container } = render(<ApiSourceBanner conversationId="c1" />);
  expect(container).toBeEmptyDOMElement();
});

it('does not look up a new chat', () => {
  mockUseGetConvoIdQuery.mockReturnValue({ data: undefined });
  render(<ApiSourceBanner conversationId="new" />);
  expect(mockUseGetConvoIdQuery).toHaveBeenLastCalledWith('new', { enabled: false });
});
