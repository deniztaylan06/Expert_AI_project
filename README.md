# 🏦 Italian Financial Challenge

Welcome to the Italian Financial Challenge! This repository contains all the materials you need to complete your machine learning project on Italian corporate financial data.

---

## 📋 Start Here

**New to this challenge?** Follow these steps:

1. 📖 **[Read the Challenge Description](docs/challenge_description.md)** - Complete guide to all three challenges, evaluation criteria, and requirements
2. 📊 **[Review the Data Dictionary](docs/data_dictionary.md)** - Understand all variables in the dataset
3. 💻 **[Setup your environment](#-quick-setup)** (see below)
4. 🚀 **[Start coding](notebooks/starter_template.ipynb)** - Use the provided template or create your own

---

## 🎯 The Challenge

Choose **ONE** of three machine learning challenges:

1. **Bankruptcy Prediction** (Medium) - Predict if a company will go bankrupt within 12 months
2. **Financial Health Classification** (Medium-High) - Classify companies into 4 health categories (A/B/C/D)
3. **Revenue Forecasting** (High) - Predict next year's revenue change (%)

📖 **See [Challenge Description](docs/challenge_description.md) for full details**

---

## 🚀 Quick Setup

```bash
# 1. Clone this repository
git clone <your-repo-url>
cd italian-financial-challenge

# 2. Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Launch Jupyter
jupyter notebook

# 5. Open notebooks/starter_template.ipynb and start coding!
```

---

## 📊 Available Data

### Training Data
- **File**: `data/processed/train_data.csv`
- **Size**: 11,828 company-year observations (2018-2021)
- **Targets**: All 3 target variables included

### Test Data
- **File**: `data/processed/test_features.csv`
- **Size**: 5,811 company-year observations (2022-2023)
- **Targets**: NOT included (for final evaluation only)

**Variables**: 25+ features including company info, balance sheet, income statement, and financial ratios

📊 **See [Data Dictionary](docs/data_dictionary.md) for complete variable descriptions**

---

## 📁 Repository Structure

```
italian-financial-challenge/
├── README.md                          # This file
├── requirements.txt                   # Python dependencies
│
├── docs/
│   ├── challenge_description.md       # ⭐ Complete challenge guide
│   └── data_dictionary.md             # ⭐ Variable explanations
│
├── data/processed/
│   ├── train_data.csv                 # Training data
│   └── test_features.csv              # Test data (no targets)
│
├── notebooks/
│   └── starter_template.ipynb         # Jupyter template (optional)
│
├── src/                               # Your Python modules (optional)
├── configs/                           # Your configs (optional)
└── tests/                             # Your tests (optional)
```

---

## 📝 What You Need to Submit

1. **Jupyter Notebook** (.ipynb) - Your complete analysis
3. **Presentation Slides** (PDF/PPTX) - if you think it's necessary

📖 **See [Challenge Description](docs/challenge_description.md) for evaluation criteria and grading**

---

## 💡 Key Tips

⚠️ **Avoid Data Leakage:**
- Use temporal splits (train on earlier years, test on later years)
- Fit scalers/imputers on training data only
- Never use future information to predict the past

⚡ **Handle Class Imbalance** (Challenges 1 & 2):
- Use F1-score, not accuracy
- Try SMOTE, class weights, or threshold tuning

🧠 **Focus on Interpretation:**
- Feature importance analysis
- Error analysis (which cases are misclassified?)
- Business insights (translate to non-technical language)

📖 **See [Challenge Description](docs/challenge_description.md) for detailed tips and best practices**

---

## 🆘 Common Issues

**"Module not found"**
```bash
source venv/bin/activate  # Activate environment first
pip install -r requirements.txt
```

**"File not found"**
```bash
pwd  # Check you're in the right directory
ls data/processed/  # Should show: train_data.csv, test_features.csv
```

**"My model performance is too low/high"**
- Too low: Check for proper imbalance handling, feature engineering
- Too high: Check for data leakage (temporal split, scaling)

📖 **See [Challenge Description](docs/challenge_description.md) for more troubleshooting**

---

## 🎯 Performance Targets

| Challenge | Minimum | Good | Excellent |
|-----------|---------|------|-----------|
| **Bankruptcy** | F1 > 0.45 | F1 = 0.55-0.65 | F1 > 0.65 |
| **Health Class** | Weighted F1 > 0.60 | Weighted F1 = 0.65-0.75 | Weighted F1 > 0.75 |
| **Revenue** | MAPE < 20% | MAPE = 12-18% | MAPE < 12% |

📖 **See [Challenge Description](docs/challenge_description.md) for complete evaluation metrics**

---

## ⚠️ Important Rules

- **Cite Sources**: Always cite external code, tutorials, or resources used.
- **Educational Use**: This data is for educational purposes only. Do not use for real financial decisions.

---

## 📚 Documentation

All detailed information is in the [docs/](docs/) folder:

- **[Challenge Description](docs/challenge_description.md)** - Complete guide (objectives, evaluation, tips, timeline)
- **[Data Dictionary](docs/data_dictionary.md)** - All variable definitions and data quality notes

**Start with the Challenge Description! It contains everything you need to know.**

---

## 🚀 Ready to Start?

1. ✅ Read [Challenge Description](docs/challenge_description.md)
2. ✅ Review [Data Dictionary](docs/data_dictionary.md)
3. ✅ Run the setup commands above
4. ✅ Open `notebooks/starter_template.ipynb`
5. ✅ Start exploring the data!

**Good luck! Focus on learning and understanding, not just chasing high scores.** 🎓

---

**Academic Year**: 2024/2025
**Institution**: LUISS University

**Questions?** Read the documentation first, then ask for help.
