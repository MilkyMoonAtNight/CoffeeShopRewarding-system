# Con Leche ☕🐱

Specialty coffee, friendly cats, and a loyalty battlepass system.

## Stack
- **Node.js + Express** — server
- **EJS** — templating
- **Mongoose + MongoDB** — database
- **qrcode** — QR code generation
- **bcryptjs** — password hashing
- **express-session** — auth sessions

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Make sure MongoDB is running locally
mongod

# 3. Configure environment variables
cp .env .env.local
# Edit .env with your MONGODB_URI and SESSION_SECRET

# 4. Start the server
npm start
# or for dev with auto-reload:
npm run dev
```

Server starts at **http://localhost:3000**

## Pages
| Route | Description |
|-------|-------------|
| `/` | Home |
| `/about` | Our story |
| `/drinks` | Drinks menu |
| `/pastries` | Pastries menu |
| `/events` | Events & calendar |
| `/register` | Create account |
| `/login` | Sign in |
| `/battlepass` | User dashboard + QR code |
| `/battlepass/admin/scan` | Staff scan page |

## Battlepass Milestones
| Drinks | Reward |
|--------|--------|
| 10 | 10% off pastries |
| 20 | 10% off pastries |
| 30 | Free drink |
| 40 | 10% off pastries |
| 50 | Con Leche cap |
| 60 | 10% off pastries |
| 70 | 10% off pastries |
| 80 | Free drink + pastry combo |
| 90 | 10% off pastries |
| 100 | Exclusive hoodie + free drink for a month |

## Tiers
- 🐱 Kitten — 0–14 drinks
- 🐈 Cat — 15–39 drinks
- 😸 Tom Cat — 40–74 drinks
- 🐆 Panther — 75+ drinks

## Scanning Flow (Staff)
1. Customer opens `/battlepass` and shows their QR code
2. Staff goes to `/battlepass/admin/scan`
3. Scan or paste the QR token and enter the drink ordered
4. API records the drink and returns any new rewards unlocked

## Production Notes
- Change `SESSION_SECRET` in `.env`
- Add admin authentication middleware to the scan endpoint
- Set `cookie.secure = true` behind HTTPS
- Consider using MongoDB Atlas for cloud database
