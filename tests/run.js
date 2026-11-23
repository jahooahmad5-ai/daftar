'use strict';
// تشغيل كل الفحوصات: node tests/run.js  (أو: node tests/run.js pos  لتشغيل ملف واحد)
const fs = require('fs');
const path = require('path');
const { serve, close } = require('./helpers');

(async () => {
  const only = process.argv[2];
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && (!only || f.includes(only))).sort();
  const { srv, url } = await serve();
  let pass = 0, fail = 0;
  const t0 = Date.now();
  for (const f of files) {
    const tests = require(path.join(__dirname, f));
    console.log(`\n📄 ${f}`);
    for (const t of tests) {
      const s = Date.now();
      try {
        await Promise.race([t.fn(url), new Promise((_, j) => setTimeout(() => j(new Error('timeout 60s')), 60000))]);
        pass++; console.log(`  ✓ ${t.name} (${Date.now() - s}ms)`);
      } catch (e) {
        fail++; console.log(`  ✗ ${t.name}\n      ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n      ')}`);
      }
    }
  }
  await close(); srv.close();
  console.log(`\n${fail ? '❌' : '✅'} ${pass} نجح، ${fail} فشل — ${Math.round((Date.now() - t0) / 1000)} ثانية`);
  process.exit(fail ? 1 : 0);
})();
