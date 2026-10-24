import { isValidObjectIdString } from '@librechat/data-schemas';

/**
 * The dashboard's Source filter as extra conversation conditions (`undefined` = every
 * source, `null` = a value that names no source). Embed guests are matched by user id
 * because nothing on their conversations marks them.
 * ponytail: guest ids go in as one `$in` list; switch to a `$lookup` on users if one agent
 * ever collects tens of thousands of guests.
 */
export async function resolveSourceMatch(
  raw: unknown,
  agentIds: string[],
  findGuestIds: (agentIds: string[]) => Promise<string[]>,
): Promise<Record<string, unknown> | undefined | null> {
  if (raw === undefined || raw === 'all') {
    return undefined;
  }
  if (raw === 'api') {
    return { apiKeyId: { $exists: true } };
  }
  if (raw === 'embed') {
    return { user: { $in: await findGuestIds(agentIds) } };
  }
  if (raw === 'gieschat') {
    return { apiKeyId: { $exists: false }, user: { $nin: await findGuestIds(agentIds) } };
  }
  if (typeof raw === 'string' && isValidObjectIdString(raw)) {
    return { apiKeyId: raw };
  }
  return null;
}
