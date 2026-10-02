"""Attempt rows -> TabPFN feature frame (spec 7.8, 7.9)."""


def derive_columns(target_bar: int, prev_bar: int | None) -> dict:
    """The jump columns, computed server-side so every row is consistent."""
    if prev_bar is None:
        return {"jump": 0, "abs_jump": 0, "is_repeat": False}
    return {"jump": target_bar - prev_bar, "abs_jump": abs(target_bar - prev_bar), "is_repeat": target_bar == prev_bar}
