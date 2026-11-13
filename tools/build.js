#!/usr/bin/env node
// Builds the public pages of dhowpartners.com from the sources in src/.
//
//   src/site.dc.html   home, services, about, work with us, contact, privacy, terms
//   src/apply.dc.html  membership (/apply)
//
// Edit the sources, then run:   NODE_PATH=$(npm root -g) node tools/build.js
// (needs Node and Playwright; esbuild is optional and used to minify support.js).
//
// It writes:
//   index.html, services.html, about.html, work-with-us.html, contact.html, privacy.html,
//   terms.html, apply.html        one file per page
//   dc/site.txt, dc/apply.txt     the page templates and logic, shared by the pages and
//                                 loaded by support.js
//   assets/site.css, assets/apply.css   page styles
//   assets/prerender.css          styles for the pre-rendered copy (used only without JavaScript)
//   support.min.js                minified runtime (when esbuild is available)
//
// Each page gets:
//   - its own <head>: title, description, canonical, social tags and structured data, so search
//     engines, AI assistants and link previews read the right page without running JavaScript;
//   - a pre-rendered copy of the page content (#dc-prerender). It is hidden by the page styles and
//     removed when the live page is drawn, so what visitors see does not change. Without JavaScript
//     (or if the page cannot start) the copy is shown instead.
//
// Optional: LOCAL_NODE_MODULES=/path/to/node_modules serves React and Babel from local copies
// instead of unpkg.com (useful when the build machine has no internet access).

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://dhowpartners.com';
const PORT = 8133;
const SOURCES = {
  site: { src: 'src/site.dc.html', tpl: 'dc/site.txt', css: 'assets/site.css' },
  apply: { src: 'src/apply.dc.html', tpl: 'dc/apply.txt', css: 'assets/apply.css' },
};
const PAGES = [
  { route: '/', source: 'site', out: 'index.html', crumb: null },
  { route: '/services', source: 'site', out: 'services.html', crumb: 'Services' },
  { route: '/about', source: 'site', out: 'about.html', crumb: 'About' },
  { route: '/work-with-us', source: 'site', out: 'work-with-us.html', crumb: 'Work with us' },
  { route: '/contact', source: 'site', out: 'contact.html', crumb: 'Contact' },
  { route: '/privacy', source: 'site', out: 'privacy.html', crumb: 'Privacy policy' },
  { route: '/terms', source: 'site', out: 'terms.html', crumb: 'Terms and agreement' },
  { route: '/apply', source: 'apply', out: 'apply.html', crumb: 'Membership' },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.txt': 'text/plain', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.css': 'text/css',
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true }); fs.writeFileSync(path.join(ROOT, rel), text); };

// Split a source file into its head tags (<helmet>), its template and its logic script.
function parseSource(text, file) {
  const open = /<x-dc(?:\s[^>]*)?>/.exec(text);
  const close = text.lastIndexOf('</x-dc>');
  if (!open || close < 0) throw new Error(file + ': no <x-dc> block');
  let tpl = text.slice(open.index + open[0].length, close);
  const helmet = /<helmet>([\s\S]*?)<\/helmet>\s*/.exec(tpl);
  if (!helmet) throw new Error(file + ': no <helmet> block');
  tpl = tpl.slice(0, helmet.index) + tpl.slice(helmet.index + helmet[0].length);
  const dcScript = text.slice(close + '</x-dc>'.length).replace(/<\/body>[\s\S]*$/i, '').trim();
  if (!/^<script type="text\/x-dc" data-dc-script/.test(dcScript)) throw new Error(file + ': logic script not found after </x-dc>');

  let head = helmet[1];
  const css = [];
  head = head.replace(/<style>([\s\S]*?)<\/style>\s*/g, (m, body) => { css.push(body.trim()); return ''; });
  const ld = [];
  head = head.replace(/<script type="application\/ld\+json"(?: data-only="([^"]*)")?>([\s\S]*?)<\/script>\s*/g,
    (m, only, body) => { ld.push({ only: only || null, data: JSON.parse(body) }); return ''; });
  head = head
    .replace(/<title>[\s\S]*?<\/title>\s*/gi, '')
    .replace(/<meta\s+name="(?:description|robots|twitter:title|twitter:description)"[^>]*>\s*/gi, '')
    .replace(/<meta\s+property="og:(?:title|description|url)"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '')
    // Load the web fonts without blocking the first paint.
    .replace(/<link rel="stylesheet" href="(https:\/\/api\.fontshare\.com[^"]*)">/g,
      (m, href) => '<link rel="stylesheet" href="' + href + '" media="print" onload="this.media=\'all\'">' +
        '<noscript><link rel="stylesheet" href="' + href + '"></noscript>');
  if (/<style|<script/i.test(head)) throw new Error(file + ': unexpected <style> or <script> left in <helmet>');
  return { head: head.trim(), css: css.join('\n\n'), ld, tpl: tpl.trim(), dcScript };
}

