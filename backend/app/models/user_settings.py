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
    gemini_api_key: str | None = None
    preferred_locale: str | None = None
    preferred_locales: list[str] = Field(default_factory=list)
    ledger_start_date: str | None = None
    onboarding_personal_completed: bool = False
    onboarding_personal_step: int = 0


class UserSettingsInDB(UserSettingsBase):
    owner_id: str


class UserSettingsOut(UserSettingsBase):
    gemini_api_key: str | None = Field(default=None, exclude=True)
    has_gemini_key: bool = False


class AddInstitutionBody(BaseModel):
    name: str


class SetCategoryColorBody(BaseModel):
    category: str
    color: str = Field(min_length=4, max_length=9)


class OnboardingBasicsBody(BaseModel):
    """Step 0: languages (1-2) + ledger start date (+ optional API key)."""

    preferred_locales: list[str] = Field(min_length=1, max_length=2)
    ledger_start_date: str = Field(min_length=10, max_length=10)
    api_key: str | None = None
    # Backward-compatible single locale; ignored when preferred_locales is set.
    preferred_locale: str | None = None


class OnboardingStepBody(BaseModel):
    step: int = Field(ge=0, le=3)


class OnboardingCompleteBody(BaseModel):
    """Mark personal onboarding finished after Step 3 or skip-to-end."""

    completed: bool = True
