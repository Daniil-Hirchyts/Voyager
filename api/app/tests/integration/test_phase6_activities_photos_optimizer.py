import time
import uuid

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


def _save_activity(
    api_client,
    headers,
    *,
    trip_id: str,
    entity_type: str,
    provider_ref: str,
    title: str,
    summary: str,
    lat: float | None = None,
    lon: float | None = None,
    address_text: str | None = None,
    rating: float = 4.7,
    review_count: int = 1200,
    tags: list[str] | None = None,
) -> dict:
    response = api_client.post(
        f"/trips/{trip_id}/activities/save",
        headers=headers | {"Idempotency-Key": f"p6-save-{uuid.uuid4()}"},
        json={
            "entity_type": entity_type,
            "provider": "tripadvisor",
            "provider_ref": provider_ref,
            "title": title,
            "summary": summary,
            "rating": rating,
            "review_count": review_count,
            "price_label": "$$",
            "image_url": "https://images.example.com/activity.jpg",
            "detail_url": "https://tripadvisor.com/example",
            "address_text": address_text,
            "lat": lat,
            "lon": lon,
            "tags": tags or ["culture", "atlas-pick"],
            "status_text": "Open now",
            "currency": "EUR",
            "raw_payload": {"seeded": True, "provider_ref": provider_ref},
        },
    )
    assert response.status_code == 201
    return response.json()


def test_saved_activity_attach_recommend_optimize_and_apply(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase6 activities optimize trip")
    first_day = _list_days(api_client, headers_user1, trip["id"])[0]

    saved_restaurant = _save_activity(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        entity_type="restaurant",
        provider_ref=f"tripadvisor-restaurant-{uuid.uuid4()}",
        title="Le Comptoir Atlas",
        summary="A shortlist dinner stop near the museum district.",
        lat=48.8606,
        lon=2.3376,
        address_text="Rue de Rivoli, Paris, France",
        tags=["restaurant", "dinner", "central"],
    )

    shortlist = api_client.get(f"/trips/{trip['id']}/activities", headers=headers_user1)
    assert shortlist.status_code == 200
    assert shortlist.json()["total"] == 1
    assert shortlist.json()["items"][0]["snapshot_id"] == saved_restaurant["snapshot_id"]

    detail = api_client.get(
        f"/activities/{saved_restaurant['snapshot_id']}",
        headers=headers_user1,
    )
    assert detail.status_code == 200
    detail_body = detail.json()
    assert detail_body["title"] == saved_restaurant["title"]
    assert isinstance(detail_body["provider_payload"], dict)

    current_trip = _get_trip(api_client, headers_user1, trip["id"])
    attach = api_client.post(
        f"/trips/{trip['id']}/activities/{saved_restaurant['snapshot_id']}/attach-day",
        headers=headers_user1
        | {
            "If-Match": str(current_trip["version"]),
            "Idempotency-Key": f"p6-attach-{uuid.uuid4()}",
        },
        json={"trip_day_id": first_day["id"]},
    )
    assert attach.status_code == 200
    assert attach.json()["event_snapshot_id"] == saved_restaurant["snapshot_id"]

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

    saved_attraction = _save_activity(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        entity_type="attraction",
        provider_ref=f"tripadvisor-attraction-{uuid.uuid4()}",
        title="After Hours Sculpture Hall",
        summary="An attachable shortlist candidate for the same day.",
        lat=48.8611,
        lon=2.3358,
        address_text="Palais Royal, Paris, France",
        tags=["attraction", "museum", "evening"],
    )

    recommendations = api_client.post(
        f"/trips/{trip['id']}/activities/recommendations",
        headers=headers_user1,
        json={
            "day_ids": [first_day["id"]],
            "snapshot_ids": [saved_attraction["snapshot_id"]],
            "limit": 3,
            "use_llm_rationale": False,
        },
    )
    assert recommendations.status_code == 200
    recommendations_body = recommendations.json()
    assert recommendations_body["total"] >= 1
    assert recommendations_body["items"][0]["snapshot_id"] == saved_attraction["snapshot_id"]
    assert recommendations_body["items"][0]["trip_day_id"] == first_day["id"]
    assert recommendations_body["items"][0]["item"]["entity_type"] == "attraction"

    optimize = api_client.post(
        f"/trips/{trip['id']}/optimize",
        headers=headers_user1 | {"Idempotency-Key": f"p6-optimize-{uuid.uuid4()}"},
        json={
            "day_ids": [first_day["id"]],
            "activity_snapshot_ids": [saved_attraction["snapshot_id"]],
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

    proposal = api_client.get(f"/proposals/{proposal_id}", headers=headers_user1)
    assert proposal.status_code == 200
    proposal_body = proposal.json()
    assert any(
        item["event_snapshot_id"] == saved_attraction["snapshot_id"]
        for item in proposal_body["items"]
    )

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

    activities = _list_day_activities(api_client, headers_user1, first_day["id"])
    assert any(item["event_snapshot_id"] == saved_restaurant["snapshot_id"] for item in activities)
    assert any(item["event_snapshot_id"] == saved_attraction["snapshot_id"] for item in activities)


def test_hotel_shortlist_item_cannot_attach_to_day(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase6 hotel attach guard")
    first_day = _list_days(api_client, headers_user1, trip["id"])[0]
    hotel = _save_activity(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        entity_type="hotel",
        provider_ref=f"tripadvisor-hotel-{uuid.uuid4()}",
        title="Atlas House Saint-Germain",
        summary="Saved for reference only.",
        lat=48.8529,
        lon=2.3488,
        address_text="Saint-Germain, Paris, France",
        tags=["hotel", "stay"],
    )

    current_trip = _get_trip(api_client, headers_user1, trip["id"])
    attach = api_client.post(
        f"/trips/{trip['id']}/activities/{hotel['snapshot_id']}/attach-day",
        headers=headers_user1
        | {
            "If-Match": str(current_trip["version"]),
            "Idempotency-Key": f"p6-hotel-attach-{uuid.uuid4()}",
        },
        json={"trip_day_id": first_day["id"]},
    )
    assert attach.status_code == 422
    assert "Only attractions and restaurants" in attach.json()["error"]["message"]


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
