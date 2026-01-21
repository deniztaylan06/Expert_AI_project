# 📖 Data Dictionary - Italian Financial Dataset

## Overview

This document provides detailed descriptions of all variables in the Italian Financial Dataset. The dataset contains financial and operational data from Italian companies for machine learning challenges.

---

## Table of Contents
1. [Identifiers and Temporal Variables](#identifiers-and-temporal-variables)
2. [Company Characteristics](#company-characteristics)
3. [Balance Sheet Variables](#balance-sheet-variables)
4. [Income Statement Variables](#income-statement-variables)
5. [Financial Ratios (Pre-calculated)](#financial-ratios-pre-calculated)
6. [Target Variables](#target-variables)
7. [Data Quality Notes](#data-quality-notes)

---

## Identifiers and Temporal Variables

| Variable | Type | Description | Example Values | Notes |
|----------|------|-------------|----------------|-------|
| `company_id` | String | Anonymized company identifier | `COMP_00001`, `COMP_00002` | Unique identifier, use for grouping temporal data |
| `fiscal_year` | Integer | Year of the financial statement | `2018`, `2019`, `2020` | Range: 2018-2023 |

---

## Company Characteristics

| Variable | Type | Description | Possible Values | Notes |
|----------|------|-------------|-----------------|-------|
| `ateco_sector` | String | 2-digit ATECO sector code | `45` (Construction), `47` (Retail), `62` (IT) | Italian economic classification, similar to NACE/ISIC |
| `province` | String | Province code (2 letters) | `RM` (Rome), `MI` (Milan), `NA` (Naples) | 107 Italian provinces |
| `region` | String | Region name | `Lazio`, `Lombardia`, `Campania` | 20 Italian regions |
| `legal_form` | String | Legal structure of company | `SRL`, `SPA`, `SAPA`, `SAS`, `SNC` | SRL = Limited Liability, SPA = Joint Stock |
| `years_in_business` | Integer | Company age in years | `1`, `5`, `20`, `50` | Calculated as (fiscal_year - founding_year) |

### ATECO Sector Codes (Main Categories)
- `01-03`: Agriculture, Forestry, Fishing
- `05-09`: Mining and Quarrying
- `10-33`: Manufacturing
- `35`: Electricity, Gas, Steam
- `36-39`: Water Supply, Sewerage, Waste
- `41-43`: Construction
- `45-47`: Wholesale and Retail Trade
- `49-53`: Transportation and Storage
- `55-56`: Accommodation and Food Service
- `58-63`: Information and Communication
- `64-66`: Financial and Insurance Activities
- `68`: Real Estate Activities
- `69-75`: Professional, Scientific, Technical Activities
- `77-82`: Administrative and Support Services
- `84`: Public Administration
- `85`: Education
- `86-88`: Human Health and Social Work
- `90-93`: Arts, Entertainment, Recreation
- `94-96`: Other Service Activities

---

## Balance Sheet Variables

All monetary values are in **Euros (€)**.

| Variable | Type | Description | Formula/Notes | Typical Range |
|----------|------|-------------|---------------|---------------|
| `total_fixed_assets` | Float | Fixed assets (Property, Plant, Equipment, Intangibles) | Long-term assets | €0 - €100M+ |
| `current_assets` | Float | Current assets (Cash, Inventory, Receivables) | Assets convertible to cash within 1 year | €0 - €50M+ |
| `total_assets` | Float | Total assets | `total_fixed_assets + current_assets` | €0 - €150M+ |
| `shareholders_equity` | Float | Net worth / Equity | Assets - Liabilities | Can be negative (distressed companies) |
| `total_debt` | Float | Total liabilities | `short_term_debt + long_term_debt` | €0 - €100M+ |
| `short_term_debt` | Float | Current liabilities (due within 1 year) | Short-term loans, payables | €0 - €50M+ |
| `long_term_debt` | Float | Non-current liabilities (due after 1 year) | Long-term loans, bonds | €0 - €50M+ |

**Key Accounting Identity**: `total_assets = shareholders_equity + total_debt`

---

## Income Statement Variables

All monetary values are in **Euros (€)** and represent **annual** figures.

| Variable | Type | Description | Formula/Notes | Typical Range |
|----------|------|-------------|---------------|---------------|
| `production_value` | Float | Total revenue / Sales | Top line revenue | €0 - €200M+ |
| `production_costs` | Float | Operating costs | COGS + Operating expenses | €0 - €200M+ |
| `operating_income` | Float | EBIT (Earnings Before Interest and Taxes) | `production_value - production_costs` | Can be negative |
| `financial_income` | Float | Interest and financial income | From investments, interest received | Typically small |
| `financial_expenses` | Float | Interest and financial expenses | Loan interest, financial costs | €0 - €5M+ |
| `net_profit_loss` | Float | Net income / Bottom line | After all expenses and taxes | Can be negative |

---

## Financial Ratios (Pre-calculated)

These ratios are calculated from the raw financial data. **Note**: Some may be missing or infinite if denominators are zero or negative.

### Profitability Ratios

| Variable | Formula | Description | Interpretation | Typical Range |
|----------|---------|-------------|----------------|---------------|
| `roe` | `net_profit_loss / shareholders_equity` | Return on Equity | Profitability relative to equity invested | -100% to +100% (negative if loss or negative equity) |
| `roi` | `operating_income / total_assets` | Return on Investment (or ROA) | Operating efficiency | -50% to +50% |
| `profit_margin` | `net_profit_loss / production_value` | Net Profit Margin | Profit per euro of revenue | -50% to +30% |

### Leverage Ratios

| Variable | Formula | Description | Interpretation | Typical Range |
|----------|---------|-------------|----------------|---------------|
| `leverage` | `total_debt / shareholders_equity` | Debt-to-Equity ratio | Financial leverage | 0 to 10+ (can be negative if equity is negative) |
| `debt_to_assets` | `total_debt / total_assets` | Debt ratio | Proportion of assets financed by debt | 0 to 1 (can be >1 if insolvent) |

### Liquidity Ratios

| Variable | Formula | Description | Interpretation | Typical Range |
|----------|---------|-------------|----------------|---------------|
| `current_ratio` | `current_assets / short_term_debt` | Current ratio | Ability to pay short-term obligations | 0.5 to 3.0 (>1 is healthy) |
| `quick_ratio` | `(current_assets - inventory) / short_term_debt` | Acid-test ratio | Liquidity excluding inventory | 0.3 to 2.0 (>1 is healthy) |

**Missing Values**: Ratios may be `NaN` or `inf` if:
- Denominator is zero (e.g., `leverage` when equity = 0)
- Denominator is negative (e.g., `roe` when equity < 0)
- Numerator and denominator are both zero

---

## Target Variables

### Challenge 1: `bankruptcy_next_year`
- **Type**: Binary (Integer)
- **Values**:
  - `0` = Company is healthy in the next fiscal year
  - `1` = Company goes bankrupt within 12 months
- **Distribution**: Highly imbalanced (~2-5% bankruptcy rate)
- **Definition**: A company is considered bankrupt if it files for bankruptcy proceedings, is dissolved, or ceases operations

### Challenge 2: `financial_health_class`
- **Type**: Categorical (String)
- **Values**: `A`, `B`, `C`, `D`
  - `A` = Excellent financial health (low risk)
  - `B` = Good financial health (moderate-low risk)
  - `C` = Fair financial health (moderate-high risk)
  - `D` = Poor financial health (high risk / distressed)
- **Distribution**: Imbalanced (A: ~30%, B: ~40%, C: ~20%, D: ~10%)
- **Definition**: Determined by a composite score of profitability, liquidity, and solvency metrics

**Classification Criteria** (approximate):
- **Class A**: Positive profit, ROE > 10%, current_ratio > 1.5, debt_to_assets < 0.5
- **Class B**: Positive profit, ROE > 0%, current_ratio > 1.0, debt_to_assets < 0.7
- **Class C**: Profit close to zero or small loss, current_ratio > 0.7, debt_to_assets < 0.85
- **Class D**: Significant losses, negative equity, or current_ratio < 0.7

### Challenge 3: `revenue_change`
- **Type**: Continuous (Float)
- **Units**: Percentage (%)
- **Formula**: `((production_value_t - production_value_t-1) / production_value_t-1) * 100`
- **Range**: Typically -50% to +100% (extreme outliers possible due to mergers/acquisitions)
- **Distribution**: Approximately normal with mean around 0-5% (reflecting economic growth)

**Special Values**:
- Missing if company has no previous year data (first year in dataset)
- Very large positive values (>100%) may indicate mergers or accounting changes
- Very large negative values (<-80%) may indicate spin-offs or partial closures

---

## Data Quality Notes

### Missing Values

**Expected Missing Values**:
- `years_in_business`: May be missing for very old companies (founding year unknown)
- Financial ratios: May be `NaN` or `inf` due to mathematical constraints (see above)
- `revenue_change`: Missing for first year of each company

**Unexpected Missing Values** (require investigation):
- Balance sheet items: Should generally be complete; missing may indicate incomplete filings
- Income statement items: Rare; may indicate startups or holding companies with no operations

### Outliers

**Legitimate Outliers**:
- Very large companies: Total assets > €100M
- Negative equity: Distressed companies (not errors)
- Extreme revenue changes: Mergers, acquisitions, restructurings

**Potential Errors** (should be investigated):
- Assets or liabilities exactly zero for multiple years
- Revenue > €1B for small legal forms (SRL)
- Ratios beyond reasonable bounds (e.g., leverage > 50)

### Temporal Considerations

1. **Data Leakage Prevention**:
   - Always split data by `fiscal_year`, not randomly
   - Use only past data to predict future outcomes
   - Be careful with year-over-year features

2. **Survivorship Bias**:
   - Bankrupt companies may drop out of the dataset
   - This is realistic (data reflects what would be available in practice)

3. **Macroeconomic Factors**:
   - 2020-2021: COVID-19 pandemic impact
   - Companies may have received government support
   - Consider including year fixed effects

### Data Preparation Recommendations

1. **Handle missing values thoughtfully**:
   - Understand why values are missing
   - Use domain-appropriate imputation (e.g., median by sector)
   - Consider creating "missing" indicator features

2. **Cap extreme outliers**:
   - Winsorize ratios at 1st and 99th percentiles
   - Log-transform skewed variables (assets, revenue)

3. **Validate data integrity**:
   - Check accounting identities (assets = equity + debt)
   - Verify ratio calculations
   - Identify impossible values (negative revenue, etc.)

4. **Engineer temporal features**:
   - Year-over-year changes (growth rates)
   - Trends (improving vs. deteriorating)
   - Volatility (standard deviation over time)

---

## Example Data Exploration Queries

```python
import pandas as pd

# Load data
df = pd.read_csv('data/processed/train_data.csv')

# Check missing values
df.isnull().sum()

# Summary statistics
df.describe()

# Check class distribution (Challenge 1)
df['bankruptcy_next_year'].value_counts(normalize=True)

# Check sector distribution
df['ateco_sector'].value_counts()

# Identify outliers
df[df['total_assets'] > df['total_assets'].quantile(0.99)]

# Check temporal distribution
df.groupby('fiscal_year').size()
```

---

## Contact

For questions about the data dictionary or data quality issues, please contact the course instructor or post in the discussion forum.

**Last Updated**: 2024-11
