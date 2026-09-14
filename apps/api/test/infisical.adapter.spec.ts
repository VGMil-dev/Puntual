import { InfisicalAdapter } from '../src/integrations/secrets/infisical/infisical.adapter';

describe('InfisicalAdapter (E11.5b)', () => {
  const originalEnv = process.env;
  let globalFetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...originalEnv };
    globalFetchMock = jest.fn();
    global.fetch = globalFetchMock;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('Local dev fallback: resolves secret from process.env without calling network', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

    const adapter = new InfisicalAdapter({
      nodeEnv: 'development',
    });

    await adapter.onModuleInit();
    const secret = await adapter.getSecret('DATABASE_URL');

    expect(secret).toBe('postgresql://user:pass@localhost:5432/db');
    expect(globalFetchMock).not.toHaveBeenCalled();
  });

  it('Staging mode: authenticates via Universal Auth and fetches secrets', async () => {
    // 1. Mock Universal Auth response
    globalFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'mock_jwt_token',
        expiresIn: 3600,
        tokenType: 'Bearer',
      }),
    });

    // 2. Mock GET /api/v4/secrets response
    globalFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        secrets: [
          { secretKey: 'DATABASE_URL', secretValue: 'postgresql://staging_user:staging_pass@db/staging' },
          { secretKey: 'REDIS_URL', secretValue: 'redis://staging_redis:6379' },
        ],
      }),
    });

    const adapter = new InfisicalAdapter({
      siteUrl: 'https://app.infisical.com',
      clientId: 'mock-client-id',
      clientSecret: 'mock-client-secret',
      projectId: 'mock-project-id',
      environment: 'staging',
      nodeEnv: 'staging',
    });

    await adapter.onModuleInit();

    const dbUrl = await adapter.getSecret('DATABASE_URL');
    const redisUrl = await adapter.getSecret('REDIS_URL');

    expect(dbUrl).toBe('postgresql://staging_user:staging_pass@db/staging');
    expect(redisUrl).toBe('redis://staging_redis:6379');

    // Verify Universal Auth call
    expect(globalFetchMock).toHaveBeenNthCalledWith(
      1,
      'https://app.infisical.com/api/v1/auth/universal-auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          clientId: 'mock-client-id',
          clientSecret: 'mock-client-secret',
        }),
      }),
    );

    // Verify Secrets call
    expect(globalFetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/v4/secrets?projectId=mock-project-id&environment=staging'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer mock_jwt_token',
        },
      }),
    );
  });

  it('Staging mode failure: throws explicit error if Infisical is unreachable (no silent startup)', async () => {
    globalFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized: Invalid client credentials',
    });

    const adapter = new InfisicalAdapter({
      siteUrl: 'https://app.infisical.com',
      clientId: 'bad-client-id',
      clientSecret: 'bad-client-secret',
      projectId: 'mock-project-id',
      environment: 'staging',
      nodeEnv: 'staging',
    });

    await expect(adapter.onModuleInit()).rejects.toThrow(
      /\[InfisicalAdapter\] Failed to initialize secrets from Infisical/,
    );
  });

  it('Security: structured log never exposes secret values', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SUPER_SENSITIVE_KEY = 'super_secret_unleakable_value_xyz';

    const adapter = new InfisicalAdapter({ nodeEnv: 'development' });
    const loggerSpy = jest.spyOn((adapter as any).logger, 'debug');

    await adapter.onModuleInit();
    await adapter.getSecret('SUPER_SENSITIVE_KEY');

    expect(loggerSpy).toHaveBeenCalled();
    for (const call of loggerSpy.mock.calls) {
      const logString = call[0];
      expect(logString).toContain('SUPER_SENSITIVE_KEY');
      expect(logString).not.toContain('super_secret_unleakable_value_xyz');
    }
  });
});
