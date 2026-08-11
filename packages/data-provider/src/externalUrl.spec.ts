import { getAllowedExternalUrl } from './externalUrl';

describe('getAllowedExternalUrl', () => {
  it('accepts allowed hosts and normalizes the href', () => {
    expect(getAllowedExternalUrl('https://my-app.replit.app')).toBe('https://my-app.replit.app/');
    expect(getAllowedExternalUrl('  https://x-1.kirk.replit.dev/path?a=1  ')).toBe(
      'https://x-1.kirk.replit.dev/path?a=1',
    );
    expect(getAllowedExternalUrl('https://foo.repl.co')).toBe('https://foo.repl.co/');
  });

  it('rejects non-https, foreign, and look-alike hosts', () => {
    expect(getAllowedExternalUrl('http://my-app.replit.app')).toBeNull();
    expect(getAllowedExternalUrl('https://evil.com')).toBeNull();
    expect(getAllowedExternalUrl('https://evilreplit.app')).toBeNull();
    expect(getAllowedExternalUrl('https://replit.app.evil.com')).toBeNull();
    expect(getAllowedExternalUrl('javascript:alert(1)')).toBeNull();
    expect(getAllowedExternalUrl('')).toBeNull();
    expect(getAllowedExternalUrl(null)).toBeNull();
  });
});

describe('pptx-mcp preview host', () => {
  it('allows the deployed preview host', () => {
    expect(getAllowedExternalUrl('https://pptx-mcp.azurewebsites.net/preview/abc123')).toBe(
      'https://pptx-mcp.azurewebsites.net/preview/abc123',
    );
  });

  it('rejects a lookalike host', () => {
    expect(
      getAllowedExternalUrl('https://pptx-mcp.azurewebsites.net.evil.com/preview/abc123'),
    ).toBeNull();
  });

  it('rejects the preview host over plain http', () => {
    expect(getAllowedExternalUrl('http://pptx-mcp.azurewebsites.net/preview/abc123')).toBeNull();
  });

  it('allows a local dev server over http', () => {
    expect(getAllowedExternalUrl('http://localhost:8001/preview/abc123')).toBe(
      'http://localhost:8001/preview/abc123',
    );
    expect(getAllowedExternalUrl('http://127.0.0.1:8001/preview/abc123')).toBe(
      'http://127.0.0.1:8001/preview/abc123',
    );
  });

  it('still rejects any other http host', () => {
    expect(getAllowedExternalUrl('http://evil.com/preview/abc123')).toBeNull();
  });
});
