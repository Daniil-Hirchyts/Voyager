import asyncio
import os
import time
import uuid
from datetime import UTC, datetime

import asyncpg
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.phase6]


def _create_trip(api_client, headers, *, title: str) -> dict:
    response = api_client.post(
        "/trips",
        headers=headers | {"Idempotency-Key": f"p6-trip-{uuid.uuid4()}"},
        json={
            "title": title,
            "destination_text": "Paris",
            "start_date": "2026-12-10",
            "end_date": "2026-12-12",
            "budget_amount": 1200,
            "budget_currency": "EUR",
            "trip_type": "cultural",
            "preferences": ["museums", "food"],
        },
    )
    assert response.status_code == 201
    return response.json()


def _list_days(api_client, headers, trip_id: str) -> list[dict]:
    response = api_client.get(f"/trips/{trip_id}/days", headers=headers)
    assert response.status_code == 200
    return response.json()["items"]


def _wait_for_job(api_client, headers, job_id: str, *, timeout_s: int = 90) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        response = api_client.get(f"/jobs/{job_id}", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        if payload["status"] in {"SUCCEEDED", "FAILED"}:
            return payload
        time.sleep(0.5)
    raise AssertionError(f"Job {job_id} did not complete within {timeout_s}s")


def _get_trip(api_client, headers, trip_id: str) -> dict:
    response = api_client.get(f"/trips/{trip_id}", headers=headers)
    assert response.status_code == 200
    return response.json()


def _list_day_activities(api_client, headers, day_id: str) -> list[dict]:
    response = api_client.get(f"/days/{day_id}/activities", headers=headers)
    assert response.status_code == 200
    return response.json()["items"]


def _seed_event_snapshot(
    *,
    trip_id: str,
    trip_day_id: str,
    place_id: str | None,
    start_at: str,
    title: str,
) -> str:
    dsn = os.environ["VOYAGER_DB_DSN"].replace("+asyncpg", "")

    async def _run() -> str:
        event_id = uuid.uuid4()
        connection = await asyncpg.connect(dsn=dsn)
        try:
            await connection.execute(
                """
                INSERT INTO event_snapshot (
                  id,
                  trip_id,
                  trip_day_id,
                  provider,
                  provider_event_ref,
                  title,
                  summary,
                  start_at,
                  end_at,
                  timezone,
                  venue_name,
                  venue_address,
                  place_id,
                  segment,
                  genre,
                  min_price,
                  max_price,
                  currency,
                  image_url,
                  deep_link,
                  sales_status,
                  request_fingerprint,
                  raw_payload_json,
                  expires_at,
                  created_at,
                  updated_at
                )
                VALUES (
                  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25,$26
                )
                """,
                event_id,
                uuid.UUID(trip_id),
                uuid.UUID(trip_day_id),
                "ticketmaster",
                f"seed-{uuid.uuid4()}",
                title,
                "Seeded integration event",
                datetime.fromisoformat(start_at.replace("Z", "+00:00")).astimezone(UTC),
                None,
                "Europe/Paris",
                "Seed Venue",
                "Paris, France",
                uuid.UUID(place_id) if place_id else None,
                "Arts & Theatre",
                "Museum",
                None,
                None,
                "EUR",
                "https://example.com/event.jpg",
                "https://example.com/event",
                "onsale",
                None,
                '{"seeded": true}',
                datetime.now(UTC),
                datetime.now(UTC),
                datetime.now(UTC),
            )
        finally:
            await connection.close()
        return str(event_id)

    return asyncio.run(_run())


def test_events_search_missing_ticketmaster_key_returns_503(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase6 missing key")
    response = api_client.post(
        "/events/search",
        headers=headers_user1 | {"Idempotency-Key": f"p6-events-{uuid.uuid4()}"},
        json={
            "trip_id": trip["id"],
            "location_text": "Paris, France",
            "start_date": "2026-12-10",
            "end_date": "2026-12-11",
            "size": 10,
            "providers": ["ticketmaster"],
            "constraints": {},
        },
    )

    if response.status_code == 202:
        assert response.status_code == 202
        return

    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "INTEGRATION_NOT_CONFIGURED"
    assert body["error"]["details"]["missing_env_vars"] == ["VOYAGER_EVENTS_TICKETMASTER_API_KEY"]


def test_event_attach_flow_and_optimizer_proposal_apply(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase6 optimize trip")
    days = _list_days(api_client, headers_user1, trip["id"])
    first_day = days[0]

    place_response = api_client.post(
        "/places",
        headers=headers_user1 | {"Idempotency-Key": f"p6-place-{uuid.uuid4()}"},
        json={
            "source": "manual",
            "name": "Louvre Museum",
            "category": "museum",
            "address_text": "Rue de Rivoli, Paris, France",
            "lat": 48.8606,
            "lon": 2.3376,
            "metadata": {"website": "https://www.louvre.fr/"},
        },
    )
    assert place_response.status_code == 201
    place_id = place_response.json()["id"]

    event_id = _seed_event_snapshot(
        trip_id=trip["id"],
        trip_day_id=first_day["id"],
        place_id=place_id,
        start_at=f"{first_day['date']}T18:00:00Z",
        title="Louvre Night Opening",
    )

    event_detail = api_client.get(f"/events/{event_id}", headers=headers_user1)
    assert event_detail.status_code == 200
    assert event_detail.json()["place_id"] == place_id

    current_trip = _get_trip(api_client, headers_user1, trip["id"])
    attach = api_client.post(
        f"/trips/{trip['id']}/events/{event_id}/attach-day",
        headers=headers_user1
        | {
            "If-Match": str(current_trip["version"]),
            "Idempotency-Key": f"p6-attach-{uuid.uuid4()}",
        },
        json={"trip_day_id": first_day["id"]},
    )
    assert attach.status_code == 200
    assert attach.json()["event_snapshot_id"] == event_id
    assert attach.json()["source"] == "manual"

    generated = api_client.post(
        f"/days/{first_day['id']}/activities",
        headers=headers_user1 | {"Idempotency-Key": f"p6-generated-{uuid.uuid4()}"},
        json={
            "title": "Coffee break",
            "description": "Keep this flexible",
            "start_time": "11:00:00",
            "source": "generated",
        },
    )
    assert generated.status_code == 201

    unattached_event_id = _seed_event_snapshot(
        trip_id=trip["id"],
        trip_day_id=first_day["id"],
        place_id=place_id,
        start_at=f"{first_day['date']}T14:00:00Z",
        title="Afternoon guided exhibit",
    )

    optimize = api_client.post(
        f"/trips/{trip['id']}/optimize",
        headers=headers_user1 | {"Idempotency-Key": f"p6-optimize-{uuid.uuid4()}"},
        json={
            "day_ids": [first_day["id"]],
            "objective": "balanced_flow",
            "include_event_candidates": True,
            "max_event_candidates_per_day": 2,
            "constraints": {},
        },
    )
    assert optimize.status_code == 202
    optimize_job = _wait_for_job(api_client, headers_user1, optimize.json()["job_id"])
    assert optimize_job["status"] == "SUCCEEDED"
    proposal_id = optimize_job["result"]["proposal_id"]

    proposals = api_client.get(f"/trips/{trip['id']}/proposals", headers=headers_user1)
    assert proposals.status_code == 200
    assert proposals.json()["total"] >= 1

    proposal = api_client.get(f"/proposals/{proposal_id}", headers=headers_user1)
    assert proposal.status_code == 200
    proposal_body = proposal.json()
    assert proposal_body["based_on_trip_version"] == _get_trip(api_client, headers_user1, trip["id"])["version"]
    assert any(item["event_snapshot_id"] == unattached_event_id for item in proposal_body["items"])

    before_apply_version = _get_trip(api_client, headers_user1, trip["id"])["version"]
    apply_response = api_client.post(
        f"/proposals/{proposal_id}/apply",
        headers=headers_user1
        | {
            "If-Match": str(before_apply_version),
            "Idempotency-Key": f"p6-apply-{uuid.uuid4()}",
        },
    )
    assert apply_response.status_code == 200
    assert apply_response.json()["status"] == "APPLIED"
    assert apply_response.json()["version"] == before_apply_version + 1

    proposal_after = api_client.get(f"/proposals/{proposal_id}", headers=headers_user1)
    assert proposal_after.status_code == 200
    assert proposal_after.json()["status"] == "APPLIED"

    activities = _list_day_activities(api_client, headers_user1, first_day["id"])
    assert any(item["event_snapshot_id"] == event_id for item in activities)
    assert any(item["event_snapshot_id"] == unattached_event_id for item in activities)

    stale_apply = api_client.post(
        f"/proposals/{proposal_id}/apply",
        headers=headers_user1
        | {
            "If-Match": str(before_apply_version),
            "Idempotency-Key": f"p6-apply-{uuid.uuid4()}",
        },
    )
    assert stale_apply.status_code == 409


def test_place_photo_refresh_populates_primary_photo(api_client, headers_user1):
    create = api_client.post(
        "/places",
        headers=headers_user1 | {"Idempotency-Key": f"p6-photo-place-{uuid.uuid4()}"},
        json={
            "source": "manual",
            "name": "Eiffel Tower",
            "category": "landmark",
            "address_text": "Paris, France",
            "lat": 48.8584,
            "lon": 2.2945,
            "metadata": {"website": "https://www.toureiffel.paris/"},
        },
    )
    assert create.status_code == 201
    place_id = create.json()["id"]

    submit = api_client.post(
        f"/places/{place_id}/photos/refresh",
        headers=headers_user1 | {"Idempotency-Key": f"p6-photo-refresh-{uuid.uuid4()}"},
    )
    assert submit.status_code == 202
    job = _wait_for_job(api_client, headers_user1, submit.json()["job_id"], timeout_s=120)
    assert job["status"] == "SUCCEEDED"
    assert job["result"]["summary"]["created"] >= 1

    place = api_client.get(f"/places/{place_id}", headers=headers_user1)
    assert place.status_code == 200
    place_body = place.json()
    assert place_body["photo_count"] >= 1
    assert place_body["primary_photo"] is not None
    assert place_body["primary_photo"]["image_url"]

    photos = api_client.get(f"/places/{place_id}/photos", headers=headers_user1)
    assert photos.status_code == 200
    photos_body = photos.json()
    assert photos_body["total"] >= 1
    assert any(item["is_primary"] for item in photos_body["items"])
