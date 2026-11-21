# Negotiator app

Salary-negotiation preparation coach for Sweden. The Obsidian vault is the source of truth (copied into `vault/` by `npm run sync-vault`). Plan: vault note `90-Build-Notes/Build-Plan.md`.

```
npm install
npm test
npm run dev
```
Secrets go in `.env.local` (never committed); see `.env.example`.

## Run it

Local: `cp .env.example .env.local`, put your Anthropic key in `ANTHROPIC_API_KEY`, then `npm run dev` and open http://localhost:3000.
Hosted: import the repo in Vercel and set `ANTHROPIC_API_KEY` under Settings > Environment Variables.

The server keeps nothing between requests: the session state travels with the browser and is gone when the page is closed.
