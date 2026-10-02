from app.features import derive_columns


def test_jump_columns_from_previous_target():
    assert derive_columns(target_bar=4, prev_bar=1) == {"jump": 3, "abs_jump": 3, "is_repeat": False}
    assert derive_columns(target_bar=1, prev_bar=4) == {"jump": -3, "abs_jump": 3, "is_repeat": False}
    assert derive_columns(target_bar=2, prev_bar=2) == {"jump": 0, "abs_jump": 0, "is_repeat": True}


def test_phrase_start_has_no_jump():
    assert derive_columns(target_bar=5, prev_bar=None) == {"jump": 0, "abs_jump": 0, "is_repeat": False}
