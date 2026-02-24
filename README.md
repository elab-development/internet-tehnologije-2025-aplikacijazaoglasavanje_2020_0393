# C2C E-Commerce Platform

Fullstack **C2C (Consumer-to-Consumer) e-commerce** web aplikacija za oglašavanje i kupovinu proizvoda između korisnika. Prodavci kreiraju oglase, kupci naručuju, a administratori moderišu sadržaj.

## Tehnologije

| Sloj | Tehnologije |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| Backend / API | Next.js Route Handlers (REST API) |
| Baza podataka | PostgreSQL 16 |
| ORM | Drizzle ORM |
| Autentifikacija | JWT (jsonwebtoken), bcrypt |
| Validacija | Zod |
| Kontejnerizacija | Docker, Docker Compose |
| CI/CD | GitHub Actions |
| Cloud | Railway |

## Glavne funkcionalnosti

- **Registracija i prijava** korisnika (buyer / seller) sa JWT autentifikacijom
- **CRUD za oglase** – prodavci kreiraju oglase sa slikom, cenom, kategorijom
- **Naručivanje** – kupci kreiraju narudžbine sa jednim ili više proizvoda
- **Recenzije** – kupci mogu oceniti oglase (1–5 zvezdica)
- **Upravljanje kategorijama** (admin)
- **Seller dashboard** – prodavci vide i odobravaju/odbijaju narudžbine
- **Admin panel** – potpuna kontrola nad korisnicima, narudžbinama, oglasima

## Struktura projekta

```
├── .github/workflows/       # CI/CD pipeline (GitHub Actions)
│   ├── ci.yml               # Lint, test, Docker build na svaki push/PR
│   └── deploy.yml           # Build, push image, deploy na Railway
├── c2c-e-commerce/          # Next.js aplikacija
│   ├── src/
│   │   ├── app/
│   │   │   ├── (frontend)/  # Stranice (listings, orders, login, register...)
│   │   │   └── api/         # REST API route handleri
│   │   ├── components/      # React komponente (Navbar, Footer, UI kit)
│   │   ├── context/         # AuthContext (React Context za autentifikaciju)
│   │   ├── db/              # Drizzle ORM (schema, migracije, seed)
│   │   ├── hooks/           # Custom React hookovi
│   │   └── lib/             # Pomoćne funkcije (auth, validation, middleware)
│   ├── drizzle/             # SQL migracije
│   ├── Dockerfile           # Multi-stage Docker build (standalone output)
│   └── vitest.config.ts     # Konfiguracija za testove
├── docker-compose.yml       # Produkcioni Docker Compose
├── docker-compose.dev.yml   # Development Docker Compose (live reload)
└── .env.example             # Primer environment varijabli
```

## Preduslovi

