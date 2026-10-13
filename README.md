# Dhow_Website

The official website of **Dhow Partners Ltd**, Nairobi, Kenya.

> **Your way in.** Dhow Partners helps companies and investors set up, stay compliant and grow in Kenya and East Africa, through one point of contact and a vetted network of specialist firms.

Live site: **https://dhowpartners.com**

---

## 1. What this is

A fast, static website. There is **no build step, no framework install and no database**. Every file in this repository is served exactly as it is.

| Item | Detail |
| --- | --- |
| Type | Static single-page site (HTML, CSS, JavaScript) |
| Entry point | `index.html` |
| Hosting | Vercel (recommended), Netlify or GitHub Pages |
| Domain | `dhowpartners.com` |
| Booking | https://calendly.com/hello-dhowpartners/30min |
| Contact form | Emails `hello@dhowpartners.com` via FormSubmit |
| Analytics | Google Analytics 4, loads only after cookie consent |

---

## 2. Pages

All pages live inside `index.html` and have their own clean URL.

| URL | Page |
| --- | --- |
| `/` | Home |
| `/services` | What we do |
| `/about` | Why we started Dhow Partners |
| `/contact` | Contact and message form |
| `/work-with-us` | Careers |
| `/privacy` | Privacy policy (Kenya Data Protection Act, 2019) |
| `/terms` | Terms and agreement |
| any other path | Custom 404 page |

---

## 3. Files

```
Dhow_Website/
├── index.html              The whole website (all pages)
├── support.js              Runtime that renders the site. Do not edit.
├── 404.html                "Page not found" page
├── robots.txt              Rules for search engines and AI crawlers
├── sitemap.xml             List of pages for Google and Bing
├── llms.txt                Plain-English summary for AI assistants
├── manifest.webmanifest    App icon and name for phones
├── vercel.json             Clean URLs and routing on Vercel
├── _redirects              Same routing on Netlify
├── CNAME                   Custom domain for GitHub Pages
├── .nojekyll               Tells GitHub Pages to serve files as they are
├── .gitignore              Files Git should ignore
├── README.md               This file
└── assets/
    ├── favicon-32.png      Browser tab icon
    ├── favicon-180.png     iPhone home screen icon
    ├── favicon-512.png     Android and app icon
    ├── dp-icon.png         D icon
    ├── dp-og.png           Image shown when the link is shared (1200 × 630)
    ├── why-*-w.png         Icons for "Built for people who can't afford to lose months"
    ├── serve-*.png         Icons for "Who we work with"
    └── photos/
        ├── hero-nairobi.jpg
        ├── team-samuel.jpg
        ├── team-mercy.jpg
        └── svc-*.jpg       Service photos (7)
```

---

## 4. Publish to GitHub (first time)

Open a terminal **inside this folder** and run:

```bash
git init
git add .
git commit -m "Launch Dhow Partners website"
git branch -M main
git remote add origin https://github.com/Dhow-Partners/Dhow_Website.git
git push -u origin main
```

Use `git add .` (not `git add README.md`) so that **every file** is uploaded.

If GitHub says the repository already has a commit (for example a README created on github.com), run this once and push again:

```bash
git pull origin main --allow-unrelated-histories
git push -u origin main
```

---

## 5. Put it live

### Option A: Vercel (recommended)

1. Go to https://vercel.com and sign in with GitHub.
2. **Add New → Project →** choose `Dhow-Partners/Dhow_Website`.
3. Framework preset: **Other**. Leave build command and output directory **empty**.
4. Click **Deploy**.
5. **Settings → Domains →** add `dhowpartners.com` and `www.dhowpartners.com`, then add the DNS records Vercel shows you at your domain registrar.

`vercel.json` already gives every page a clean URL and sends unknown paths to the 404 page.

### Option B: Netlify

1. https://app.netlify.com → **Add new site → Import from Git** → choose the repository.
2. Build command: empty. Publish directory: `/`.
3. Deploy, then add the domain under **Domain management**.

`_redirects` handles the routing.

### Option C: GitHub Pages

1. On GitHub: **Settings → Pages**.
2. Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Custom domain: `dhowpartners.com`. Tick **Enforce HTTPS**.

`CNAME`, `.nojekyll` and `404.html` are already set up for this.

---

## 6. Before you launch: checklist

- [ ] **Google Analytics ID.** In `index.html`, search for `G-XXXXXXXXXX` and replace it (every time it appears) with your real Measurement ID from Google Analytics → Admin → Data streams.
- [ ] **Contact form.** Send one test message from the live site. FormSubmit emails `hello@dhowpartners.com` an activation link. Click it once. Every message after that is delivered.
- [ ] **Mailbox.** Make sure `hello@dhowpartners.com` exists and receives mail.
- [ ] **Booking.** Click every *Book a call* button. Each opens https://calendly.com/hello-dhowpartners/30min.
- [ ] **Phone.** Test on a real phone: menu, buttons, form, all pages.
- [ ] **Legal.** Have a Kenyan advocate review `/privacy` and `/terms`, and check whether you must register with the Office of the Data Protection Commissioner (ODPC).
- [ ] **404.** Visit `dhowpartners.com/anything` and confirm the "Page not found" page shows.

---

## 7. After launch: search and AI visibility

1. **Google Search Console** (https://search.google.com/search-console): add `dhowpartners.com`, verify, then submit `https://dhowpartners.com/sitemap.xml`.
2. **Bing Webmaster Tools** (https://www.bing.com/webmasters): import from Google Search Console or submit the sitemap. Bing also feeds ChatGPT and Copilot search.
3. **Google Business Profile** (https://business.google.com): create a profile for Dhow Partners at 519 Embassy House, Nairobi. This is the single biggest boost for local search and Maps.
4. **LinkedIn company page**: use the same name, tagline and website link.
5. **Share preview**: paste the URL into https://www.linkedin.com/post-inspector/ and https://developers.facebook.com/tools/debug/ to refresh the preview image.

### What is already built in

- Page titles and descriptions written for search.
- Open Graph and Twitter cards with `assets/dp-og.png`.
- Structured data (JSON-LD): Organization, ProfessionalService with all seven services, address, booking action and an FAQ.
- `robots.txt` that welcomes Google, Bing and AI assistants (ChatGPT, Claude, Perplexity, Apple, Google AI).
- `sitemap.xml` listing every page.
- `llms.txt`: a clean summary AI assistants can read and quote accurately.
- Fast loading: no external photo services, images stored locally.

---

## 8. Making changes later

- **Text, prices, contact details:** open `index.html`, search for the words you want to change, edit, save, then commit and push. The live site updates in about a minute.

  ```bash
  git add .
  git commit -m "Update contact page"
  git push
  ```

- **Photos:** replace a file in `assets/photos/` with a new one **using the same file name**.
- **New page or section:** keep the same fonts (Cabinet Grotesk for headings, Switzer for text) and colours below.

### Brand

| Use | Colour |
| --- | --- |
| Navy (main) | `#00395F` |
| Green (accent) | `#00846D` |
| Light green | `#63B8A8` |
| Background | `#EBEFF2` |
| Text grey | `#4A6478` |

- Logo: **Dhow Partners**, with a solid green dot as the "o".
- Icon: the D with an arrow entering (the way in).
- Tagline: **Your way in.**
- Main button everywhere: **Book a call**.

---

## 9. Contact

**Dhow Partners Ltd**
519 Embassy House, Nairobi, Kenya
hello@dhowpartners.com · +254 716 688 988
https://dhowpartners.com

© 2026 Dhow Partners Ltd. All rights reserved.
