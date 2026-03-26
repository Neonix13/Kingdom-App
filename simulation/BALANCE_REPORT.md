# Kingdom Battleground — Balance Simulation Report

**Date:** 2026-03-26
**Total games simulated:** 24,200 (4 configurations x 6,050 games each)
**Configurations tested:**

| Config | Budget | Initiative | Games |
|--------|--------|-----------|-------|
| A | 5,000 | Normal (d20+strategy) | 6,050 |
| B | 10,000 | Normal (d20+strategy) | 6,050 |
| C | 5,000 | Disabled (random+alternating) | 6,050 |
| D | 10,000 | Disabled (random+alternating) | 6,050 |

**Simulation features:** Vision/fog of war enabled, heuristic AI (army building, deployment, combat), all 12 unit types, all 11 generals, 50 games per matchup (11x11=121 matchups per config).

---

## 1. General Balance

### Overall Win Rates (all 4 configs averaged)

| # | General | Kingdom | Force | Strategy | HP | Avg Win% | Verdict |
|---|---------|---------|-------|----------|-----|----------|---------|
| 1 | **Gai Mou** | WEI | 18 | 12 | 130 | **56.1%** | Strong |
| 2 | **Mou Bu** | QIN | 18 | 12 | 130 | **56.0%** | Strong |
| 3 | **Ren Pa** | ZHAO/WEI | 17 | 16 | 120 | **52.0%** | Balanced |
| 4 | **Shi Ba Shou** | ZHAO | 17 | 15 | 130 | **50.4%** | Balanced |
| 5 | **Ou Ki** | QIN | 15 | 16 | 110 | **46.4%** | Slightly weak |
| 6 | **Kan Ki** | QIN | 14 | 16 | 100 | **42.4%** | Weak |
| 7 | **Ou Sen** | QIN | 13 | 17 | 110 | **39.8%** | Weak |
| 8 | **Kei Sha** | ZHAO | 13 | 16 | 100 | **36.5%** | Weak |
| 9 | **Go Kei** | WEI | 14 | 17 | 90 | **37.2%** | Weak |
| 10 | **Ri Boku** | ZHAO | 11 | 18 | 100 | **35.0%** | Weak |
| 11 | **Go Hou Mei** | WEI | 10 | 18 | 80 | **24.4%** | Very weak |

### Win Rate Breakdown by Config

| General | 5k Init | 10k Init | 5k NoInit | 10k NoInit |
|---------|---------|----------|-----------|------------|
| Gai Mou | 55.4% | 57.5% | 54.8% | 56.5% |
| Mou Bu | 54.4% | 56.5% | 56.6% | 56.3% |
| Ren Pa | 49.7% | 53.1% | 48.9% | 56.2% |
| Shi Ba Shou | 47.6% | 52.4% | 49.4% | 52.0% |
| Ou Ki | 41.9% | 50.1% | 42.6% | 51.1% |
| Kan Ki | 39.3% | 47.4% | 35.9% | 47.0% |
| Ou Sen | 34.3% | 44.5% | 34.3% | 45.9% |
| Kei Sha | 29.1% | 42.8% | 32.5% | 41.4% |
| Go Kei | 31.9% | 42.1% | 32.0% | 42.6% |
| Ri Boku | 29.2% | 40.5% | 29.3% | 41.1% |
| Go Hou Mei | 17.9% | 32.2% | 16.3% | 31.2% |

### Key Finding: Force >> Strategy

The clearest pattern in the data: **generals with high Force dominate, while high Strategy provides little advantage**.

- **Top 4** generals all have Force >= 17. Their combat stats (HP, armor, weapon damage) make them dangerous in direct combat and hard to kill.
- **Bottom 3** generals all have Strategy >= 17 but Force <= 14. High strategy means better initiative rolls, but this doesn't compensate for weak combat.
- **Go Hou Mei** is the extreme case: highest strategy (18) but lowest force (10), lowest HP (80), lowest armor (17). He consistently loses across all configs.

The initiative system (d20 + strategy) was tested by disabling it entirely. **Result: almost no difference** (< 3% shift for most generals). Going first provides a small advantage but doesn't overcome stat deficits.

