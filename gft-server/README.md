# GFT Server — Step 1: Real Server + Database Foundation

This is the first backend foundation for moving GFT's authoritative data away
from browser localStorage.

## Architecture

Front ends -> GFT API -> PostgreSQL

The existing HTML pages are NOT changed by this step.

## Stack

- Node.js 20+
- Express
- PostgreSQL
- Helmet
- CORS
- Rate limiting
- Argon2 dependency reserved for server-side password hashing
- Zod dependency reserved for request validation

## Local setup

1. Install Node.js 20+.
2. Install Docker Desktop.
3. Copy `.env.example` to `.env`.
4. Change the database password and SESSION_SECRET.
5. Start PostgreSQL:

   docker compose up -d

6. Install packages:

   npm install

7. Apply the schema:

   psql "postgresql://gft_user:YOUR_PASSWORD@localhost:5432/gft" -f db/schema.sql

8. Start the API:

   npm start

9. Check:

   http://localhost:3000/api/health

## Important

This creates the server/database foundation. It does NOT yet migrate
localStorage or connect the existing front ends.

For production, the database must be hosted securely, secrets must be kept
outside the source code, TLS must be enabled, authentication must use
server-side controls, backups must be configured, and database access must
not be exposed publicly.

The next phase after this foundation is data migration + API integration.
