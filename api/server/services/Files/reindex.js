const fs = require('fs');
const os = require('os');
const path = require('path');
const { logger } = require('@librechat/data-schemas');
const { uploadVectors } = require('./VectorDB/crud');

/**
 * Re-indexes agent documents under another entity id, from the extracted text
 * already stored on each File record. Used when a draft is posted: its searched
 * documents were embedded under the draft's id and `file_search` on production
 * queries production's id.
 *
 * @param {object} params
 * @param {import('express').Request} params.req - carries the caller for the RAG API token
 * @param {Array<{ file_id: string; filename: string; text?: string }>} params.files
 * @param {string} params.entityId - the production agent id
 * @returns {Promise<void>}
 */
async function reindexAgentDocuments({ req, files, entityId }) {
  for (const file of files) {
    if (!file.text) {
      logger.warn(`[reindexAgentDocuments] ${file.file_id} has no stored text; skipped`);
      continue;
    }
    const tmpPath = path.join(os.tmpdir(), `reindex-${file.file_id}.txt`);
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
        file_id: file.file_id,
        entity_id: entityId,
      });
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => undefined);
    }
  }
}

module.exports = { reindexAgentDocuments };
