from pydantic import BaseModel, Field


class CustomCategoryMap(BaseModel):
    """User-added categories: { category_name: [sub_category, ...] }."""

    expense: dict[str, list[str]] = Field(default_factory=dict)
    income: dict[str, list[str]] = Field(default_factory=dict)


class UserSettingsBase(BaseModel):
    merchants: list[str] = Field(default_factory=list)
    institutions: list[str] = Field(default_factory=list)
    custom_categories: CustomCategoryMap = Field(default_factory=CustomCategoryMap)
    category_colors: dict[str, str] = Field(default_factory=dict)
    default_expense_account_id: str | None = None
    default_income_account_id: str | None = None


class UserSettingsInDB(UserSettingsBase):
    owner_id: str


class UserSettingsOut(UserSettingsBase):
    pass


class AddInstitutionBody(BaseModel):
    name: str


class SetCategoryColorBody(BaseModel):
    category: str
    color: str = Field(min_length=4, max_length=9)
