const path = require('path');
const express = require('express');
const helmet = require('helmet');

const app = express();
app.set('trust proxy', 1); // Vercel sits behind a proxy (needed for rate limiting by IP)
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"] } },
}));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/people', require('./routes/people'));
app.use('/api/v1/scorecards', require('./routes/scorecards'));
app.use('/api/v1/goals', require('./routes/goals'));
app.use('/api/v3/external', require('./routes/external'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => { // eslint-disable-line
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong. Try again.' : err.message });
});

module.exports = app;
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Strata PMS on http://localhost:${port}`));
}
