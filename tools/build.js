#!/usr/bin/env node
// Builds the public pages of dhowpartners.com from the sources in src/.
//
//   src/site.dc.html   home, services, about, work with us, contact, privacy, terms
//   src/apply.dc.html  membership (/apply)
//
// Edit the sources, then run:   NODE_PATH=$(npm root -g) node tools/build.js
// (needs Node and Playwright). It writes index.html, services.html, about.html,
// work-with-us.html, contact.html, privacy.html, terms.html and apply.html.
//
// Each page gets:
//   - its own <head>: title, description, canonical, social tags and structured data,
//     so search engines, AI assistants and link previews read the right page without JavaScript;
//   - a pre-rendered copy of the page content (#dc-prerender). Browsers with JavaScript hide it
//     and the runtime removes it before drawing the live page, so what visitors see does not change;
//   - the site template inside <script type="text/x-dc-template">, which support.js renders as before.
//
// Optional: LOCAL_NODE_MODULES=/path/to/node_modules serves React and Babel from local copies
// instead of unpkg.com (useful when the build machine has no internet access).

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://dhowpartners.com';
const PORT = 8133;
const PAGES = [
  { route: '/', src: 'src/site.dc.html', out: 'index.html', crumb: null },
  { route: '/services', src: 'src/site.dc.html', out: 'services.html', crumb: 'Services' },
  { route: '/about', src: 'src/site.dc.html', out: 'about.html', crumb: 'About' },
  { route: '/work-with-us', src: 'src/site.dc.html', out: 'work-with-us.html', crumb: 'Work with us' },
  { route: '/contact', src: 'src/site.dc.html', out: 'contact.html', crumb: 'Contact' },
  { route: '/privacy', src: 'src/site.dc.html', out: 'privacy.html', crumb: 'Privacy policy' },
  { route: '/terms', src: 'src/site.dc.html', out: 'terms.html', crumb: 'Terms and agreement' },
  { route: '/apply', src: 'src/apply.dc.html', out: 'apply.html', crumb: 'Membership' },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.txt': 'text/plain', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.css': 'text/css',
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
  if (/<\/script/i.test(tpl)) throw new Error(file + ': the template must not contain </script>');
  if (/<!--/.test(tpl)) throw new Error(file + ': the template must not contain <!-- comments');
  return { head: helmet[1].trim(), tpl: tpl.trim(), dcScript };
}

// Head tags shared by every page, minus the ones written per page.
function sharedHead(head, route) {
  let h = head
    .replace(/<title>[\s\S]*?<\/title>\s*/gi, '')
    .replace(/<meta\s+name="(?:description|robots|twitter:title|twitter:description)"[^>]*>\s*/gi, '')
    .replace(/<meta\s+property="og:(?:title|description|url)"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '');
  // Structured data marked data-only="/route" is kept on that page only.
  h = h.replace(/<script type="application\/ld\+json" data-only="([^"]*)">([\s\S]*?)<\/script>\s*/g,
    (m, only, body) => (only === route ? '<script type="application/ld+json">' + body + '</script>\n' : ''));
  // Load the web fonts without blocking the first paint.
  h = h.replace(/<link rel="stylesheet" href="(https:\/\/api\.fontshare\.com[^"]*)">/g,
    (m, href) => '<link rel="stylesheet" href="' + href + '" media="print" onload="this.media=\'all\'">' +
      '<noscript><link rel="stylesheet" href="' + href + '"></noscript>');
  return h.trim();
}

function pageHead(meta, page) {
  const tags = [
    '<title>' + esc(meta.title) + '</title>',
    '<meta name="description" content="' + esc(meta.desc) + '">',
    '<meta name="robots" content="' + esc(meta.robots || 'index, follow, max-image-preview:large') + '">',
    '<link rel="canonical" href="' + esc(SITE + (page.route === '/' ? '/' : page.route)) + '">',
    '<meta property="og:title" content="' + esc(meta.ogTitle || meta.title) + '">',
    '<meta property="og:description" content="' + esc(meta.ogDesc || meta.desc) + '">',
    '<meta property="og:url" content="' + esc(SITE + (page.route === '/' ? '/' : page.route)) + '">',
    '<meta name="twitter:title" content="' + esc(meta.twTitle || meta.ogTitle || meta.title) + '">',
    '<meta name="twitter:description" content="' + esc(meta.twDesc || meta.ogDesc || meta.desc) + '">',
  ];
  if (page.crumb) {
    tags.push('<script type="application/ld+json">' + JSON.stringify({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: page.crumb, item: SITE + page.route },
      ],
    }) + '</script>');
  }
  return tags.join('\n');
}

function serve() {
  const routeSrc = Object.fromEntries(PAGES.map((p) => [p.route, p.src]));
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]).replace(/\/+$/, '') || '/';
      let f = routeSrc[u] ? path.join(ROOT, routeSrc[u]) : path.join(ROOT, u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
        res.writeHead(404); res.end(); return;
      }
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
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
    root.querySelectorAll('img').forEach((img) => { img.setAttribute('loading', 'lazy'); img.removeAttribute('fetchpriority'); });
    root.querySelectorAll('script, iframe').forEach((n) => n.remove());
    root.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((a) => { if (a.name.startsWith('data-dc-')) el.removeAttribute(a.name); });
    });
    return {
      html: root.innerHTML,
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

function assemble(page, parsed, data) {
  const h1s = (data.html.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) throw new Error(page.route + ': expected one <h1>, found ' + h1s);
  return [
    '<!DOCTYPE html>',
    '<html lang="en-GB">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    pageHead(data.meta, page),
    // With JavaScript, the pre-rendered copy stays hidden and the live page is drawn instead.
    // If the page cannot start (for example a blocked CDN), the copy is shown after 10 seconds.
    '<script>document.documentElement.classList.add(\'dc-js\');setTimeout(function(){if(!document.getElementById(\'dc-root\'))document.documentElement.classList.remove(\'dc-js\')},10000)</script>',
    '<style>.dc-js #dc-prerender{display:none}</style>',
    sharedHead(parsed.head, page.route),
    '<script src="/support.js?v=2" defer></script>',
    '</head>',
    '<body>',
    '<div id="dc-prerender">' + data.html + '</div>',
    '<x-dc><script type="text/x-dc-template">',
    parsed.tpl,
    '</script></x-dc>',
    parsed.dcScript,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

(async () => {
  const sources = {};
  for (const page of PAGES) {
    if (!sources[page.src]) sources[page.src] = parseSource(fs.readFileSync(path.join(ROOT, page.src), 'utf8'), page.src);
  }
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
  try {
    for (const page of PAGES) {
      const data = await renderPage(ctx, page);
      fs.writeFileSync(path.join(ROOT, page.out), assemble(page, sources[page.src], data));
      console.log('built', page.out.padEnd(18), data.meta.title);
    }
  } finally {
    await browser.close();
    srv.close();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