// One JSON-LD block per page: the shared graph, page-only items, and a breadcrumb.
function structuredData(ld, page) {
  const graph = [];
  for (const item of ld) {
    if (item.only && item.only !== page.route) continue;
    const d = item.data;
    for (const node of (d['@graph'] || [d])) { const n = { ...node }; delete n['@context']; graph.push(n); }
  }
  if (page.crumb) {
    graph.push({
      '@type': 'BreadcrumbList', '@id': SITE + page.route + '#breadcrumb',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: page.crumb, item: SITE + page.route },
      ],
    });
  }
  if (!graph.length) return '';
  return '<script type="application/ld+json">' +
    JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c') + '</script>';
}

function pageHead(meta, page) {
  const url = SITE + (page.route === '/' ? '/' : page.route);
  return [
    '<title>' + esc(meta.title) + '</title>',
    '<meta name="description" content="' + esc(meta.desc) + '">',
    '<meta name="robots" content="' + esc(meta.robots || 'index, follow, max-image-preview:large') + '">',
    '<link rel="canonical" href="' + esc(url) + '">',
    '<meta property="og:title" content="' + esc(meta.ogTitle || meta.title) + '">',
    '<meta property="og:description" content="' + esc(meta.ogDesc || meta.desc) + '">',
    '<meta property="og:url" content="' + esc(url) + '">',
    '<meta name="twitter:title" content="' + esc(meta.twTitle || meta.ogTitle || meta.title) + '">',
    '<meta name="twitter:description" content="' + esc(meta.twDesc || meta.ogDesc || meta.desc) + '">',
  ].join('\n');
}

function serve() {
  const routeSrc = Object.fromEntries(PAGES.map((p) => [p.route, SOURCES[p.source].src]));
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]).replace(/\/+$/, '') || '/';
      const f = routeSrc[u] ? path.join(ROOT, routeSrc[u]) : path.join(ROOT, u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    }).listen(PORT, () => resolve(srv));
  });
}

async function renderPage(ctx, page) {
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:' + PORT + page.route, { waitUntil: 'load' });
  await p.waitForFunction(() => {
    const r = document.getElementById('dc-root');
    return r && r.querySelector('h1') && r.textContent.trim().length > 200;
  }, null, { timeout: 30000 });
  // Scroll through so every section has appeared and the counters have finished.
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 300) {
      window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await p.waitForTimeout(2200);
  const data = await p.evaluate(() => {
    const g = (sel, attr) => { const e = document.head.querySelector(sel); return e ? e.getAttribute(attr || 'content') : null; };
    const root = document.getElementById('dc-root').cloneNode(true);
    root.querySelectorAll('[data-reveal]').forEach((el) => {
      el.style.removeProperty('opacity'); el.style.removeProperty('transform'); el.style.removeProperty('transition');
    });
    root.querySelectorAll('script, iframe').forEach((n) => n.remove());
    root.querySelectorAll('img').forEach((img) => {
      img.setAttribute('loading', 'lazy'); img.removeAttribute('fetchpriority');
      const alt = (img.getAttribute('alt') || '').trim();
      if (alt && !img.getAttribute('title')) img.setAttribute('title', alt);
    });
    // Icon-only links: add their label as hidden text.
    root.querySelectorAll('a').forEach((a) => {
      const label = (a.getAttribute('aria-label') || '').trim();
      if (label && !a.textContent.trim()) {
        const s = document.createElement('span'); s.className = 'sr-only'; s.textContent = label; a.appendChild(s);
      }
    });
    // Move inline styles into classes (written to assets/prerender.css).
    const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };
    const styles = {};
    root.querySelectorAll('[style]').forEach((el) => {
      let st = el.getAttribute('style').trim();
      el.removeAttribute('style');
      if (!st) return;
      st = st.replace(/url\((['"]?)(?!data:|https?:|\/)([^'")]+)\1\)/g, 'url($1/$2$1)');
      const cls = 'p' + fnv(st);
      styles[cls] = st;
      el.classList.add(cls);
    });
    root.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((a) => { if (a.name.startsWith('data-dc-')) el.removeAttribute(a.name); });
    });
    return {
      html: root.innerHTML,
      styles,
      meta: {
        title: document.title, desc: g('meta[name="description"]'), robots: g('meta[name="robots"]'),
        ogTitle: g('meta[property="og:title"]'), ogDesc: g('meta[property="og:description"]'),
        twTitle: g('meta[name="twitter:title"]'), twDesc: g('meta[name="twitter:description"]'),
      },
    };
  });
  await p.close();
  if (errors.length) throw new Error(page.route + ': ' + errors.join(' | '));
  return data;
}

function minifiedRuntime() {
  const code = fs.readFileSync(path.join(ROOT, 'support.js'), 'utf8');
  let esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* optional */ }
  if (!esbuild) { console.warn('esbuild not found: pages will use support.js (not minified)'); return { file: 'support.js', text: code }; }
  const out = esbuild.transformSync(code, { minify: true, target: 'es2020', legalComments: 'none' }).code;
  write('support.min.js', out);
  return { file: 'support.min.js', text: out };
}

