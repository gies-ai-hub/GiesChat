import { FileSources } from 'librechat-data-provider';
import { withResolvedFileStrategy } from '../cdn';

describe('withResolvedFileStrategy', () => {
  const saved = {
    connection: process.env.AZURE_STORAGE_CONNECTION_STRING,
    account: process.env.AZURE_STORAGE_ACCOUNT_NAME,
  };
  beforeEach(() => {
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
  });
  afterAll(() => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = saved.connection;
    process.env.AZURE_STORAGE_ACCOUNT_NAME = saved.account;
  });

  it('falls back to local disk when azure_blob has no credentials', () => {
    const config = { fileStrategy: FileSources.azure_blob, cache: true };
    expect(withResolvedFileStrategy(config)).toEqual({
      ...config,
      fileStrategy: FileSources.local,
    });
  });

  it('keeps azure_blob when a connection string is set', () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    const config = { fileStrategy: FileSources.azure_blob };
    expect(withResolvedFileStrategy(config)).toBe(config);
  });

  it('leaves other strategies alone', () => {
    const config = { fileStrategy: FileSources.s3 };
    expect(withResolvedFileStrategy(config)).toBe(config);
    expect(withResolvedFileStrategy({})).toEqual({});
  });
});
