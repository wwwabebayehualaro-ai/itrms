// lib/logger.ts
import pino from 'pino';

// Determine if running in browser
const isBrowser = typeof window !== 'undefined';

const pinoConfig = {
    level: process.env.NEXT_PUBLIC_LOG_LEVEL || 'info',

    // Browser-safe configuration
    ...(isBrowser
        ? {
              browser: {
                  asObject: true,
                  write: (o: any) => {
                      console[o.level === 'error' ? 'error' : 'log'](o.msg);
                  }
              }
          }
        : {
              // Node.js configuration
              transport:
                  process.env.NODE_ENV === 'development'
                      ? {
                            target: 'pino-pretty',
                            options: {
                                colorize: true,
                                translateTime: 'HH:MM:ss Z',
                                ignore: 'pid,hostname',
                                singleLine: true
                            }
                        }
                      : undefined,

              redact: {
                  paths: ['password', '*.token', '*.secret'],
                  censor: '**REDACTED**'
              },

              timestamp: () => `,"time":"${new Date().toISOString()}"`
          }),

    mixin: () => ({
        env: process.env.NODE_ENV || 'development',
        app: 'nextjs-app'
    })
};

// Create logger instance
const logger = pino(pinoConfig);

export default logger;
