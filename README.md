# MoneyMate: a personal finance app for university students, with an AI assistant

> แอปจัดการเงินสำหรับนักศึกษา: บันทึกรายรับรายจ่าย ตั้งงบรายเดือน วางแผนการเงินล่วงหน้า 12 เดือน และผู้ช่วย AI ที่วิเคราะห์การใช้เงินให้

**Live:** https://moneymate-ral8.onrender.com · **Pitch deck:** [moneymate-deck](https://github.com/naphatphong/moneymate-deck) · **Survey dashboard:** [moneymate-dashboard](https://github.com/naphatphong/moneymate-dashboard)

Most students get money from home, a part-time job or a scholarship, and run out before the month ends.
MoneyMate answers three questions: **Where did my money go? Will it last this month? Am I OK for the next 12 months?**

`Node.js` · `Express` · `PostgreSQL` · `Session auth + bcrypt` · `Google OAuth 2.0 (PKCE)` · `Gemini API` ·
`Brevo (email)` · `Vanilla JS` · `Render`

---

## Highlights

| | |
|---|---|
| **Auth I built from scratch** | Register / login with bcrypt, server sessions, Google login (OAuth 2.0 + PKCE, no library), account linking, password reset by email |
| **Security decisions** | Reset tokens stored only as SHA-256 hashes, 30-min single use; the same reply whether an email exists or not; rate limits; `state` check against CSRF on OAuth; secure httpOnly cookies |
| **AI with guardrails** | Consent first, daily quota per user, only aggregated numbers sent (no names or emails), multi-model fallback with timeouts, cached results |
| **Forecasting logic** | The planner simulates the balance day by day for 12 months, from recurring income and expenses |
| **Full product loop** | Landing page → app → admin panel → in-app survey → separate analytics dashboard + pitch deck |

---

## How I thought about it

### 1. Architecture

```mermaid
flowchart LR
    subgraph Browser
        L[Landing page]
        APP[app.html<br/>dashboard · analytics · planner · AI]
        ADM[admin.html]
    end
    subgraph Server["Express server (server.js)"]
        AUTH[Auth<br/>session · bcrypt · Google OAuth]
        API[REST API<br/>transactions · categories · budgets · plan]
        AI[ai.js<br/>Gemini gateway]
        MAIL[mailer.js<br/>Brevo]
    end
    DB[(PostgreSQL)]
    G[Google OAuth]
    GM[Gemini API]
    BR[Brevo]

    L & APP & ADM -->|fetch + session cookie| AUTH & API
    APP --> AI
    AUTH --> G
    AUTH --> MAIL --> BR
    AI --> GM
    AUTH & API & AI --> DB
```

**Why vanilla JS + Express?** One server serves both the static pages and the API, so there's one deploy
(Render), no build step, and the whole flow from click to SQL is easy to follow.

### 2. Auth flows and the "why" behind each rule

**Google login (OAuth 2.0 authorization code + PKCE, written by hand):**

```mermaid
sequenceDiagram
    actor U as User
    participant S as Express
    participant G as Google
    U->>S: GET /auth/google (mode = login | link)
    S->>S: make state + code_verifier, save in session
    S->>U: redirect to Google (code_challenge, state)
    U->>G: choose account
    G->>S: /auth/google/callback?code&state
    S->>S: state must match the session (anti-CSRF), < 10 min old
    S->>G: exchange code + code_verifier → token → profile
    S->>S: email must be verified by Google
    alt mode = link
        S->>S: attach google_id to the logged-in user
    else existing email, not linked
        S-->>U: refuse: "log in with password, then link Google"
    else new email
        S->>S: create user with a unique username
    end
    S-->>U: session cookie → /app.html
```

> **Why not link accounts automatically by email?** Sign-up doesn't verify email. Someone could register
> with *your* email first, wait for you to "log in with Google", and get linked to your account. So linking
> only happens from inside an account you've already proved you own.

**Forgot password:**

| Rule | Why |
|---|---|
| Same reply whether the email exists or not, sent *before* any work | Nobody can use the form to find out who has an account |
| Token = 32 random bytes; DB keeps only `sha256(token)` | A leaked database can't be used to reset passwords |
| Expires in 30 min, works once | Limits the damage from a forwarded or old email |
| Link built from `APP_URL`, never the `Host` header | Stops host-header injection that would send links to an attacker's domain |
| Rate limit: 5 / 15 min per IP, 3 / hour per email | No email bombing |

### 3. The AI assistant: useful, private and affordable

