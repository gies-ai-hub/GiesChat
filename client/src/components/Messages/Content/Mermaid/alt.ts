const ACC_TITLE = /^\s*accTitle\s*:\s*(.+)$/m;
const ACC_DESCR_LINE = /^\s*accDescr\s*:\s*(.+)$/m;
const ACC_DESCR_BLOCK = /^\s*accDescr\s*\{([\s\S]*?)\}/m;

/** Alt text for a rendered Mermaid diagram: its own accTitle/accDescr when the source has them, else the fallback. */
export function diagramAlt(source: string, fallback: string): string {
  const title = source.match(ACC_TITLE)?.[1]?.trim();
  const description = (source.match(ACC_DESCR_BLOCK)?.[1] ?? source.match(ACC_DESCR_LINE)?.[1])
    ?.replace(/\s+/g, ' ')
    .trim();
  const own = [title, description].filter(Boolean).join('. ');
  return own || fallback;
}
