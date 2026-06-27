import cors from 'cors';
import express from 'express';
import { config } from './config';
import { seedNews } from './lib/seedNews';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth';
import { callbackRouter } from './routes/callback';
import { newsRouter } from './routes/news';
import { notifyRouter } from './routes/notify';
import { remitRouter } from './routes/remit';
import { requestsRouter } from './routes/requests';
import { usersRouter } from './routes/users';

const app = express();

const corsOrigins = new Set([
  config.frontendUrl,
  config.frontendUrl.replace('localhost', '127.0.0.1'),
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,

}));
// Default limit is 100 KB  
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'openremit-backend' });
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/news', newsRouter);
app.use('/api/notify', notifyRouter);
app.use('/api/remit', remitRouter);
app.use('/api/callback', callbackRouter);

app.use(errorHandler);

// Seed the demo News posts on first boot (idempotent — no-op if any exist).
seedNews().catch((err) => console.error('[seed] News seed failed:', err));

app.listen(config.port, () => {
  console.log(`\n  OpenRemit backend → http://localhost:${config.port}\n`);
});
