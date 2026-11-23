from app.services.stats import _is_excluded


def test_excludes_whole_category_or_one_sub_category():
    excluded = {"자산 이동/카드", "식비 › 외식/배달"}
    assert _is_excluded(excluded, "식비", "외식/배달")
    assert not _is_excluded(excluded, "식비", "카페/간식")
    assert _is_excluded(excluded, "자산 이동/카드", "카드값")
    # The legacy transfer name still counts as the transfer category.
    assert _is_excluded(excluded, "자산 이동", "카드값")
