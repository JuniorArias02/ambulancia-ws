import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validarVariablesEntorno } from './config/variables_entorno.js';
import { AuthenticationModule } from './modules/authentication/authentication.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validarVariablesEntorno,
    }),
    AuthenticationModule,
    NotificationsModule,
  ],
})
export class AppModule {}
