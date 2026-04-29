require('dotenv').config();
const { validateEnv } = require('./utils/validateEnv');
validateEnv();
const express      = require('express');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');
const db           = require('./db');

const authRoutes   = require('./routes/auth');
const userRoutes   = require('./routes/user');
const adminRoutes  = require('./routes/admin');
const importRoutes = require('./routes/import');
const driveRoutes  = require('./routes/drive');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({
  // crossOriginResourcePolicy à false car le frontend streame des fichiers Drive
  // depuis une origine différente (Vercel ↔ Render)
  crossOriginResourcePolicy: false,
}));

app.set('trust proxy', 1);

// ── CORS ─────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(cookieParser());
// Pas de express.urlencoded — l'API n'accepte que du JSON (sauf multipart géré par multer).
// Supprimer urlencoded élimine un vecteur CSRF : les formulaires HTML classiques
// ne peuvent pas déclencher de requêtes JSON cross-site sans passer par CORS.
app.use(express.json({ limit: '1mb' }));

// ── Protection CSRF légère ────────────────────────────────────
// Pour les requêtes d'écriture (POST/PUT/DELETE), on exige le header
// X-Requested-With: XMLHttpRequest, posé par axios mais pas par un formulaire HTML.
// Couplé à CORS restrictif et à l'absence de urlencoded, ça couvre les cas courants.
const ALLOWED_ORIGINS = new Set([
  process.env.FRONTEND_URL,
  'http://localhost:3000',
].filter(Boolean));

const csrfMiddleware = (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

  // 1. Vérification Origin (quand présent — envoyé par les navigateurs modernes)
  const origin = req.headers['origin'];
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Origine non autorisée' });
  }

  // 2. Sec-Fetch-Site (navigateurs récents) — bloque les requêtes explicitement cross-site
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site' && (!origin || !ALLOWED_ORIGINS.has(origin))) {
    return res.status(403).json({ error: 'Requête cross-site refusée' });
  }
  // 3. Header custom posé par axios — impossible depuis un formulaire HTML cross-site
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    return res.status(403).json({ error: 'Requête non autorisée' });
  }

  next();
};
app.use('/api/auth',   csrfMiddleware);
app.use('/api/user',   csrfMiddleware);
app.use('/api/admin',  csrfMiddleware);

// ── Rate limiting global ──────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, veuillez réessayer plus tard.' },
  skip: (req) => req.path.startsWith('/api/user/drive/thumbnail'),
});

app.use(globalLimiter);

// ── Health checks ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' });
});

app.get('/health/db', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch {
    res.status(500).json({ status: 'error', db: 'down' });
  }
});

// ── Routes API ───────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/user',         userRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/admin/import', importRoutes);
app.use('/api/user/drive',   driveRoutes);

// ── 404 ──────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route non trouvée' }));

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erreur non gérée:', err);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

app.listen(PORT, () => {
  console.log(`🚀 Nova Copro API démarrée sur le port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Frontend: ${process.env.FRONTEND_URL}`);
});

module.exports = app;
