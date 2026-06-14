# Project Overview
- **Project Name:** Con Leche Coffee Shop Rewarding System
- **Owner:** Iwan Rademan
- **Tech stack:** Node.js, Express, MongoDB/Mongoose, EJS, Nodemailer

---

## Developer Instructions
- The developer's name is **Iwan**. Start every response with a personal greeting like "Here you go, Iwan!" or "Got it, Iwan —" so he knows Claude is reading this file.
- This is a loyalty/battlepass system for a cat-friendly specialty coffee truck called Con Leche based in Pretoria, South Africa.
- Currency is ZAR (R). Dates use `en-ZA` locale.
- The colour palette: `--maroon` (#581217), `--cream` (#fdf6ed), `--charcoal` (#2c2c2c).

---

## Goals
- Let customers earn stamps (QR scan per drink) and unlock tiered rewards.
- Give the admin (owner/manager) tools to manage members, events, specials, and scheduled email notifications.
- Keep the public-facing site welcoming for first-time visitors — menu and events browsable without signing up.

---

## Constraints
- No heavy frontend frameworks — plain EJS + vanilla JS only.
- No unnecessary abstractions or extra packages unless there is a clear need.
- Keep emails branded: maroon header, cream background, Con Leche logo text.

---

## References
- Admin panel lives at `/admin`
- Loyalty page (battlepass) at `/battlepass`
- Easter egg at `/the-bean-awakens` — do not make this page discoverable via the main nav
