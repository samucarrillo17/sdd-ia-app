import { Module, DynamicModule, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from '../audit/audit.module.js';
import { AI_PROVIDER_TOKEN } from './providers/ai-provider.interface.js';
import { MockAiProvider } from './providers/mock-ai.provider.js';
import { HttpAiProvider } from './providers/http-ai.provider.js';
import { AiService } from './ai.service.js';
import { AiController } from './ai.controller.js';

@Module({})
export class AiModule {
  static forRoot(): DynamicModule {
    const provider: Provider = {
      provide: AI_PROVIDER_TOKEN,
      useFactory: (configService: ConfigService) => {
        const providerType = configService.get<string>('AI_PROVIDER') ?? 'mock';
        
        if (providerType === 'http') {
          return new HttpAiProvider(configService);
        }
        
        return new MockAiProvider(configService);
      },
      inject: [ConfigService],
    };

    return {
      module: AiModule,
      imports: [
        AuditModule,
        ThrottlerModule.forRoot([{ name: 'ai', limit: 10, ttl: 60000 }]),
      ],
      controllers: [AiController],
      providers: [provider, AiService],
      exports: [AI_PROVIDER_TOKEN, AiService],
    };
  }
}