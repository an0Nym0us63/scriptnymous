// Journal du serveur lui-même (pino via Fastify) : options partagées.
import { config } from '../config.js';

export const loggerOptions = config.isDev
  ? {
      level: config.logLevel,
      transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    }
  : { level: config.logLevel };
