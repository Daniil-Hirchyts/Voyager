from app.services.editorial_trip_templates import get_editorial_route_template


def test_editorial_templates_are_grounded_for_all_curated_routes():
    expected_day_counts = {
        "kyoto-lantern-week": 7,
        "marrakech-riad-edit": 6,
        "reykjavik-midnight-route": 7,
        "santorini-blue-hour": 6,
        "cape-town-peninsula-cut": 8,
        "buenos-aires-late-tables": 7,
    }

    for route_id, expected_days in expected_day_counts.items():
        template = get_editorial_route_template(route_id)
        assert template is not None
        assert len(template) == expected_days
        assert all(len(day) == 3 for day in template)
        assert all(item.place.google_place_id for day in template for item in day)
        assert all(item.place.address_text for day in template for item in day)
