from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import get_settings
from app.database import close_mongo_connection, connect_to_mongo
from app.routers import (
    accounts,
    auth,
    categories,
    email as email_router,
    exchange,
    internal,
    invitations,
    settings as settings_router,
    stats,
    subscriptions,
    transactions,
)


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

app.include_router(accounts.router)
app.include_router(subscriptions.router)
app.include_router(invitations.router)
app.include_router(internal.router)
app.include_router(email_router.router)
app.include_router(auth.router)
app.include_router(categories.router)
app.include_router(transactions.router)
app.include_router(stats.router)
app.include_router(settings_router.router)
app.include_router(exchange.router)


@app.get("/", tags=["health"])
async def health_check() -> dict:
    return {"status": "ok", "service": "PairPocket API"}
