from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables / .env file."""

    # --- Database ---
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "pairpocket"

    # --- CORS ---
    cors_origins: str = "http://localhost:3000"

    # --- App / JWT ---
    # Used to sign both the Starlette session (OAuth state) and the app JWT.
    secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    # --- Google OAuth ---
    google_client_id: str = ""
    google_client_secret: str = ""
    # Must exactly match an "Authorized redirect URI" in Google Cloud Console.
    oauth_redirect_uri: str = "http://localhost:8000/api/auth/callback"

    # Where the backend sends the user back to after a successful login.
    frontend_url: str = "http://localhost:3000"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
