const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  crawlSite,
  replaceSiteCopy,
  startSiteRefresh,
  modelTestEndpointFromConfig,
} = require('@librechat/api');
const { uploadVectors, deleteVectors } = require('./Files/VectorDB/crud');
const { getAppConfig } = require('./Config');
const db = require('~/models');

/** The RAG API takes uploads, not strings, so the copy goes through a temp file (as in copy.js). */
async function indexText({ userId, fileId, filename, text, agentId }) {
  if (!process.env.RAG_API_URL) {
    return false;
  }
  const tmpPath = path.join(os.tmpdir(), `website-${fileId}.txt`);
  await fs.promises.writeFile(tmpPath, text, 'utf8');
  try {
    const result = await uploadVectors({
      req: { user: { id: userId } },
      file: {
        path: tmpPath,
        originalname: filename,
        mimetype: 'text/plain',
        size: Buffer.byteLength(text, 'utf8'),
      },
      file_id: fileId,
      entity_id: agentId,
    });
    return Boolean(result?.embedded);
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => undefined);
  }
}

/** @type {import('@librechat/api').SiteStoreDeps} */
const siteStore = {
  indexText,
  createFile: db.createFile,
  addAgentResourceFile: db.addAgentResourceFile,
  removeAgentResourceFiles: db.removeAgentResourceFiles,
  findAgentsUsingFile: (fileId) =>
    db.getAgents({ 'tool_resources.context.file_ids': fileId }, 'id'),
  deleteVectors: ({ userId, file }) => deleteVectors({ user: { id: userId } }, file),
  deleteFiles: db.deleteFiles,
  resolveEndpoint: async () => modelTestEndpointFromConfig(await getAppConfig()),
};

const replaceWebsiteCopy = (params) => replaceSiteCopy(siteStore, params);

function startWebsiteRefresh() {
  return startSiteRefresh({
    ...siteStore,
    getDueWebsiteCopies: db.getDueWebsiteCopies,
    markWebsiteChecked: db.markWebsiteChecked,
    crawl: (url) => crawlSite(url),
  });
}

module.exports = { siteStore, replaceWebsiteCopy, startWebsiteRefresh };
