const express = require('express');
const path = require('path');

const router = express.Router();

const appUrl = (process.env.APP_URL || 'https://damas-secreta.com').replace(/\/+$/, '');

const sitemapEntries = [
  '/',
  '/index.html',
  '/product.html',
  '/cadastro.html',
  '/login.html',
  '/faq.html',
  '/atendimento.html',
  '/termos.html',
  '/trocas.html',
  '/checkout.html',
  '/cart.html',
].map((route) => ({
  loc: `${appUrl}${route}`,
  changefreq: 'weekly',
  priority: route === '/' || route === '/index.html' ? '1.0' : '0.8',
}));

router.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send([
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${appUrl}/sitemap.xml`,
    '',
  ].join('\n'));
});

router.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapEntries.map((entry) => `\n  <url>\n    <loc>${entry.loc}</loc>\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`).join('')}\n</urlset>\n`);
});

module.exports = router;
