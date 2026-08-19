const d = require('./public/data/loja.json');
d.forEach(p => {
  console.log('=== ', p.id, p.name);
  console.log(p.description);
  console.log('specs:', JSON.stringify(p.specs));
  console.log();
});
