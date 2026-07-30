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

    # --- Email (Resend API — recommended) ---
    # Sign up at https://resend.com → API Keys → paste below.
    # Users receive mail at their Google login address; no per-user setup.
    resend_api_key: str = ""
    email_from: str = "PairPocket <onboarding@resend.dev>"

    # --- Legacy SMTP (optional fallback) ---
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: bool = True

    # --- Cron (subscription reminder jobs via GitHub Actions / external scheduler) ---
    cron_secret: str = ""

    # --- At-rest encryption for user secrets (e.g. Gemini API key) ---
    # Prefer a dedicated Fernet key in production:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # If empty, a key is derived from SECRET_KEY (fine for local/dev).
    settings_encryption_key: str = ""

    # --- Local / preview login without Google OAuth ---
    # When true AND Google OAuth is not configured, /api/auth/login issues a
    # demo JWT and redirects to the frontend. Never enable in production.
    allow_dev_login: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


def get_settings() -> Settings:
    return Settings()
