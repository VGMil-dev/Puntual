import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { HealthModule } from '../src/modules/health/health.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';

describe('HealthController (e2e)', () => {
  let app: INestApplication;
  let prismaServiceMock: { isHealthy: jest.Mock };
  let redisServiceMock: { isHealthy: jest.Mock };

  beforeEach(async () => {
    prismaServiceMock = {
      isHealthy: jest.fn().mockResolvedValue(true),
    };
    redisServiceMock = {
      isHealthy: jest.fn().mockResolvedValue(true),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaServiceMock)
      .overrideProvider(RedisService)
      .useValue(redisServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health - returns 200 OK when both PostgreSQL and Redis are healthy', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      details: {
        postgres: 'up',
        redis: 'up',
      },
    });
    expect(response.body.timestamp).toBeDefined();
  });

  it('GET /health - returns 503 Service Unavailable when PostgreSQL is down', async () => {
    prismaServiceMock.isHealthy.mockResolvedValue(false);

    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(503);

    expect(response.body).toMatchObject({
      status: 'error',
      details: {
        postgres: 'down',
        redis: 'up',
      },
    });
  });

  it('GET /health - returns 503 Service Unavailable when Redis is down', async () => {
    redisServiceMock.isHealthy.mockResolvedValue(false);

    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(503);

    expect(response.body).toMatchObject({
      status: 'error',
      details: {
        postgres: 'up',
        redis: 'down',
      },
    });
  });

  it('GET /health - returns 503 Service Unavailable when both are down', async () => {
    prismaServiceMock.isHealthy.mockResolvedValue(false);
    redisServiceMock.isHealthy.mockResolvedValue(false);

    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(503);

    expect(response.body).toMatchObject({
      status: 'error',
      details: {
        postgres: 'down',
        redis: 'down',
      },
    });
  });
});
