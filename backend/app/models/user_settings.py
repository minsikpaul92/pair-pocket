from pydantic import BaseModel, Field


class UserSettingsBase(BaseModel):
    """Per-user customization data (PRD.md §4 `user_settings`).

    Holds array lists used for custom categories and merchant auto-complete.
    """

    categories: list[str] = Field(default_factory=list)
    merchants: list[str] = Field(default_factory=list)


class UserSettingsInDB(UserSettingsBase):
    owner_id: str


class UserSettingsOut(UserSettingsBase):
    id: str
    owner_id: str