- [Docker](https://docs.docker.com/get-docker/) i Docker Compose
- (Opciono) Node.js 20+ i npm za lokalni razvoj bez Dockera

## Pokretanje aplikacije

### 1. Kloniranje repozitorijuma

```bash
git clone <repository-url>
cd iteh-c2c-ecommerce
```

### 2. Podešavanje environment varijabli

```bash
cp .env.example .env
```

Izmenite `.env` fajl i postavite vrednosti:

| Varijabla | Opis | Primer |
|---|---|---|
| `POSTGRES_USER` | PostgreSQL korisnik | `postgres` |
| `POSTGRES_PASSWORD` | PostgreSQL lozinka | `postgres` |
| `POSTGRES_DB` | Ime baze podataka | `c2c_ecommerce` |
| `DATABASE_URL` | Connection string za bazu | `postgresql://postgres:postgres@db:5432/c2c_ecommerce` |
| `JWT_SECRET` | Tajni ključ za JWT tokene | (dugačak random string) |

### 3a. Pokretanje u development modu (sa live reload)

```bash
docker compose -f docker-compose.dev.yml up --build
```

Ovo pokreće:
- **PostgreSQL** bazu na portu `5432`
- **Migracije** automatski
- **Next.js dev server** na portu `3000` sa hot reload

Pristupite aplikaciji na: **http://localhost:3000**

### 3b. Pokretanje u produkcionom modu

```bash
docker compose up --build
```

Produkcioni build koristi Next.js `standalone` output za optimalan Docker image.

### 4. Seed podataka (opciono)

```bash
docker compose exec app npm run db:seed
```

## Pokretanje bez Dockera

```bash
cd c2c-e-commerce
npm install
```

Potrebna je lokalna PostgreSQL instanca. Postavite `DATABASE_URL` u `.env` da pokazuje na nju.

```bash
npm run db:migrate   # Pokreni migracije
npm run db:seed      # Opciono: ubaci test podatke
npm run dev          # Development server
```

## Testiranje

```bash
cd c2c-e-commerce
npm run test         # Pokreni sve testove (Vitest)
npm run test:watch   # Watch mod
npm run lint         # ESLint
```

Testovi pokrivaju:
- Validacione šeme (Zod) – registracija, login, listing, order, review
- Middleware – autentifikacija i autorizacija
- Auth helperi – hashovanje lozinki, JWT token sign/verify

## Baza podataka

### Šema

```
users ──< listings ──< reviews
  │                      ↑
  └──< orders ──< order_items ──→ listings
                                categories ──< listings
```

| Tabela | Opis |
|---|---|
| `users` | Korisnici (id, email, name, role, phoneNumber) |
| `categories` | Kategorije oglasa (id, name, slug, description) |
| `listings` | Oglasi (id, title, description, price, imageUrl, status, sellerId, categoryId) |
| `orders` | Narudžbine (id, buyerId, totalPrice, status) |
| `order_items` | Stavke narudžbina (orderId, listingId, price, quantity) |
| `reviews` | Recenzije (id, reviewerId, listingId, rating, comment) |

### Drizzle komande

```bash
npm run db:generate  # Generiši novu migraciju
npm run db:migrate   # Primeni migracije
npm run db:push      # Push schema direktno (dev)
npm run db:seed      # Seed test podataka
npm run db:studio    # Drizzle Studio (GUI)
```

## API Endpointi

### Autentifikacija

| Metoda | Ruta | Opis |
|---|---|---|
| POST | `/api/auth/register` | Registracija novog korisnika |
| POST | `/api/auth/login` | Prijava, vraća JWT token |
| POST | `/api/auth/logout` | Odjava |
| GET | `/api/auth/me` | Trenutni korisnik (zahteva token) |

### Kategorije

| Metoda | Ruta | Opis |
|---|---|---|
| GET | `/api/categories` | Lista svih kategorija |
| POST | `/api/categories` | Nova kategorija (admin) |
| PUT | `/api/categories/:id` | Izmeni kategoriju (admin) |
| DELETE | `/api/categories/:id` | Obriši kategoriju (admin) |

### Oglasi (Listings)

| Metoda | Ruta | Opis |
|---|---|---|
| GET | `/api/listings` | Lista oglasa (filteri, paginacija, pretraga) |
| POST | `/api/listings` | Kreiraj oglas (seller/admin) |
| GET | `/api/listings/:id` | Detalji oglasa |
| PUT | `/api/listings/:id` | Izmeni oglas (vlasnik/admin) |
| DELETE | `/api/listings/:id` | Obriši oglas (vlasnik/admin) |
| GET | `/api/listings/:id/reviews` | Recenzije za oglas |
| POST | `/api/listings/:id/reviews` | Ostavi recenziju (buyer) |

### Narudžbine (Orders)

| Metoda | Ruta | Opis |
|---|---|---|
| GET | `/api/orders` | Moje narudžbine / sve (admin) |
| POST | `/api/orders` | Kreiraj narudžbinu (buyer) |
| GET | `/api/orders/:id` | Detalji narudžbine |
| PUT | `/api/orders/:id` | Promeni status (admin/seller) |
| DELETE | `/api/orders/:id` | Obriši narudžbinu (admin) |
| GET | `/api/orders/seller` | Narudžbine za prodavca |

### Recenzije

| Metoda | Ruta | Opis |
|---|---|---|
| DELETE | `/api/reviews/:id` | Obriši recenziju (vlasnik/admin) |

### Korisnici

| Metoda | Ruta | Opis |
|---|---|---|
| GET | `/api/users` | Lista korisnika (admin) |
| GET | `/api/users/:id` | Profil korisnika (admin/self) |
| PUT | `/api/users/:id` | Izmeni profil (self: name, phone, password; admin: + role) |
| DELETE | `/api/users/:id` | Obriši korisnika (admin) |

## CI/CD Pipeline

Projekat koristi **GitHub Actions** za automatizaciju:

### CI (`ci.yml`) — na svaki push i pull request
1. **Lint** — ESLint provera koda
2. **Test** — Vitest unit testovi
3. **Docker Build** — verifikacija da se Docker image uspešno gradi

### Deploy (`deploy.yml`) — na push u `main`/`master`
1. **Build & Push** — Docker image se gradi i šalje na GitHub Container Registry (`ghcr.io`)
2. **Deploy** — Trigger Railway deployment webhook-a za automatski redeploy

### Potrebni GitHub Secrets

| Secret | Opis |
|---|---|
| `GITHUB_TOKEN` | Automatski dostupan (za GHCR) |
| `RAILWAY_DEPLOY_WEBHOOK` | Railway deploy webhook URL (opciono) |

## Cloud Deployment (Railway)

Aplikacija je postavljena na **Railway** platformu.

### Kako podesiti Railway

1. Kreirajte nalog na [railway.app](https://railway.app)
2. Kreirajte novi projekat → **New Project**
3. Dodajte **PostgreSQL** servis
4. Dodajte **Web Service** iz GitHub repozitorijuma
   - Root Directory: `c2c-e-commerce`
   - Builder: Dockerfile
5. Podesite environment varijable:
   - `DATABASE_URL` — kopirajte iz PostgreSQL servisa
   - `JWT_SECRET` — dugačak random string
   - `NODE_ENV` — `production`
6. (Opciono) Kopirajte **Deploy Webhook URL** u GitHub Secrets kao `RAILWAY_DEPLOY_WEBHOOK`

<!-- ### Produkcioni URL

🔗 **https://your-app.up.railway.app** -->

## Licenca

Ovaj projekat je razvijen u okviru predmeta **Internet tehnologije** na Fakultetu organizacionih nauka, Univerzitet u Beogradu.
