export const SECRET_STORE_PORT = Symbol('SECRET_STORE_PORT');

export interface SecretStorePort {
  /**
   * Retrieves a secret by key.
   * @param key Name of the secret (e.g., 'DATABASE_URL', 'REDIS_URL')
   */
  getSecret(key: string): Promise<string | undefined>;

  /**
   * Retrieves all secrets under a given path.
   * @param path Secret path (defaults to '/')
   */
  getSecrets(path?: string): Promise<Record<string, string>>;
}
