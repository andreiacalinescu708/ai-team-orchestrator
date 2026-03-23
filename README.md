# 🤖 AI Team Orchestrator v2

Sistem AI care generează aplicații web complete prin Telegram.

## Ce face?

1. Vorbești cu bot-ul pe Telegram și îi spui ce aplicație vrei
2. Bot-ul pune întrebări pentru a clarifica cerințele
3. Generează automat:
   - 🏗️ Arhitectura aplicației
   - ⚙️ Backend Express.js cu API REST
   - 🎨 Frontend React cu Vite
   - 🗄️ Schema PostgreSQL
   - 🐳 Docker setup pentru deployment
   - ⚙️ CI/CD pipeline GitHub Actions

## Comenzi Telegram

| Comandă | Descriere |
|---------|-----------|
| `/start` | Începe proiect nou |
| `/status` | Vezi status proiect curent |
| `/files` | Listează fișierele generate |
| `/reset` | Resetează sesiunea |
| `/help` | Ajutor |

## Instalare

```bash
# 1. Clonează repo-ul
git clone <repo-url>
cd ai-team-orchestrator

# 2. Instalează dependențele
npm install

# 3. Configurează variabilele de mediu în .env:
# - DATABASE_URL (PostgreSQL)
# - TELEGRAM_BOT_TOKEN
# - KIMI_API_KEY

# 4. Pornește aplicația
npm start
# sau pentru development:
npm run dev
```

## Structură Proiect Generat

```
projects/project-{id}/
├── backend/           # API Express.js
│   ├── src/
│   │   ├── server.js
│   │   ├── models/
│   │   ├── routes/
│   │   └── middleware/
│   └── package.json
├── frontend/          # React + Vite
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   ├── components/
│   │   └── services/
│   └── package.json
├── database/
│   └── schema.sql     # Schema PostgreSQL
├── docker/
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   └── nginx.conf
├── docker-compose.yml
└── .github/workflows/
    └── ci-cd.yml      # Pipeline CI/CD
```

## Deployment

### Local cu Docker:
```bash
cd projects/project-{id}
docker-compose up -d
```

### Producție:
Vezi `DEPLOYMENT.md` în fiecare proiect generat.

## Tehnologii Folosite

- **Backend**: Node.js, Express, PostgreSQL
- **Frontend**: React, Vite, React Query
- **AI**: Kimi AI API
- **Deployment**: Docker, Docker Compose
- **CI/CD**: GitHub Actions

## Exemple de Cereri

- "Vreau o aplicație de task management cu React și Node.js"
- "Creează-mi un blog cu autentificare și comentarii"
- "Am nevoie de un API pentru booking hoteluri"

## Licență

MIT
