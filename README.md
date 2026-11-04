# StudioSpace Server

REST API for **StudioSpace**, a peer-to-peer marketplace where hosts list creative workspaces (photo studios, film stages, podcast lounges, music suites, workshops) and creators book them by the hour.

**Live API:** https://studiospace-server-rosy.vercel.app
**Live site:** https://studiospace-client-navy.vercel.app
**Client repository:** https://github.com/ayeshasiddika3288-ayesha/studiospace-client

## Features

- Studio CRUD with search, category filter, sorting, and result limits
- Booking system with automatic price calculation done on the server
- Double-booking prevention: new requests and confirmations are checked for time overlap against confirmed bookings (`409 Conflict` with a clear message)
- JWT authentication stored in an **HTTPOnly cookie**
- Protected routes return `401 Unauthorized` without a valid token
- Ownership checks: only a studio owner can edit or delete a listing, only the host can confirm or complete a booking, and only the guest can cancel a pending booking
- Serverless-ready Express app deployed on Vercel

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB Atlas (official MongoDB driver)
- **Auth:** JSON Web Tokens (`jsonwebtoken`) with `cookie-parser`
- **Other:** CORS with credentials, dotenv
- **Hosting:** Vercel

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/jwt` | Verifies the signed token from the client and sets it as an HTTPOnly cookie |
| POST | `/api/logout` | Clears the auth cookie |

### Studios

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/studios` | Public | List studios. Query: `category`, `search`, `ownerEmail`, `sort=rating`, `limit` |
| GET | `/api/studios/:id` | Public | Get a single studio |
| POST | `/api/studios` | Required | Create a studio (owner is taken from the token) |
| PUT | `/api/studios/:id` | Owner only | Update a studio |
| DELETE | `/api/studios/:id` | Owner only | Delete a studio |

### Bookings

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/bookings` | Required | Create a booking with status `Pending` (rejects overlaps with confirmed bookings) |
| GET | `/api/bookings` | Public | List bookings. Query: `userEmail` or `hostEmail` |
| PATCH | `/api/bookings/:id/cancel` | Guest only | Cancel a pending booking |
| PATCH | `/api/bookings/:id/status` | Host only | Set status to `Confirmed` or `Completed` |

## Booking Overlap Rule

Two bookings on the same studio and date overlap when:

```
existing.startTime < new.endTime  AND  existing.endTime > new.startTime
```

Back-to-back slots (for example 10:00 to 12:00 followed by 12:00 to 14:00) are allowed.

## Environment Variables

Create a `.env` file (see `.env.example`):

```
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_long_random_secret
CLIENT_URL=http://localhost:3000
```

`JWT_SECRET` must be the same value that the client uses to sign tokens.

## Run Locally

```bash
git clone https://github.com/ayeshasiddika3288-ayesha/studiospace-server.git
cd studiospace-server
npm install
npm run dev
```

The server starts on http://localhost:5000 and prints `MongoDB connected` when the database is ready.

## Project Structure

```
studiospace-server/
├── index.js        # Express app, routes, JWT middleware
├── vercel.json     # Vercel serverless configuration
├── .env.example    # Environment variable template
└── package.json
```

## Deployment

The app is deployed on Vercel. Set `MONGODB_URI`, `JWT_SECRET`, and `CLIENT_URL` (the live client URL, without a trailing slash) in the Vercel project settings, then redeploy.