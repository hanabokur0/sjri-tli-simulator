import numpy as np
import pandas as pd

LOSS_TLI_AMPLIFIER = 0.8  # same as model.py

def shocks_grid(max_shock=0.03, step=0.0025):
    n = int(round(max_shock/step)) + 1
    return np.round(np.linspace(0.0, max_shock, n), 6)

def _clip01(x):
    return np.maximum(0.0, np.minimum(1.0, x))

def compute_loss_to_equity_tli(df: pd.DataFrame, shocks) -> pd.DataFrame:
    """Return rows: [name, region, rate_shock, loss_to_equity_tli]."""
    rec = []
    for _, row in df.iterrows():
        tli = float(row.get("tli", 0.0))
        for dy in shocks:
            raw_loss = row["duration_years"] * dy * row["jgb_holdings_jpy"]
            loss = raw_loss * (1.0 + LOSS_TLI_AMPLIFIER * tli)
            equity = row["equity_capital_jpy"]
            loss_to_eq = (loss / equity) if equity > 0 else np.inf
            rec.append({
                "name": row["name"],
                "region": row.get("region", "Unknown"),
                "rate_shock": dy,
                "loss_to_equity_tli": loss_to_eq,
            })
    return pd.DataFrame(rec)

def compute_rehi(inst_df: pd.DataFrame,
                 detail_df: pd.DataFrame) -> pd.DataFrame:
    """
    REHI = 100 * [0.30*(1-L) + 0.30*(1-F) + 0.20*(1-TLI) + 0.20*D]
    L: loss_to_equity_tli clipped [0,1]
    F: npl_ratio [0,1]
    TLI: tli [0,1]
    D: diversification_index [0,1]
    """
    cols = ["name","region","npl_ratio","tli","diversification_index","total_assets_jpy"]
    merged = detail_df.merge(inst_df[cols], on=["name","region"], how="left")
    L = _clip01(merged["loss_to_equity_tli"].to_numpy())
    F = _clip01(merged["npl_ratio"].to_numpy())
    T = _clip01(merged["tli"].to_numpy())
    D = _clip01(merged["diversification_index"].to_numpy())
    merged["REHI"] = 100.0*(0.30*(1.0-L) + 0.30*(1.0-F) + 0.20*(1.0-T) + 0.20*D)
    return merged

def aggregate_region_rehi(inst_rehi: pd.DataFrame) -> pd.DataFrame:
    """Weighted by total_assets_jpy."""
    def _wavg(g):
        w = g["total_assets_jpy"]
        return np.average(g["REHI"], weights=w)
    out = inst_rehi.groupby(["region","rate_shock"]).apply(
        lambda g: pd.Series({"REHI_region": _wavg(g)})
    ).reset_index()
    return out