### Key Finding: Budget Compresses Balance

At 10k budget, win rates converge toward 50% more than at 5k:
- **5k spread:** 16-57% (41 point range)
- **10k spread:** 31-58% (27 point range)

With larger armies, individual general combat matters less because the general is a smaller fraction of total army power. This suggests balance is more sensitive at lower budgets.

---

## 2. Unit Effectiveness

### Survival Rates (averaged across all configs)

| # | Unit | Category | Cost | Survival | Avg HP Lost | Verdict |
|---|------|----------|------|----------|-------------|---------|
| 1 | Archer d'Elite | Tireurs | 900 | **73.2%** | 27.4% | Best unit |
| 2 | Archer | Tireurs | 600 | **71.0%** | 32.7% | Best value |
| 3 | Char | Chars | 1600 | **59.0%** | 43.5% | Strong but expensive |
| 4 | Cavalier Lourd | Chevaux | 1200 | **55.9%** | 47.7% | Good |
| 5 | Phalange | Infanterie | 700 | **52.7%** | 53.2% | Solid tank |
| 6 | Pietaille | Infanterie | 400 | **42.1%** | 66.3% | Decent fodder |
| 7 | Soldats | Infanterie | 600 | **41.0%** | 64.2% | Average |
| 8 | Batisseurs | Chars | 1000 | **35.3%** | 71.8% | Weak for cost |
| 9 | Cavalier Leger | Chevaux | 900 | **33.1%** | 70.3% | Underperforming |
| 10 | Lancier | Infanterie | 700 | **27.9%** | 77.4% | Weak |
| 11 | Assassin | Infanterie | 800 | **26.7%** | 76.3% | Glass cannon |
| 12 | Espion | Infanterie | 600 | **20.8%** | 84.3% | Worst unit |

### Key Finding: Ranged Units Dominate

Archers and Elite Archers have by far the highest survival rates (70-73%) and lowest HP lost (27-33%). This is because:
1. **Range advantage** — they attack from 3-4 hexes away, often getting several free shots before melee units close in
2. **No defense test** — ranged attacks bypass the defense roll entirely
3. **AI priority** — they act first in turn order (Tireurs priority 0), meaning they attack before taking damage

**Archers are the best value unit in the game** at 600g with 71% survival.

### Key Finding: Several Units Underperform for Their Cost

| Unit | Cost | Issue |
|------|------|-------|
| **Espion** (600g) | Lowest survival (20.8%), loses 84% HP on average. Sabotage ability unused in simulation. Basically worse Pietaille. |
| **Lancier** (700g) | 27.9% survival despite anti-cavalry bonus. The bonus is situational and doesn't help vs infantry or ranged. |
| **Cavalier Leger** (900g) | 33% survival at 900g. Speed (6) should help flanking but low HP (150) and defense (7) make it fragile. |
| **Batisseurs** (1000g) | 35% survival. Build ability unused in simulation. As a combat unit, severely overpriced. |

### Key Finding: Assassin Is a Polarizing Unit

The Assassin has 26.7% survival but its stats tell an interesting story: highest power (22) and armor (18) among infantry, but only 100 HP. It's a glass cannon — devastating when it connects but dies quickly. At 800g it's expensive for how often it dies.

---

## 3. Matchup Analysis

### Most Lopsided Matchups (10k budget, with initiative)

| Matchup | P1 Win% | Note |
|---------|---------|------|
| Gai Mou vs Go Hou Mei | **91%** | Most lopsided |
| Mou Bu vs Go Hou Mei | **85%** | Force crushes strategy |
| Gai Mou vs Kei Sha | **78%** | |
| Ren Pa vs Ri Boku | **79%** | |
| Mou Bu vs Kei Sha | **83%** | |

### Most Balanced Matchups (10k budget)

| Matchup | P1 Win% |
|---------|---------|
| Ou Ki mirror | 51% |
| Shi Ba Shou mirror | 47% |
| Ou Ki vs Ou Sen | 50% |
| Kan Ki vs Ri Boku | 48% |

### Interesting Asymmetric Matchups

