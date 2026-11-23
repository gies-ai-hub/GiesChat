import { diagramAlt } from '../alt';

const FALLBACK = 'Diagram. Use Show Code for the text version.';

describe('diagramAlt', () => {
  it('uses accTitle and a one-line accDescr', () => {
    const source =
      'flowchart LR\n  accTitle: Enrollment flow\n  accDescr: Students apply, then advisors approve\n  A --> B';
    expect(diagramAlt(source, FALLBACK)).toBe(
      'Enrollment flow. Students apply, then advisors approve',
    );
  });

  it('collapses a block accDescr onto one line', () => {
    const source = 'flowchart LR\n  accDescr {\n    Apply\n    then approve\n  }\n  A --> B';
    expect(diagramAlt(source, FALLBACK)).toBe('Apply then approve');
  });

  it('falls back when the diagram describes nothing', () => {
    expect(diagramAlt('flowchart LR\n  A --> B', FALLBACK)).toBe(FALLBACK);
  });
});
