const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const BANNERS_PATH = path.join(__dirname, 'data', 'banners.json');

const loadBanners = () => { try { return JSON.parse(fs.readFileSync(BANNERS_PATH, 'utf-8')); } catch { return []; } };
const saveBanners = (b) => fs.writeFileSync(BANNERS_PATH, JSON.stringify(b, null, 2), 'utf-8');

// Banners ativos, ordenados — é o que o carrossel do site consome.
function getActiveBanners() {
  return loadBanners()
    .filter(b => b.active)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function createBanner(data) {
  const banners = loadBanners();
  if (!data.image) throw new Error('Imagem é obrigatória.');
  const maxOrder = banners.reduce((max, b) => Math.max(max, b.order ?? 0), -1);

  const banner = {
    id:        uuidv4(),
    image:     data.image,
    link:      (data.link || '').trim(),
    order:     Number.isFinite(Number(data.order)) ? Number(data.order) : maxOrder + 1,
    active:    data.active !== false,
    createdAt: new Date().toISOString(),
  };
  banners.push(banner);
  saveBanners(banners);
  return banner;
}

function updateBanner(id, data) {
  const banners = loadBanners();
  const idx = banners.findIndex(b => b.id === id);
  if (idx === -1) throw new Error('Banner não encontrado.');

  const allowed = ['image', 'link', 'order', 'active'];
  allowed.forEach(k => { if (k in data) banners[idx][k] = data[k]; });
  if ('link' in data) banners[idx].link = (data.link || '').trim();

  banners[idx].updatedAt = new Date().toISOString();
  saveBanners(banners);
  return banners[idx];
}

function deleteBanner(id) {
  const banners = loadBanners();
  const idx = banners.findIndex(b => b.id === id);
  if (idx === -1) throw new Error('Banner não encontrado.');
  const [removed] = banners.splice(idx, 1);
  saveBanners(banners);
  return removed;
}

// Troca a ordem entre um banner e o vizinho (direction: -1 sobe, 1 desce)
function moveBanner(id, direction) {
  const banners = loadBanners().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = banners.findIndex(b => b.id === id);
  if (idx === -1) throw new Error('Banner não encontrado.');
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= banners.length) return banners;

  const tmp = banners[idx].order;
  banners[idx].order = banners[swapIdx].order;
  banners[swapIdx].order = tmp;
  saveBanners(banners);
  return banners;
}

module.exports = { loadBanners, saveBanners, getActiveBanners, createBanner, updateBanner, deleteBanner, moveBanner };
