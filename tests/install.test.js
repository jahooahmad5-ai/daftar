'use strict';
// تثبيت نقطة البيع كتطبيق: موبايل المندوب ما عنده قائمة، فزر التثبيت بيطلع بالرئيسية
const assert = require('assert');
const { page, REP } = require('./helpers');

module.exports = [
  {
    name: 'رئيسية نقطة البيع: شرح التثبيت، وزر «تثبيت هلق» لما المتصفح يسمح، وبيختفي بعد التثبيت',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await p.waitForSelector('#installCard');
      assert.match(await p.text('#installCard'), /نزّل نقطة البيع كتطبيق/);
      assert.match(await p.text('#installCard'), /تثبيت التطبيق|الشاشة الرئيسية/);
      // المتصفح بيسمح بالتثبيت ← بيطلع الزر، والكبسة بتفتح نافذة التثبيت
      await p.evaluate(() => {
        const e = new Event('beforeinstallprompt'); window.__prompted = 0;
        e.prompt = () => { window.__prompted++; }; e.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(e);
      });
      await p.click('#installNow');
      await p.waitForFunction(() => window.__prompted === 1 && !document.getElementById('installCard'));
      // كأنه انفتح كتطبيق: ما بيطلع الكرت
      await p.evaluate(() => { navigator.__defineGetter__('standalone', () => true); route(); });
      await p.waitForTimeout(300);
      assert.equal(await p.locator('#installCard').count(), 0);
      assert.deepEqual(p.errors, []);
    },
  },
];