(async () => {
  const parsed = {};
  for (const [name, s] of Object.entries(SOURCES)) parsed[name] = parseSource(fs.readFileSync(path.join(ROOT, s.src), 'utf8'), s.src);

  const srv = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('dp-cookie-consent', 'declined'); sessionStorage.setItem('dp-membership-popup', 'seen'); } catch (e) {}
  });
  const local = process.env.LOCAL_NODE_MODULES;
  await ctx.route(/unpkg\.com/, (rt) => {
    if (!local) return rt.continue();
    const u = rt.request().url();
    const map = {
      'react@18.3.1/umd/react.production.min.js': 'react/umd/react.production.min.js',
      'react-dom@18.3.1/umd/react-dom.production.min.js': 'react-dom/umd/react-dom.production.min.js',
      '@babel/standalone@7.29.0/babel.min.js': '@babel/standalone/babel.min.js',
    };
    for (const k in map) if (u.includes(k)) return rt.fulfill({ path: path.join(local, map[k]), contentType: 'application/javascript' });
    return rt.abort();
  });
  await ctx.route(/googletagmanager|google-analytics|script\.google|fontshare/, (rt) => rt.abort());

  const rendered = {};
  try {
    for (const page of PAGES) rendered[page.route] = await renderPage(ctx, page);
  } finally {
    await browser.close();
    srv.close();
  }

  // Shared files.
  const runtime = minifiedRuntime();
  const runtimeUrl = '/' + runtime.file + '?v=' + hash(runtime.text);
  const files = {};
  for (const [name, s] of Object.entries(SOURCES)) {
    const tplText = '<x-dc>\n' + parsed[name].tpl + '\n</x-dc>\n' + parsed[name].dcScript + '\n';
    write(s.tpl, tplText);
    const cssText = '/* Built by tools/build.js from ' + s.src + '. Do not edit. */\n' +
      parsed[name].css + '\n\n/* Pre-rendered copy: hidden while the live page is drawn. */\n#dc-prerender{display:none}\n';
    write(s.css, cssText);
    files[name] = { tpl: '/' + s.tpl + '?v=' + hash(tplText), css: '/' + s.css + '?v=' + hash(cssText) };
  }
  const allStyles = {};
  for (const r of Object.values(rendered)) Object.assign(allStyles, r.styles);
  const preCss = '/* Built by tools/build.js. Styles for the pre-rendered copy, used only without JavaScript. */\n' +
    '#dc-prerender{display:block}\n' +
    '.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}\n' +
    Object.keys(allStyles).sort().map((c) => '.' + c + '{' + allStyles[c] + '}').join('\n') + '\n';
  write('assets/prerender.css', preCss);
  const preCssUrl = '/assets/prerender.css?v=' + hash(preCss);

  for (const page of PAGES) {
    const data = rendered[page.route];
    const src = parsed[page.source];
    const h1s = (data.html.match(/<h1[\s>]/g) || []).length;
    if (h1s !== 1) throw new Error(page.route + ': expected one <h1>, found ' + h1s);
    const html = [
      '<!DOCTYPE html>',
      '<html lang="en-GB">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      pageHead(data.meta, page),
      src.head,
      structuredData(src.ld, page),
      '<link rel="stylesheet" href="' + files[page.source].css + '">',
      '<noscript><link rel="stylesheet" href="' + preCssUrl + '"></noscript>',
      '<script src="' + runtimeUrl + '" defer></script>',
      '</head>',
      '<body>',
      '<div id="dc-prerender" data-css="' + preCssUrl + '">' + data.html + '</div>',
      '<x-dc data-src="' + files[page.source].tpl + '"></x-dc>',
      '</body>',
      '</html>',
      '',
    ].filter((l) => l !== '').join('\n') + '\n';
    write(page.out, html);
    console.log('built', page.out.padEnd(18), String(Math.round(html.length / 1024)).padStart(4) + ' KB', data.meta.title);
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
