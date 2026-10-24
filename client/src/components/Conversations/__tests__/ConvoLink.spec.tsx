import React from 'react';
import { render, screen } from '@testing-library/react';
import ConvoLink from '../ConvoLink';

const renderLink = (tag?: string) =>
  render(
    <ConvoLink
      isActiveConvo={false}
      isPopoverActive={false}
      title="What is WACC?"
      onRename={jest.fn()}
      isSmallScreen={false}
      localize={(key: string) => key}
      tag={tag}
    >
      <span />
    </ConvoLink>,
  );

it('shows the site a chat came from as text', () => {
  renderLink('via BADM 350 site');
  expect(screen.getByText('via BADM 350 site')).toBeInTheDocument();
});

it('shows no tag on an ordinary chat', () => {
  const { container } = renderLink();
  expect(container).not.toHaveTextContent('via');
});
