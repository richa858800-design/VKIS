# V.K. International School — GitHub-ready demo

## What's included
- `public/index.html` — public school website
- `public/style.css` — responsive styling
- `public/script.js` — gallery, navigation and form interactions
- `public/assets/` — school photo assets
- `server.js` — backend for admission/job submissions and staff login
- `private/admin.html` — staff dashboard (served only through the authenticated server route)
- `.env.example` — local demo configuration template

## Run locally
Requires Node.js 20 or newer.

1. Copy `.env.example` to `.env`.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.
5. Demo staff portal: `http://localhost:3000/staff-portal-128`.
6. Demo password: `12345678`.

**Demo credentials are for localhost testing only. Never deploy this password or `DEMO_MODE=true` publicly.** Before a real launch, set a strong `ADMIN_PASSWORD`, a random `SESSION_SECRET`, disable demo mode, enable HTTPS, and configure secure database backups and access controls.

## GitHub upload
Create a repository and upload the contents of this folder. Keep the folder structure intact. In particular, do not move `style.css`, `script.js`, or the `assets` folder out of `public/`.

## Hosting note
This project includes an Express + SQLite backend. A static-only Vercel deployment will publish the public pages but will not run this backend or provide durable SQLite storage. Use a Node.js host with persistent storage for the full admissions/admin demo, or adapt the backend to a managed database and serverless-compatible hosting before production.

## Photo note
The website's hero/about imagery includes images embedded in the HTML, and the `public/assets/` folder contains the cropped school-photo assets from the supplied screenshot materials. Cropped screenshots are not equivalent to original high-resolution camera photos; replace them with originals supplied by the school before official publication.
