from pydantic import BaseModel, Field


class CustomCategoryMap(BaseModel):
    """User-added categories: { category_name: [sub_category, ...] }."""

    expense: dict[str, list[str]] = Field(default_factory=dict)
    income: dict[str, list[str]] = Field(default_factory=dict)


class UserSettingsBase(BaseModel):
    merchants: list[str] = Field(default_factory=list)
    institutions: list[str] = Field(default_factory=list)
    custom_categories: CustomCategoryMap = Field(default_factory=CustomCategoryMap)


class UserSettingsInDB(UserSettingsBase):
    owner_id: str


class UserSettingsOut(UserSettingsBase):
    pass


class AddInstitutionBody(BaseModel):
    name: str
