import { atom } from 'recoil';
import type { EmbedSessionAgent } from 'librechat-data-provider';

/** Set by the /embed route. Non-null means the shell renders chrome-less around this one agent. */
const embed = atom<EmbedSessionAgent | null>({ key: 'embed', default: null });

export default { embed };
