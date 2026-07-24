import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const prod = process.env.NODE_ENV === 'production';

  // Fail-fast: em produção, a API NÃO sobe sem chave configurada (evita ficar
  // aberta por engano) nem sem CORS_ORIGIN explícito (nunca origin:true em prod).
  if (prod) {
    if (!process.env.ORZUNI_API_KEYS?.trim()) {
      throw new Error('ORZUNI_API_KEYS ausente — recuso subir com a API aberta em produção');
    }
    if (!process.env.CORS_ORIGIN?.trim()) {
      throw new Error('CORS_ORIGIN ausente — defina a origem do front (ex.: https://app.orzuni.com)');
    }
  }

  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  // atrás do Traefik/EasyPanel (1 hop) → req.ip = IP real do cliente (X-Forwarded-For),
  // para o rate limit contar por cliente, não pela cota global do proxy.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('v1');

  const origins = (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : true, methods: ['GET', 'PATCH', 'POST'] });

  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port);
  new Logger('Orzuni').log(`API no ar em http://localhost:${port}/v1 (cors: ${origins.join(',') || 'aberto/dev'})`);
}
bootstrap();
