from __future__ import annotations

import os
import re

os.environ.setdefault("VOYAGER_DB_DSN", "postgresql+asyncpg://voyager:voyager@localhost:5432/voyager")
os.environ.setdefault("VOYAGER_REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("VOYAGER_KEYCLOAK_ISSUER", "http://localhost:8080/realms/travel")
os.environ.setdefault("VOYAGER_KEYCLOAK_AUDIENCE", "voyager-api")
os.environ.setdefault(
    "VOYAGER_KEYCLOAK_JWKS_URL",
    "http://localhost:8080/realms/travel/protocol/openid-connect/certs",
)
os.environ.setdefault("VOYAGER_KEYCLOAK_CLIENT_ID", "voyager-api")

from app.services import export_pipeline


def _sample_payload() -> dict:
    return {
        "trip": {
            "id": "trip-1",
            "title": "Lisbon tasting weekend",
            "destination_text": "Lisbon",
            "start_date": "2026-12-10",
            "end_date": "2026-12-12",
            "budget_amount": "1800.00",
            "budget_currency": "EUR",
            "trip_type": "city",
            "route_travel_mode": "WALK",
            "version": 4,
            "last_generated_at": None,
        },
        "days": [
            {
                "id": "day-1",
                "day_index": 0,
                "date": "2026-12-10",
                "notes": "Keep the morning flexible.",
                "activities": [
                    {
                        "id": "activity-1",
                        "trip_id": "trip-1",
                        "trip_day_id": "day-1",
                        "order_index": 0,
                        "title": "Breakfast at Time Out Market",
                        "description": "Start the morning with a tasting stop at the market.",
                        "start_time": "08:30",
                        "start_datetime": "2026-12-10T08:30:00+00:00",
                        "duration_min": 90,
                        "source": "manual",
                        "is_favorite": False,
                        "visited_at": None,
                        "notes": "Try the local pastries before the crowds build.",
                        "place_id": "place-1",
                        "category": "eat",
                        "category_details": {},
                        "estimated_cost_amount": "18.00",
                        "estimated_cost_currency": "EUR",
                        "cost_label": "18.00 EUR",
                        "date": "2026-12-10",
                        "day_index": 0,
                        "day_label": "Day 1",
                        "location": {
                            "id": "place-1",
                            "name": "Time Out Market",
                            "category": "food_hall",
                            "address_text": "Avenida 24 de Julho 49, Lisbon",
                            "lat": 38.7071,
                            "lon": -9.1453,
                            "source": "phase5",
                            "external_id": None,
                        },
                        "location_text": "Time Out Market, Avenida 24 de Julho 49, Lisbon",
                        "route_points": [],
                        "hotel_details": None,
                    }
                ],
            }
        ],
        "inbox_activities": [
            {
                "id": "activity-2",
                "trip_id": "trip-1",
                "trip_day_id": None,
                "order_index": 0,
                "title": "Book fado tickets",
                "description": "Keep this in the inbox until the evening is locked.",
                "start_time": None,
                "start_datetime": None,
                "duration_min": 30,
                "source": "manual",
                "is_favorite": False,
                "visited_at": None,
                "notes": None,
                "place_id": None,
                "category": "activity",
                "category_details": {},
                "estimated_cost_amount": None,
                "estimated_cost_currency": None,
                "cost_label": None,
                "date": None,
                "day_index": None,
                "day_label": "Inbox",
                "location": None,
                "location_text": None,
                "route_points": [],
                "hotel_details": None,
            }
        ],
        "summary": {
            "day_count": 1,
            "scheduled_activity_count": 1,
            "inbox_activity_count": 1,
        },
    }


def _extract_pdf_text(pdf_bytes: bytes) -> str:
    matches = re.findall(br"\((.*?)\)\sTj", pdf_bytes)
    return "\n".join(
        chunk.decode("utf-8").replace("\\(", "(").replace("\\)", ")").replace("\\\\", "\\")
        for chunk in matches
    )


def test_serialize_json_is_pretty_and_includes_location_fields():
    payload = _sample_payload()

    rendered = export_pipeline._serialize_json(payload).decode("utf-8")

    assert '\n  "days": [' in rendered
    assert '"location": {' in rendered
    assert '"location_text": "Time Out Market, Avenida 24 de Julho 49, Lisbon"' in rendered
    assert '"inbox_activities": [' in rendered


def test_serialize_ics_includes_location_geo_and_budget():
    payload = _sample_payload()

    rendered = export_pipeline._serialize_ics(payload).decode("utf-8")

    assert "LOCATION:Time Out Market" in rendered
    assert "GEO:38.707100;-9.145300" in rendered
    assert "Budget: 18.00 EUR" in rendered
    assert "Trip day: 1 (2026-12-10)" in rendered


def test_serialize_pdf_contains_location_notes_and_inbox_section():
    payload = _sample_payload()

    rendered = _extract_pdf_text(export_pipeline._serialize_pdf(payload))

    assert "Breakfast at Time Out Market" in rendered
    assert "Location: Time Out Market, Avenida 24 de Julho 49, Lisbon" in rendered
    assert "Notes: Try the local pastries before the crowds build." in rendered
    assert "Inbox activities" in rendered
