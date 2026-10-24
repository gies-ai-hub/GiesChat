import type { Response } from 'express';
import { createResponsesEventHandlers, createResponseContext } from '../service';
import { createResponseTracker, buildResponse } from '../handlers';
import { outputText } from '../../apiTurns';

/**
 * A streamed reply's text reaches the output part only when its stream is closed. Agent-key
 * turns are saved between closing and completing, so the site's next call finds the turn.
 */
describe('closeOpenStreams', () => {
  it('fills the reply text without completing the response', () => {
    const writes: string[] = [];
    const res = { write: (chunk: string) => writes.push(chunk) } as unknown as Response;
    const tracker = createResponseTracker();
    const context = createResponseContext({ model: 'agent_a', input: 'hi' }, 'resp_1');
    const { handlers, closeOpenStreams, finalizeStream } = createResponsesEventHandlers({
      res,
      context,
      tracker,
    });

    for (const text of ['Hello ', 'world']) {
      handlers.on_message_delta.handle('on_message_delta', {
        delta: { content: [{ type: 'text', text }] },
      });
    }
    closeOpenStreams();

    expect(outputText(buildResponse(context, tracker, 'completed'))).toBe('Hello world');
    expect(writes.join('')).not.toContain('response.completed');

    finalizeStream();
    const doneEvents = writes.join('').match(/event: response\.output_text\.done/g) ?? [];
    expect(doneEvents).toHaveLength(1);
    expect(writes.join('')).toContain('response.completed');
  });
});
