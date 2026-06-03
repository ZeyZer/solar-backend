# Zeyzer Solar — Development and Deployment Checklist

## Purpose

This document explains how to run, test and deploy the Zeyzer Solar quote tool.

It is intended to protect the project from mistakes when making future calculation, frontend or backend changes.

---

## Local backend

From the backend folder:

```bash
node server.js
```

The backend normally runs on:

```txt
http://localhost:4000
```

Required local environment variables are stored in:

```txt
.env.local
```

Important local backend variables:

```env
FRONTEND_URL=http://localhost:3000
PDF_FRONTEND_URL=http://localhost:3000

SUPABASE_ENABLED=true
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

BREVO_API_KEY=your-brevo-api-key
BREVO_TEMPLATE_ID_QUOTE=your-quote-template-id
BREVO_TEMPLATE_ID_CALL=your-call-template-id
BREVO_QUOTE_LIST_ID=your-quote-list-id
BREVO_CALL_LIST_ID=your-call-list-id
BREVO_MARKETING_LIST_ID=your-marketing-list-id
```

Never commit `.env`, `.env.local`, service role keys, API keys or private credentials.

---

## Local frontend

From the frontend folder:

```bash
npm start
```

The frontend normally runs on:

```txt
http://localhost:3000
```

For local frontend API calls, use:

```env
REACT_APP_API_BASE=http://localhost:4000
```

---

## Backend tests

From the backend folder, run:

```bash
npm run smoke
npm run regression
```

Or run both together:

```bash
npm run test:quote
```

Both tests should pass before committing calculation changes.

If a test fails once because of a temporary PVGIS/postcode fetch failure, run it again. If it fails repeatedly, investigate before committing.

---

## Production backend

The backend is hosted on Render.

Important Render environment variables:

```env
NODE_ENV=production
FRONTEND_URL=https://quote.zeyzersolar.com
PDF_FRONTEND_URL=https://quote.zeyzersolar.com

SUPABASE_ENABLED=true
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

BREVO_API_KEY=your-brevo-api-key
BREVO_TEMPLATE_ID_QUOTE=your-quote-template-id
BREVO_TEMPLATE_ID_CALL=your-call-template-id
BREVO_QUOTE_LIST_ID=your-quote-list-id
BREVO_CALL_LIST_ID=your-call-list-id
BREVO_MARKETING_LIST_ID=your-marketing-list-id
```

The Supabase service role key must only be stored in the backend environment.

It must never be added to the frontend.

---

## Production frontend

The quote tool frontend is hosted on:

```txt
https://quote.zeyzersolar.com
```

The main marketing website is hosted on:

```txt
https://www.zeyzersolar.com
```

For production builds, the frontend should use:

```env
REACT_APP_API_BASE=https://solar-backend-vp7n.onrender.com
```

Use the actual Render backend URL if this changes.

Build the frontend from the frontend folder:

```bash
npm run build
```

Upload the contents of:

```txt
frontend/build
```

to the Hostinger subdomain folder for:

```txt
quote.zeyzersolar.com
```

Do not upload the `build` folder itself. Upload the contents inside it.

The subdomain folder should contain files like:

```txt
index.html
asset-manifest.json
static/
images/
icons/
```

---

## Backend pre-deploy checklist

Before deploying backend changes:

- [ ] `npm run smoke` passes
- [ ] `npm run regression` passes
- [ ] `npm run test:quote` passes, if available
- [ ] no secrets are staged
- [ ] `.env` and `.env.local` are not committed
- [ ] `git status` is clean after commit
- [ ] Render environment variables are correct
- [ ] Supabase is reachable
- [ ] Brevo API key is active
- [ ] PDF generation works locally if PDF code changed

---

## Frontend pre-deploy checklist

Before uploading a new frontend build:

- [ ] `npm run build` succeeds
- [ ] `REACT_APP_API_BASE` points to the live backend
- [ ] `quote.zeyzersolar.com` opens directly to the form
- [ ] PDF download works after upload
- [ ] email quote works after upload
- [ ] request call works after upload
- [ ] legal links work
- [ ] images, icons and PDF assets are included in the build upload

---

## Live beta smoke test

After deployment:

1. Open `https://www.zeyzersolar.com`
2. Click a quote CTA button
3. Confirm `https://quote.zeyzersolar.com` opens
4. Confirm the calculator opens directly to the form
5. Generate a quote
6. Confirm Supabase `leads` row is created
7. Confirm the quote has a `lead_id`
8. Download PDF
9. Confirm the PDF opens correctly
10. Confirm Supabase `lead_events` has `pdf_downloaded`
11. Email quote
12. Confirm the email arrives
13. Confirm Supabase `lead_events` has `pdf_email_requested`
14. Request call
15. Confirm Supabase `lead_events` has `call_requested`
16. Confirm all events use the same `lead_id` as the quote
17. Regenerate a PDF from the `lead_id` if needed

---

## Quote regeneration

To regenerate a quote PDF from the live backend:

```bash
curl -X POST \
  "https://solar-backend-vp7n.onrender.com/api/quote/pdf/from-lead/PASTE_LEAD_ID_HERE" \
  --output ~/Desktop/regenerated-quote.pdf
```

Then open it:

```bash
open ~/Desktop/regenerated-quote.pdf
```

Use the `lead_id` field from Supabase, not the Supabase row `id`.

---

## Current beta architecture

```txt
www.zeyzersolar.com
  = marketing website

quote.zeyzersolar.com
  = React quote tool frontend on Hostinger

Render backend
  = quote calculation, PDF generation, Brevo, Supabase writes

Supabase
  = full quote/lead database

Brevo
  = contact sync and email delivery
```

---

## Important rule before calculation changes

Before changing calculation logic, run:

```bash
npm run test:quote
```

Then check that important outputs still behave as expected:

- annual generation
- annual import
- annual export
- annual self-consumption
- annual bill saving
- export income
- total annual benefit
- payback
- battery recommendation
- hourly model availability

If numbers move significantly, the change should be intentional and documented.