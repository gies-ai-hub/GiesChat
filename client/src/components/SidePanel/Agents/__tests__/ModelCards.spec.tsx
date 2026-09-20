import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TModelSpec } from 'librechat-data-provider';
import ModelCards, { getModelGuide, orderModels } from '../ModelCards';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const specs = [
  {
    name: 'gieschat-general-56',
    label: 'GPT-5.6 Luna',
    description: 'Fast all-rounder — quick answers.',
    preset: { endpoint: 'Azure OpenAI', model: 'gpt-5.6-luna' },
  },
  {
    name: 'gieschat-claude-sonnet-5',
    label: 'Claude Sonnet 5',
    description: 'Quick and sharp.',
    preset: { endpoint: 'anthropic', model: 'claude-sonnet-5' },
  },
] as TModelSpec[];

const models = ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.4'];
const defaultModel = { provider: 'Azure OpenAI', model: 'gpt-5.6-terra' };

describe('getModelGuide', () => {
  it('matches a spec on provider and model', () => {
    expect(getModelGuide(specs, 'Azure OpenAI', 'gpt-5.6-luna')).toEqual({
      label: 'GPT-5.6 Luna',
      description: 'Fast all-rounder — quick answers.',
    });
  });

  it('does not borrow a spec from another provider', () => {
    expect(getModelGuide(specs, 'Azure OpenAI', 'claude-sonnet-5')).toEqual({
      label: 'claude-sonnet-5',
      description: undefined,
    });
  });
});

describe('orderModels', () => {
  it('moves the default model to the front and leaves the rest in place', () => {
    expect(orderModels(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(orderModels(['a', 'b'], 'zzz')).toEqual(['a', 'b']);
    expect(orderModels(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('ModelCards', () => {
  it('renders one card per model with the spec description, fallback line, or name only', () => {
    render(
      <ModelCards
        provider="Azure OpenAI"
        models={models}
        specs={specs}
        value="gpt-5.6-terra"
        onChange={jest.fn()}
        defaultModel={defaultModel}
      />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute('value', 'gpt-5.6-terra');
    expect(screen.getByText('GPT-5.6 Terra')).toBeInTheDocument();
    expect(screen.getByText('Fast all-rounder — quick answers.')).toBeInTheDocument();
    expect(screen.getByText('com_ui_model_guide_gpt_5_6_terra')).toBeInTheDocument();
    expect(screen.getByText('com_ui_model_default_badge')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /GPT-5\.6 Terra/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^gpt-5\.4$/ })).not.toBeChecked();
  });

  it('reports the picked model', () => {
    const onChange = jest.fn();
    render(
      <ModelCards
        provider="Azure OpenAI"
        models={models}
        specs={specs}
        value="gpt-5.6-terra"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /GPT-5\.6 Luna/ }));
    expect(onChange).toHaveBeenCalledWith('gpt-5.6-luna');
    expect(screen.queryByText('com_ui_model_default_badge')).not.toBeInTheDocument();
  });
});
