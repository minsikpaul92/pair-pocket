from typing import Literal

from pydantic import BaseModel, Field


class CustomCategoryMap(BaseModel):
    """User-added categories: { category_name: [sub_category, ...] }."""

    expense: dict[str, list[str]] = Field(default_factory=dict)
    income: dict[str, list[str]] = Field(default_factory=dict)


class DashboardLayout(BaseModel):
    """Dashboard card order and which cards are hidden (card ids)."""

    order: list[str] = Field(default_factory=list)
    hidden: list[str] = Field(default_factory=list)
    # Width override per card id; cards not listed keep their default width.
    sizes: dict[str, Literal["half", "full"]] = Field(default_factory=dict)


CanadaProvince = Literal[
    "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"
]
DEFAULT_SALES_TAX_PROVINCE = "ON"


class UserSettingsBase(BaseModel):
    merchants: list[str] = Field(default_factory=list)
    institutions: list[str] = Field(default_factory=list)
    custom_categories: CustomCategoryMap = Field(default_factory=CustomCategoryMap)
    category_colors: dict[str, str] = Field(default_factory=dict)
    # Hidden from the dashboard expense-ratio chart: "category" or "category › sub".
    expense_ratio_hidden_categories: list[str] = Field(default_factory=list)
    gemini_api_key: str | None = None
    share_gemini_api_key: bool = False
    preferred_locale: str | None = None
    preferred_locales: list[str] = Field(default_factory=list)
    ledger_start_date: str | None = None
    shared_ledger_start_date: str | None = None
    onboarding_personal_completed: bool = False
    onboarding_personal_step: int = 0
    # { "personal" | "shared": { "CAD" | "KRW": monthly budget } }
    budgets: dict[str, dict[str, float]] = Field(default_factory=dict)
    # Legacy single layout (read-only fallback) and the per-country layouts.
    dashboard_layout: DashboardLayout = Field(default_factory=DashboardLayout)
    dashboard_layouts: dict[str, DashboardLayout] = Field(default_factory=dict)
    # Expense categories left out of dashboard spending; None = default (transfers).
    spending_excluded_categories: list[str] | None = None
    # Province whose sales tax rate is used to estimate tax on CAD expenses.
    sales_tax_province: CanadaProvince = DEFAULT_SALES_TAX_PROVINCE


class UserSettingsInDB(UserSettingsBase):
    owner_id: str


class UserSettingsOut(UserSettingsBase):
    gemini_api_key: str | None = Field(default=None, exclude=True)
    has_gemini_key: bool = False
    has_effective_gemini_key: bool = False
    partner_has_gemini_key: bool = False
    partner_using_my_key: bool = False
    using_partner_key: bool = False
    ledger_start_date_locked: bool = False


class ShareGeminiKeyBody(BaseModel):
    share: bool


class LedgerStartDateBody(BaseModel):
    ledger_start_date: str = Field(min_length=10, max_length=10)
    kind: str = Field(default="personal", pattern="^(personal|shared)$")


class ExpenseRatioHiddenCategoriesBody(BaseModel):
    categories: list[str] = Field(default_factory=list, max_length=100)


class SalesTaxProvinceBody(BaseModel):
    province: CanadaProvince


class AddInstitutionBody(BaseModel):
    name: str


class SetCategoryColorBody(BaseModel):
    category: str
    color: str = Field(min_length=4, max_length=9)


class ActiveLocaleBody(BaseModel):
    """Switch the UI language without changing which languages are enabled."""

    preferred_locale: str = Field(min_length=2, max_length=12)


class PreferredLocalesBody(BaseModel):
    preferred_locales: list[str] = Field(default_factory=list)
    preferred_locale: str | None = None


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


class BudgetBody(BaseModel):
    kind: str = Field(default="personal", pattern="^(personal|shared)$")
    currency: str = Field(pattern="^(CAD|KRW)$")
    amount: float = Field(ge=0)


class DashboardLayoutBody(BaseModel):
    country: str = Field(pattern="^(CAD|KRW)$")
    order: list[str] = Field(default_factory=list, max_length=30)
    hidden: list[str] = Field(default_factory=list, max_length=30)
    sizes: dict[str, Literal["half", "full"]] = Field(default_factory=dict, max_length=30)


class SpendingExclusionsBody(BaseModel):
    categories: list[str] = Field(default_factory=list, max_length=100)
