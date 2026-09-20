const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('@librechat/data-schemas');
const { uploadVectors } = require('./VectorDB/crud');
const { createFile } = require('~/models');

/**
 * Gives an agent its own copies of another agent's search-indexed documents.
 *
 * The RAG API indexes a document under one `(file_id, entity_id)` pair and ignores
 * a second embed of the same `file_id`, so an agent that merely shares a file id
 * with the agent the document was uploaded to searches it and finds nothing. Each
 * copy gets a new File record (same stored text, same blob path) and is embedded
 * from that text under the target agent's id.
 *
 * @param {object} params
 * @param {import('express').Request} params.req - carries the caller for the RAG API token
 * @param {Array<import('@librechat/data-schemas').IMongoFile>} params.files - source records, `text` included
 * @param {string} params.agentId - the agent the copies belong to
 * @returns {Promise<Map<string, string>>} source file_id → copied file_id
 */
async function copyAgentDocuments({ req, files, agentId }) {
  const mapping = new Map();
  for (const file of files) {
    if (!file.text) {
      logger.warn(`[copyAgentDocuments] ${file.file_id} has no stored text; kept shared`);
      continue;
    }
    const file_id = uuidv4();
    const tmpPath = path.join(os.tmpdir(), `copy-${file_id}.txt`);
    await fs.promises.writeFile(tmpPath, file.text, 'utf8');
    try {
      await uploadVectors({
        req,
        file: {
          path: tmpPath,
          originalname: file.filename,
          mimetype: 'text/plain',
          size: Buffer.byteLength(file.text, 'utf8'),
        },
        file_id,
        entity_id: agentId,
      });
      await createFile(
        {
          user: file.user,
          file_id,
          filename: file.filename,
          filepath: file.filepath,
          type: file.type,
          bytes: file.bytes,
          text: file.text,
          source: file.source,
          context: file.context,
          embedded: true,
          usage: 0,
        },
        true,
      );
      mapping.set(file.file_id, file_id);
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => undefined);
    }
  }
  return mapping;
}

module.exports = { copyAgentDocuments };
