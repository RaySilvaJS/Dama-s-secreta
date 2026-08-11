process.env.APP_URL = 'https://exemplo.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const seoRouter = require('../seo');

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use('/', seoRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('serve robots.txt com instruções básicas', async () => {
  const response = await fetch(`${baseUrl}/robots.txt`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /User-agent: \*/);
  assert.match(body, /Sitemap:/);
});

test('serve sitemap.xml com as páginas principais', async () => {
  const response = await fetch(`${baseUrl}/sitemap.xml`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /<urlset/);
  assert.match(body, /https:\/\/exemplo\.com\//);
  assert.match(body, /https:\/\/exemplo\.com\/product\.html/);
});
