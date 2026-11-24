# OpsPulse — Local Development Setup

OpsPulse is an AI-powered business operations intelligence platform consisting of three application services:

1. **Frontend:** React.js + Vite
2. **Backend:** Node.js + Express.js
3. **ML Service:** Python + FastAPI

The application uses PostgreSQL hosted on Supabase for persistent storage. The backend and ML service connect to the same database using `DATABASE_URL`.

## Prerequisites

Install the following before running the project:

- Node.js (v20 or later)
- npm
- Python 3.10+
- Git
- Access to the configured Supabase project

## Project Structure

```text
opspulse/
├── frontend/       # React + Vite frontend
├── backend/        # Node.js + Express backend
├── ml-service/     # Python + FastAPI ML service
├── db/             # Database migrations and SQL files
└── README.md
```

## 1. Clone the Repository

```bash
git clone <repository-url>
cd opspulse
```

## 2. Configure Environment Variables

Copy each service's `.env.example` to its local `.env` for a new installation. Preserve existing files and keep local credentials and CA files out of Git.

- **Backend** uses the fresh project's TLS configuration, a restricted Express database login, and the Clerk publishable and secret keys. Set `CLERK_AUTHORIZED_PARTIES` to the exact frontend origins, including the deployed origin in production.
- **ML service** uses the fresh project's TLS configuration, a restricted ML database login, a separate checkpoint database login, and `LANGGRAPH_CHECKPOINTER=postgres` for durable checkpoints.
- **Frontend** uses `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_URL`. Use matching Clerk frontend and backend keys. Enable the sign-in and sign-up methods in Clerk before using the public routes.
- **Internal calls** use the same strong `ML_ANALYST_INTERNAL_TOKEN` in Express and FastAPI. Keep FastAPI private in production. The browser calls Express.

See the [fresh database rollout guide](docs/opspulse-fresh-rollout.md) for connection roles, checkpoints, provisioning, demo seed and integration checks.

## 3. Start the Backend Server

Open a terminal:

```bash
cd backend
npm install
npm start
```

Backend runs at:

```text
http://localhost:5001
```

## 4. Start the ML Service

Open a second terminal:

```bash
cd ml-service
```

Create a virtual environment if one does not already exist:

```bash
python -m venv venv
```

Activate it on Windows PowerShell:

```powershell
.\venv\Scripts\Activate.ps1
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Start FastAPI:

```bash
python -m uvicorn app:app --host 127.0.0.1 --port 5002 --reload
```

ML service runs at:

```text
http://127.0.0.1:5002
```

FastAPI interactive documentation:

```text
http://127.0.0.1:5002/docs
```

## 5. Start the Frontend

Open a third terminal:

```bash
cd frontend
npm install
npm run dev
```

Vite displays the local frontend URL in the terminal, typically:

```text
http://localhost:5173
```

## 6. Running All Services

Keep all three terminals running simultaneously.

| Service | Command | Local address |
|---|---|---|
| Backend | `npm start` | `http://localhost:5001` |
| ML Service | `python -m uvicorn app:app --host 127.0.0.1 --port 5002 --reload` | `http://127.0.0.1:5002` |
| Frontend | `npm run dev` | `http://localhost:5173` |

## 7. Database

OpsPulse uses one fresh Supabase PostgreSQL project for business tables, RAG and private LangGraph checkpoints. The [schema specification](docs/opspulse-fresh-schema-spec.md) and [consolidated SQL](docs/opspulse-fresh-schema.proposed.sql) describe the starting schema. Use the guarded bootstrap command in the rollout guide. Legacy migrations under `db/migrations/` are retained as history.

## 8. Troubleshooting

| Problem | Suggested check |
|---|---|
| Backend cannot connect to database | Verify the fresh database role URL and trusted CA path |
| ML service fails to start | Activate the virtual environment and install requirements |
| Frontend API requests fail | Verify backend is running and frontend API URL is configured correctly |
| Clerk authentication fails | Check matching Clerk keys, authorized origins, and tenant provisioning |
| Port already in use | Stop the process using the port or configure an available port |
| Python module not found | Activate the correct virtual environment and reinstall dependencies |

## 9. Development Notes

- Run all three services in separate terminals.
- Use the fresh Supabase project for persistence.
- The backend handles API requests, authentication, and application logic.
- The ML service handles forecasting, inventory intelligence, and AI workflows.
- The frontend communicates with the backend through REST APIs.
- LangGraph-based agent workflows run within the existing ML service; they do not require a separate fourth application server.

---

**OpsPulse — AI-Powered Business Operations Intelligence Platform**