```mermaid
flowchart TB
    R[User presses 'Analyse'] --> E{AI enabled<br/>on server?}
    E -->|no| X1[503 disabled]
    E -->|yes| C{User gave<br/>consent?}
    C -->|no| X2[403 ask for consent]
    C -->|yes| Q{Used today<br/>< daily limit?}
    Q -->|no| X3[429 come back tomorrow]
    Q -->|yes| CTX["buildContext(): totals by category,<br/>budget pace, 12-month plan<br/>(numbers only, no names or emails)"]
    CTX --> M1[Try model 1, 25 s timeout]
    M1 -->|slow or 404| M2[Try next model]
    M2 -->|total budget 60 s| M3[...]
    M1 & M2 & M3 -->|ok| J[Parse JSON, clip lengths,<br/>whitelist 'tone' values]
    J --> SAVE[Cache result + count usage]
    SAVE --> UI[Show insights]
```

Decisions:

- **Only call the AI when the user presses the button.** Opening the page shows the cached result, so it
  costs nothing.
- **Never trust model output:** strip ```` ```json ```` fences, fall back to the outermost `{...}`, clip every
  field, and whitelist enum values before they reach the UI.
- **Remember the model that works** and skip it again if it gets slow, so one slow model doesn't make
  every user wait.
- If a model rejects the "no thinking" setting, retry the same model without it instead of failing.

### 4. The 12-month planner

Users enter expected income and expenses (daily, weekly, monthly or one-off). The planner then:

1. Starts from the **real balance today** (opening balance + every transaction up to now).
2. Walks **day by day from tomorrow** for 12 months, adding plan items that fall on each day plus any real
   transactions dated in the future.
3. Reports, for each month, whether money lasts, what's left, and **the first day the balance goes negative**.

A day-by-day walk was easier to get right than monthly averages, because "monthly on the 25th" and "weekly"
items land on different days in different months.

### 5. Data model

```mermaid
erDiagram
    users ||--o{ transactions : has
    users ||--|| user_settings : has
    users ||--o{ monthly_budgets : sets
    users ||--o{ user_categories : creates
    users ||--o{ plan_items : plans
    users ||--o{ ai_usage : "quota per day"
    users ||--o{ ai_cache : caches
    users ||--o{ password_resets : requests
    users ||--o{ survey_responses : answers
```

Every user-owned table references `users` with `ON DELETE CASCADE` and uses `CHECK` / `UNIQUE` constraints
(`type IN ('income','expense')`, `amount > 0`, one budget per user per month), so the database rejects bad data. The schema migrates itself at startup
(`CREATE TABLE / ALTER TABLE ... IF NOT EXISTS`), so a fresh database or an old one both just work.

---

## Features

- **Transactions:** income and expenses, built-in and custom categories
- **Budgets:** a monthly budget per month, warnings at 80% and over budget
- **Analytics:** 30D / 90D / 6M / 1Y / all-time charts, all computed in the browser from loaded data
- **Planner:** 12-month cash-flow forecast
- **AI assistant:** monthly insights, budget advice, chat, AI-drafted plan (Thai / English)
- **Accounts:** password or Google, link/unlink Google, forgot password by email
- **Admin:** user stats, roles, test email
- **Survey:** an in-app questionnaire feeding the [analytics dashboard](https://github.com/naphatphong/moneymate-dashboard)
- Dark / light / system theme with a custom accent colour

## Run it locally

```bash
npm install
cp .env.example .env      # set DATABASE_URL and SESSION_SECRET (everything else is optional)
npm start                 # http://localhost:3000
npm run seed:demo         # optional: a demo student account with a year of sample data
```

Optional features turn on when you set their keys in `.env` (see the comments there):
`BREVO_API_KEY` (email), `GOOGLE_CLIENT_ID/SECRET` (Google login), `GEMINI_API_KEY` (AI).
Without email set up, reset links print to the server console in development.

## Project structure

| File | What it does |
|---|---|
| `server.js` | Express app: session, auth, REST API, AI routes, admin |
| `database.js` | PostgreSQL pool, schema migration at startup, all queries |
| `googleAuth.js` | Google OAuth 2.0 + PKCE without a library |
| `ai.js` | Gemini gateway: model fallback, timeouts, JSON parsing, context builder |
| `mailer.js` | Brevo email + readable error explanations |
| `public/` | Landing, app, admin and auth pages (vanilla JS modules in `public/js/`) |
| `scripts/seed-demo.js` | Demo data |

## What I'd do next

- Automated tests (Jest + Supertest) for auth and the planner maths
- Move rate limits from memory to Postgres or Redis so they survive restarts and multiple instances
- Split `server.js` into route modules, and add input validation with a schema (zod)
- Port the frontend to a component framework as the app grows
