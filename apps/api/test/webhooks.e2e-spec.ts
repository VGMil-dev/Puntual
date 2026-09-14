import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import * as crypto from 'crypto';
import { WebhooksModule } from '../src/modules/webhooks/webhooks.module';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

describe('Webhooks Gateway - Signature & Idempotency (E11.1 / RF-027 / RNF-011)', () => {
  let app: INestApplication;

  const TEST_META_APP_SECRET = 'test_meta_app_secret_123456';
  const TEST_TELEGRAM_SECRET_TOKEN = 'test_telegram_secret_token_abcdef';

  // In-memory Redis mock for reliable test isolation
  const redisStorage = new Map<string, string>();
  const redisMock = {
    getClient: () => ({
      set: jest.fn(async (key: string, value: string, mode?: string, ttl?: number, flag?: string) => {
        if (flag === 'NX' && redisStorage.has(key)) {
          return null; // Key already exists -> NX fails
        }
        redisStorage.set(key, value);
        return 'OK';
      }),
      get: jest.fn(async (key: string) => redisStorage.get(key) || null),
    }),
    isHealthy: jest.fn().mockResolvedValue(true),
  };

  const prismaMock = {
    clinic: {
      findUnique: jest.fn().mockResolvedValue({ id: 'clinic-123', name: 'Clínica Test' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'clinic-123', name: 'Clínica Test' }),
    },
    isHealthy: jest.fn().mockResolvedValue(true),
  };

  beforeAll(async () => {
    process.env.META_APP_SECRET = TEST_META_APP_SECRET;
    process.env.TELEGRAM_SECRET_TOKEN = TEST_TELEGRAM_SECRET_TOKEN;
    process.env.META_VERIFY_TOKEN = 'test_verify_token';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [WebhooksModule],
    })
      .overrideProvider(RedisService)
      .useValue(redisMock)
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleFixture.createNestApplication({
      rawBody: true,
    });
    await app.init();
  });

  beforeEach(() => {
    redisStorage.clear();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Meta Cloud API Webhooks', () => {
    it('GET /webhooks/meta - responds with challenge when verify_token matches', async () => {
      const challenge = 'challenge_random_string_123';
      const res = await request(app.getHttpServer())
        .get('/webhooks/meta')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test_verify_token',
          'hub.challenge': challenge,
        })
        .expect(200);

      expect(res.text).toBe(challenge);
    });

    it('GET /webhooks/meta - rejects with 403 when verify_token does not match', async () => {
      await request(app.getHttpServer())
        .get('/webhooks/meta')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong_token',
          'hub.challenge': '123',
        })
        .expect(403);
    });

    it('POST /webhooks/meta - rejects request with 401 when signature header is missing (RF-027)', async () => {
      const payload = { object: 'whatsapp_business_account' };

      const res = await request(app.getHttpServer())
        .post('/webhooks/meta')
        .send(payload)
        .expect(401);

      expect(res.body.error).toBe('Invalid signature');
      expect(res.body.traceId).toBeDefined();
    });

    it('POST /webhooks/meta - rejects request with 401 when signature is tampered/invalid', async () => {
      const payload = { object: 'whatsapp_business_account' };

      await request(app.getHttpServer())
        .post('/webhooks/meta')
        .set('x-hub-signature-256', 'sha256=invalid_hash_signature_0000000000000000000000000000000000000000000000000000000000000000')
        .send(payload)
        .expect(401);
    });

    it('POST /webhooks/meta - accepts valid signature, normalizes event and resolves clinic (RF-027)', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '123456789',
                    phone_number_id: 'PHONE_NUMBER_ID_123',
                  },
                  messages: [
                    {
                      from: '593991234567',
                      id: 'wamid.HBgLM...',
                      timestamp: '1726230000',
                      text: { body: 'Hola, quiero una cita' },
                      type: 'text',
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = crypto.createHmac('sha256', TEST_META_APP_SECRET).update(rawBody).digest('hex');

      const res = await request(app.getHttpServer())
        .post('/webhooks/meta')
        .set('x-hub-signature-256', `sha256=${signature}`)
        .set('x-trace-id', 'trace-meta-123')
        .send(payload)
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'accepted',
        eventId: 'wamid.HBgLM...',
        traceId: 'trace-meta-123',
        clinicId: 'clinic-123',
      });
    });

    it('POST /webhooks/meta - deduplicates replayed messages with 200 duplicate_ignored (RNF-011)', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: 'PHONE_NUMBER_ID_123' },
                  messages: [
                    {
                      from: '593991234567',
                      id: 'wamid.DUPLICATE_TEST_001',
                      timestamp: '1726230000',
                      text: { body: 'Mensaje duplicado' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = crypto.createHmac('sha256', TEST_META_APP_SECRET).update(rawBody).digest('hex');

      // First delivery: Accepted
      const res1 = await request(app.getHttpServer())
        .post('/webhooks/meta')
        .set('x-hub-signature-256', `sha256=${signature}`)
        .send(payload)
        .expect(200);
      expect(res1.body.status).toBe('accepted');

      // Second delivery (retry/replay): Deduplicated!
      const res2 = await request(app.getHttpServer())
        .post('/webhooks/meta')
        .set('x-hub-signature-256', `sha256=${signature}`)
        .send(payload)
        .expect(200);
      expect(res2.body.status).toBe('duplicate_ignored');
      expect(res2.body.eventId).toBe('wamid.DUPLICATE_TEST_001');
    });
  });

  describe('Telegram Webhooks', () => {
    it('POST /webhooks/telegram - rejects request with 403 when secret token is invalid or missing (RF-027)', async () => {
      const payload = { update_id: 1000, message: { message_id: 42, text: 'Hola' } };

      await request(app.getHttpServer())
        .post('/webhooks/telegram')
        .send(payload)
        .expect(403);

      await request(app.getHttpServer())
        .post('/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', 'wrong_secret_token')
        .send(payload)
        .expect(403);
    });

    it('POST /webhooks/telegram - accepts valid secret token, normalizes and dedupes (RF-027, RNF-011)', async () => {
      const payload = {
        update_id: 10001,
        message: {
          message_id: 998877,
          from: { id: 12345, first_name: 'Carlos' },
          chat: { id: 12345 },
          date: 1726231000,
          text: 'Quiero agendar para mañana',
        },
      };

      // First call -> Accepted
      const res1 = await request(app.getHttpServer())
        .post('/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', TEST_TELEGRAM_SECRET_TOKEN)
        .set('x-telegram-bot-token-hash', 'telegram_hash_123')
        .send(payload)
        .expect(200);

      expect(res1.body).toMatchObject({
        status: 'accepted',
        eventId: '998877',
        clinicId: 'clinic-123',
      });

      // Second call (burst/duplicate) -> Deduplicated
      const res2 = await request(app.getHttpServer())
        .post('/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', TEST_TELEGRAM_SECRET_TOKEN)
        .send(payload)
        .expect(200);

      expect(res2.body).toMatchObject({
        status: 'duplicate_ignored',
        eventId: '998877',
      });
    });
  });
});