Some matchups where order matters significantly (P1 vs P2 differs by > 15%):
- **Shi Ba Shou vs Mou Bu**: 47% as P1, but Mou Bu vs Shi Ba Shou is only 54% — relatively even
- **Ren Pa vs Mou Bu**: 61% as P1, but Mou Bu vs Ren Pa is 56% — Ren Pa has a slight edge

---

## 4. Initiative System Analysis

Comparing initiative (d20 + strategy) vs disabled (random start, alternating):

| General | Strategy | With Initiative | Without | Delta |
|---------|----------|----------------|---------|-------|
| Go Hou Mei | 18 | 25.1% | 23.8% | -1.3 |
| Ri Boku | 18 | 34.9% | 35.2% | +0.3 |
| Ou Sen | 17 | 39.4% | 40.1% | +0.7 |
| Go Kei | 17 | 37.0% | 37.3% | +0.3 |
| Kan Ki | 16 | 43.4% | 41.5% | -1.9 |
| Ou Ki | 16 | 46.0% | 46.9% | +0.9 |
| Kei Sha | 16 | 36.0% | 37.0% | +1.0 |
| Ren Pa | 16 | 51.4% | 52.6% | +1.2 |
| Shi Ba Shou | 15 | 50.0% | 50.7% | +0.7 |
| Mou Bu | 12 | 55.5% | 56.5% | +1.0 |
| Gai Mou | 12 | 56.5% | 55.7% | -0.8 |

**Conclusion: Initiative has negligible impact on balance.** The differences are within noise (< 3%). High-strategy generals don't benefit meaningfully from going first. The strategy stat's value is primarily in vision range, not turn order.

---

## 5. Balance Recommendations

### Urgent Fixes

1. **Go Hou Mei needs a significant buff.** At 24% average win rate, he's unplayable. Options:
   - Increase HP from 80 to 100-110
   - Increase force from 10 to 13-14
   - Give him a unique passive that leverages his high strategy (e.g., extended vision for all units, strategic redeployment, trap placement)

2. **Ri Boku needs a moderate buff.** At 35% win rate with the highest strategy, the "master strategist" archetype isn't working. Options:
   - Increase force from 11 to 13
   - Give strategy-based generals a passive that scales with strategy (bonus to ranged units, army-wide buffs)

### Consider Adjusting

3. **Espion needs a rework.** Worst survival, worst HP retention. The sabotage ability has no value in standard combat. Options:
   - Reduce cost from 600 to 400
   - Increase HP or give stealth/evasion mechanic
   - Make sabotage more impactful

4. **Archer / Archer d'Elite may be too strong.** 70-83% survival rates are outliers. The "no defense test" on ranged attacks gives them free damage. Options:
   - Reduce range by 1 (archer: 2, elite: 3)
   - Allow a defense test at close range (1-2 hexes)
   - Reduce HP slightly

5. **Lancier's anti-cavalry bonus is too niche.** It only helps against 2 of 12 unit types. Consider broadening it (e.g., anti-cavalry AND anti-charge, or bonus on defensive terrain).

### Working As Intended

- **Gai Mou & Mou Bu** are strong but not broken (~56%). Their weakness is low strategy = short vision range, which the fog of war system correctly penalizes.
- **Ren Pa** is the best-balanced strong general (~52%) — high stats across the board but no extreme outlier.
- **Phalange** is a well-designed tank (53% survival, good defense, reasonable cost).
- **Char** is expensive but justified (59% survival, devastating power 30).

---

## 6. Methodology Notes

- **AI agent**: Heuristic-based (not random). Builds balanced armies, deploys tactically (infantry front, ranged middle, cavalry flanks, general rear), makes combat decisions based on target priority (generals > wounded > fleeing), uses stances contextually.
- **Vision**: Fog of war enabled. AI can only see enemies within shared unit vision range. When no enemies visible, units advance toward enemy territory.
- **Map**: Randomly generated each game (terrain, height, segments). Deployment zones vary.
- **Limitation**: The AI doesn't use unit-specific abilities (sabotage, build, ambush, trample). Units that rely on abilities (Espion, Batisseurs) score lower than they would with human players.
- **Limitation**: The AI uses a fixed army composition strategy. Human players may find optimal compositions that differ significantly.
