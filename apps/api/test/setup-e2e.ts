process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test_encryption_key_32_characters_minimum!';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_key_32_characters_minimum!';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://puntual_dev:puntual_dev_pass@localhost:5434/puntual_dev?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6381';
process.env.META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'test_verify_token';
process.env.META_APP_SECRET = process.env.META_APP_SECRET || 'test_meta_app_secret_123456';
process.env.TELEGRAM_SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN || 'test_telegram_secret_token_abcdef';
