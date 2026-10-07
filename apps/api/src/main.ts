import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Global prefix
  app.setGlobalPrefix('api');

  // Cookie parser
  app.use(cookieParser());

  // CORS
  const webOrigin = configService.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
  app.enableCors({
    origin: webOrigin,
    credentials: true,
  });

  // Validation pipe (also configured globally via APP_PIPE, but keeping for explicit config)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger (optional)
  if (configService.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SDD IA API')
      .setDescription('API para gestión de solicitudes e inventario')
      .setVersion('1.0')
      .addCookieAuth('sid')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = configService.get<number>('PORT') ?? 4000;
  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
}

bootstrap();