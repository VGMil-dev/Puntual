import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { SecretStorePort } from '../secret-store.port';

export interface InfisicalConfig {
  siteUrl?: string;
  clientId?: string;
  clientSecret?: string;
  projectId?: string;
  environment?: string;
  nodeEnv?: string;
}

@Injectable()
export class InfisicalAdapter implements SecretStorePort, OnModuleInit {
  private readonly logger = new Logger(InfisicalAdapter.name);

  private readonly siteUrl: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly projectId?: string;
  private readonly environment: string;
  private readonly nodeEnv: string;

  private cachedSecrets: Map<string, string> = new Map();
  private accessToken?: string;
  private tokenExpiresAt?: number;

  constructor(@Optional() config?: InfisicalConfig) {
    this.siteUrl = config?.siteUrl || process.env.INFISICAL_SITE_URL || 'https://app.infisical.com';
    this.clientId = config?.clientId || process.env.INFISICAL_CLIENT_ID;
    this.clientSecret = config?.clientSecret || process.env.INFISICAL_CLIENT_SECRET;
    this.projectId = config?.projectId || process.env.INFISICAL_PROJECT_ID;
    this.environment = config?.environment || process.env.INFISICAL_ENVIRONMENT || process.env.NODE_ENV || 'development';
    this.nodeEnv = config?.nodeEnv || process.env.NODE_ENV || 'development';
  }

  async onModuleInit() {
    if (this.shouldUseLocalFallback()) {
      this.logger.log(
        JSON.stringify({
          action: 'init',
          mode: 'local_fallback',
          environment: this.environment,
          message: 'Using environment variables fallback (.env) for secrets in local development',
        }),
      );
      return;
    }

    try {
      this.logger.log(
        JSON.stringify({
          action: 'init',
          mode: 'infisical_cloud',
          siteUrl: this.siteUrl,
          projectId: this.projectId,
          environment: this.environment,
        }),
      );
      await this.refreshSecrets('/');
    } catch (error: any) {
      this.logger.error(
        JSON.stringify({
          action: 'init_error',
          environment: this.environment,
          error: error.message,
        }),
      );
      throw new Error(`[InfisicalAdapter] Failed to initialize secrets from Infisical: ${error.message}`);
    }
  }

  private shouldUseLocalFallback(): boolean {
    // In local development or test, if Infisical credentials/project are not provided, fallback to process.env
    return (
      (this.nodeEnv === 'development' || this.nodeEnv === 'test') &&
      (!this.clientId || !this.clientSecret || !this.projectId)
    );
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Missing INFISICAL_CLIENT_ID or INFISICAL_CLIENT_SECRET for Universal Auth');
    }

    const authUrl = `${this.siteUrl}/api/v1/auth/universal-auth/login`;
    const response = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Universal Auth failed (status ${response.status}): ${errorText}`);
    }

    const data: any = await response.json();
    this.accessToken = data.accessToken;
    // Set expiry 60 seconds before actual token expiry
    this.tokenExpiresAt = Date.now() + (data.expiresIn - 60) * 1000;
    return this.accessToken;
  }

  async refreshSecrets(secretPath: string = '/'): Promise<void> {
    if (this.shouldUseLocalFallback()) return;

    if (!this.projectId) {
      throw new Error('Missing INFISICAL_PROJECT_ID');
    }

    const token = await this.authenticate();
    const queryParams = new URLSearchParams({
      projectId: this.projectId,
      environment: this.environment,
      secretPath,
      recursive: 'true',
    });

    const secretsUrl = `${this.siteUrl}/api/v4/secrets?${queryParams.toString()}`;
    const response = await fetch(secretsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch secrets (status ${response.status}): ${errorText}`);
    }

    const data: any = await response.json();
    if (Array.isArray(data.secrets)) {
      for (const secret of data.secrets) {
        if (secret.secretKey && secret.secretValue !== undefined) {
          this.cachedSecrets.set(secret.secretKey, secret.secretValue);
        }
      }
    }
  }

  async getSecret(key: string): Promise<string | undefined> {
    // Audit log: key and environment ONLY. Never value!
    this.logger.debug(
      JSON.stringify({
        action: 'getSecret',
        key,
        environment: this.environment,
      }),
    );

    if (this.shouldUseLocalFallback()) {
      return process.env[key];
    }

    if (!this.cachedSecrets.has(key)) {
      await this.refreshSecrets('/');
    }

    const secret = this.cachedSecrets.get(key);
    // Fallback to process.env if not found in Infisical
    return secret !== undefined ? secret : process.env[key];
  }

  async getSecrets(path: string = '/'): Promise<Record<string, string>> {
    this.logger.debug(
      JSON.stringify({
        action: 'getSecrets',
        path,
        environment: this.environment,
      }),
    );

    if (this.shouldUseLocalFallback()) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) result[k] = v;
      }
      return result;
    }

    await this.refreshSecrets(path);
    const result: Record<string, string> = {};
    for (const [k, v] of this.cachedSecrets.entries()) {
      result[k] = v;
    }
    return result;
  }
}
