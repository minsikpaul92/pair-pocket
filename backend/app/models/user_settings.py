from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator

from app.models.account import AccountCountry


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

# Countries whose ledgers a user can turn on, in display order. Adding a
# country to AccountCountry makes it selectable here. The home country is
# always on.
COUNTRY_ORDER: tuple[str, ...] = tuple(country.value for country in AccountCountry)
HOME_COUNTRY = AccountCountry.CA.value
# UI languages that turned a country on before countries were stored.
LEGACY_LOCALE_COUNTRIES: dict[str, str] = {"ko": AccountCountry.KR.value}


# Tutorial modules, in display order. The client sends these ids back as-is.
TUTORIAL_MODULE_IDS: tuple[str, ...] = (
    "basics",
    "concepts",
    "subs",
    "stocks",
    "partner",
    "country",
)
TUTORIAL_MAX_WHATS_NEW = 100
TUTORIAL_MAX_ID_LENGTH = 64


class TutorialProgress(BaseModel):
    """Where a user is in the in-app tutorial. All fields have defaults so
    older settings documents work."""

    completed: list[str] = Field(default_factory=list)
    dismissed: bool = False
    offer_shown: bool = False
    # What's New entries whose "Try it" walkthrough was finished.
    whats_new_done: list[str] = Field(default_factory=list)


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
    # Countries whose ledgers are shown. Stored once the user (or onboarding)
    # picks them; older documents fall back to the language list.
    enabled_countries: list[AccountCountry] = Field(
        default_factory=lambda: [AccountCountry(HOME_COUNTRY)]
    )
    ledger_start_date: str | None = None
    shared_ledger_start_date: str | None = None
    onboarding_personal_completed: bool = False
    onboarding_personal_step: int = 0
    # { "personal" | "shared": { "CAD" | "KRW": monthly budget } }
    budgets: dict[str, dict[str, float]] = Field(default_factory=dict)
    # { "personal" | "shared": ["YYYY-MM", ...] } months that start without last
    # month's overspend deducted from the budget.
    budget_carry_skipped: dict[str, list[str]] = Field(default_factory=dict)
    # Legacy single layout (read-only fallback) and the per-country layouts.
    dashboard_layout: DashboardLayout = Field(default_factory=DashboardLayout)
    dashboard_layouts: dict[str, DashboardLayout] = Field(default_factory=dict)
    # Expense categories left out of dashboard spending; None = default (transfers).
    spending_excluded_categories: list[str] | None = None
    # Account ids whose spending is left out of the budget and dashboard spending;
    # None = default (savings accounts).
    spending_excluded_accounts: list[str] | None = None
    # Province whose sales tax rate is used to estimate tax on CAD expenses.
    sales_tax_province: CanadaProvince = DEFAULT_SALES_TAX_PROVINCE
    tutorial: TutorialProgress = Field(default_factory=TutorialProgress)


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


class TutorialProgressBody(BaseModel):
    """The whole tutorial object; saving the same body twice changes nothing."""

    completed: list[Annotated[str, Field(max_length=TUTORIAL_MAX_ID_LENGTH)]] = Field(
        default_factory=list, max_length=len(TUTORIAL_MODULE_IDS)
    )
    dismissed: bool = False
    offer_shown: bool = False
    whats_new_done: list[
        Annotated[str, Field(min_length=1, max_length=TUTORIAL_MAX_ID_LENGTH)]
    ] = Field(default_factory=list, max_length=TUTORIAL_MAX_WHATS_NEW)

    @field_validator("completed")
    @classmethod
    def _known_modules(cls, value: list[str]) -> list[str]:
        unknown = [m for m in value if m not in TUTORIAL_MODULE_IDS]
        if unknown:
            raise ValueError(f"unknown tutorial module: {', '.join(unknown)}")
        return list(dict.fromkeys(value))

    @field_validator("whats_new_done")
    @classmethod
    def _dedupe(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))


class ShareGeminiKeyBody(BaseModel):
    share: bool


class LedgerStartDateBody(BaseModel):
    ledger_start_date: str = Field(min_length=10, max_length=10)
    kind: str = Field(default="personal", pattern="^(personal|shared)$")


class ExpenseRatioHiddenCategoriesBody(BaseModel):
    categories: list[str] = Field(default_factory=list, max_length=100)


class SalesTaxProvinceBody(BaseModel):
    province: CanadaProvince


class EnabledCountriesBody(BaseModel):
    """Countries to show. The home country must be included; turning another
    off only hides its ledger, nothing is deleted."""

    countries: list[AccountCountry] = Field(min_length=1, max_length=len(AccountCountry))


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


class BudgetCarryBody(BaseModel):
    kind: str = Field(default="personal", pattern="^(personal|shared)$")
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    carry: bool


class DashboardLayoutBody(BaseModel):
    country: str = Field(pattern="^(CAD|KRW)$")
    order: list[str] = Field(default_factory=list, max_length=30)
    hidden: list[str] = Field(default_factory=list, max_length=30)
    sizes: dict[str, Literal["half", "full"]] = Field(default_factory=dict, max_length=30)


class SpendingExclusionsBody(BaseModel):
    # Whole categories and "category › sub_category" entries.
    categories: list[str] = Field(default_factory=list, max_length=400)


class SpendingAccountExclusionsBody(BaseModel):
    accounts: list[str] = Field(default_factory=list, max_length=200)
