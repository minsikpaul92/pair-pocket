from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import get_settings
from app.database import close_mongo_connection, connect_to_mongo
from app.routers import auth, transactions


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_to_mongo()
    yield
    await close_mongo_connection()


settings = get_settings()

app = FastAPI(title="PairPocket API", version="0.1.0", lifespan=lifespan)

# Authlib stores the OAuth state/nonce in the session during the login round-trip.
app.add_middleware(SessionMiddleware, secret_key=settings.secret_key)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(transactions.router)


@app.get("/", tags=["health"])
async def health_check() -> dict:
    return {"status": "ok", "service": "PairPocket API"}
