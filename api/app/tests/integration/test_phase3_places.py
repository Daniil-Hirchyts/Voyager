import time
import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.phase3]


def _create_place(
    api_client,
    headers,
    *,
    name: str,
    lat: float,
    lon: float,
    category: str = "poi",
    external_id: str | None = None,
    metadata: dict | None = None,
    source: str = "phase3",
) -> dict:
    response = api_client.post(
        "/places",
        headers=headers | {"Idempotency-Key": f"p3-place-{uuid.uuid4()}"},
        json={
            "source": source,
            "external_id": external_id,
            "name": name,
            "category": category,
            "address_text": "Synthetic",
            "lat": lat,
            "lon": lon,
            "metadata": metadata or {},
        },
    )
    assert response.status_code == 201
    return response.json()


def _create_trip(api_client, headers, *, idem_key: str) -> dict:
    response = api_client.post(
        "/trips",
        headers=headers | {"Idempotency-Key": idem_key},
        json={
            "title": "Phase 3 trip",
            "destination_text": "Lisbon",
            "start_date": "2026-11-10",
            "end_date": "2026-11-10",
            "budget_amount": 800,
            "budget_currency": "EUR",
            "trip_type": "city",
        },
    )
    assert response.status_code == 201
    return response.json()


def _list_days(api_client, headers, trip_id: str) -> list[dict]:
    response = api_client.get(f"/trips/{trip_id}/days", headers=headers)
    assert response.status_code == 200
    return response.json()["items"]


def _wait_for_job(api_client, headers, job_id: str, *, timeout_s: int = 45) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        response = api_client.get(f"/jobs/{job_id}", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        if payload["status"] in {"SUCCEEDED", "FAILED"}:
            return payload
        time.sleep(0.5)
    raise AssertionError(f"Job {job_id} did not complete within {timeout_s}s")


def test_nearby_and_viewport_correctness(api_client, headers_user1):
    source = f"phase3-nearby-{uuid.uuid4()}"
    a = _create_place(
        api_client,
        headers_user1,
        source=source,
        name="Geo Anchor A",
        lat=1.0000,
        lon=2.0000,
    )
    b = _create_place(
        api_client,
        headers_user1,
        source=source,
        name="Geo Anchor B",
        lat=1.0005,
        lon=2.0005,
    )
    _ = _create_place(
        api_client,
        headers_user1,
        source=source,
        name="Geo Far",
        lat=1.0500,
        lon=2.0500,
    )

    nearby = api_client.get(
        "/places/nearby",
        headers=headers_user1,
        params={"lat": 1.0002, "lon": 2.0002, "radius_m": 500, "limit": 50, "offset": 0},
    )
    assert nearby.status_code == 200
    nearby_items = nearby.json()["items"]
    assert nearby_items
    assert all(item["distance_m"] <= 500 for item in nearby_items)
    distances = [item["distance_m"] for item in nearby_items]
    assert distances == sorted(distances)
    nearby_ids = {item["id"] for item in nearby_items}
    assert a["id"] in nearby_ids
    assert b["id"] in nearby_ids

    viewport = api_client.get(
        "/places/viewport",
        headers=headers_user1,
        params={
            "min_lat": 0.9990,
            "min_lon": 1.9990,
            "max_lat": 1.0010,
            "max_lon": 2.0010,
            "limit": 50,
            "offset": 0,
        },
    )
    assert viewport.status_code == 200
    viewport_items = viewport.json()["items"]
    viewport_ids = {item["id"] for item in viewport_items}
    assert a["id"] in viewport_ids
    assert b["id"] in viewport_ids
    for item in viewport_items:
        assert 0.9990 <= item["lat"] <= 1.0010
        assert 1.9990 <= item["lon"] <= 2.0010


def test_metadata_policy_and_cache_invalidation(api_client, headers_user1, headers_admin):
    place = _create_place(
        api_client,
        headers_user1,
        name="Metadata Place",
        lat=3.1000,
        lon=4.1000,
        metadata={"description": "old"},
        source=f"phase3-meta-{uuid.uuid4()}",
    )
    place_id = place["id"]

    warm = api_client.get(f"/places/{place_id}", headers=headers_user1)
    assert warm.status_code == 200
    assert warm.json()["metadata"]["description"] == "old"

    forbidden = api_client.patch(
        f"/places/{place_id}",
        headers=headers_user1,
        json={"metadata": {"description": "new"}},
    )
    assert forbidden.status_code == 403

    ok_patch = api_client.patch(
        f"/places/{place_id}",
        headers=headers_admin,
        json={"metadata": {"description": "new", "website": "https://example.com"}},
    )
    assert ok_patch.status_code == 200

    after = api_client.get(f"/places/{place_id}", headers=headers_user1)
    assert after.status_code == 200
    payload = after.json()
    assert payload["metadata"]["description"] == "new"
    assert payload["metadata"]["website"] == "https://example.com"

    bad_patch = api_client.patch(
        f"/places/{place_id}",
        headers=headers_admin,
        json={"metadata": {"unknown_key": "x"}},
    )
    assert bad_patch.status_code == 422
    assert bad_patch.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "unknown_key" in bad_patch.json()["error"]["details"]["unsupported_keys"]


def test_manual_merge_remaps_activity_and_invalidates_nearby_cache(
    api_client, headers_user1, headers_admin
):
    source = f"phase3-merge-{uuid.uuid4()}"
    canonical = _create_place(
        api_client,
        headers_user1,
        source=source,
        name="Merge Target",
        lat=5.1000,
        lon=6.1000,
        category="sightseeing",
    )
    duplicate = _create_place(
        api_client,
        headers_user1,
        source=source,
        name="Merge Target",
        lat=5.1002,
        lon=6.1001,
        category="sightseeing",
    )

    trip = _create_trip(api_client, headers_user1, idem_key=f"p3-trip-{uuid.uuid4()}")
    day_id = _list_days(api_client, headers_user1, trip["id"])[0]["id"]
    create_activity = api_client.post(
        f"/days/{day_id}/activities",
        headers=headers_user1 | {"Idempotency-Key": f"p3-activity-{uuid.uuid4()}"},
        json={"title": "Linked duplicate", "source": "manual", "place_id": duplicate["id"]},
    )
    assert create_activity.status_code == 201

    before_nearby = api_client.get(
        "/places/nearby",
        headers=headers_user1,
        params={"lat": 5.1001, "lon": 6.1001, "radius_m": 300, "limit": 50, "offset": 0},
    )
    assert before_nearby.status_code == 200
    before_map = {item["id"]: item for item in before_nearby.json()["items"]}
    assert before_map[duplicate["id"]]["canonical_place_id"] is None

    merge = api_client.post(
        f"/places/{canonical['id']}/merge",
        headers=headers_admin | {"Idempotency-Key": f"p3-merge-{uuid.uuid4()}"},
        json={"source_place_ids": [duplicate["id"]], "dedup_confidence": 0.99},
    )
    assert merge.status_code == 200
    assert merge.json()["merged_places"] >= 1

    after_nearby = api_client.get(
        "/places/nearby",
        headers=headers_user1,
        params={"lat": 5.1001, "lon": 6.1001, "radius_m": 300, "limit": 50, "offset": 0},
    )
    assert after_nearby.status_code == 200
    after_map = {item["id"]: item for item in after_nearby.json()["items"]}
    assert after_map[duplicate["id"]]["canonical_place_id"] == canonical["id"]

    activities = api_client.get(f"/days/{day_id}/activities", headers=headers_user1)
    assert activities.status_code == 200
    assert activities.json()["items"][0]["place_id"] == canonical["id"]


def test_dedup_job_async_flow(api_client, headers_user1, headers_admin):
    source = f"phase3-dedup-{uuid.uuid4()}"
    place_name = f"Dedup Anchor {uuid.uuid4()}"
    canonical = _create_place(
        api_client,
        headers_user1,
        source=source,
        name=place_name,
        lat=7.1000,
        lon=8.1000,
        category="museum",
        external_id=f"ext-{uuid.uuid4()}",
    )
    duplicate = _create_place(
        api_client,
        headers_user1,
        source=source,
        name=place_name,
        lat=7.1001,
        lon=8.1001,
        category="museum",
    )

    submit = api_client.post(
        "/places/dedup/run",
        headers=headers_admin | {"Idempotency-Key": f"p3-dedup-{uuid.uuid4()}"},
        json={"radius_m": 300, "max_groups": 500},
    )
    assert submit.status_code == 202
    job = _wait_for_job(api_client, headers_admin, submit.json()["job_id"])
    assert job["status"] == "SUCCEEDED"
    assert job["result"]["summary"]["processed"] >= 2

    duplicate_after = api_client.get(f"/places/{duplicate['id']}", headers=headers_user1)
    assert duplicate_after.status_code == 200
    assert duplicate_after.json()["canonical_place_id"] == canonical["id"]


def test_role_restrictions_for_phase3_admin_endpoints(api_client, headers_user1):
    place = _create_place(
        api_client,
        headers_user1,
        name="Role Guard Place",
        lat=9.1000,
        lon=10.1000,
        source=f"phase3-role-{uuid.uuid4()}",
    )

    patch_attempt = api_client.patch(
        f"/places/{place['id']}",
        headers=headers_user1,
        json={"metadata": {"description": "blocked"}},
    )
    assert patch_attempt.status_code == 403

    merge_attempt = api_client.post(
        f"/places/{place['id']}/merge",
        headers=headers_user1 | {"Idempotency-Key": f"p3-merge-{uuid.uuid4()}"},
        json={"source_place_ids": [str(uuid.uuid4())], "dedup_confidence": 0.9},
    )
    assert merge_attempt.status_code == 403

    dedup_attempt = api_client.post(
        "/places/dedup/run",
        headers=headers_user1 | {"Idempotency-Key": f"p3-dedup-{uuid.uuid4()}"},
        json={"radius_m": 100, "max_groups": 1},
    )
    assert dedup_attempt.status_code == 403


def test_phase3_rate_limits(api_client, headers_user1, headers_admin):
    _create_place(
        api_client,
        headers_user1,
        name="Limiter Anchor",
        lat=11.1000,
        lon=12.1000,
        source=f"phase3-rl-{uuid.uuid4()}",
    )

    geo_statuses = []
    geo_scope = None
    for _ in range(90):
        response = api_client.get(
            "/places/nearby",
            headers=headers_user1,
            params={"lat": 11.1000, "lon": 12.1000, "radius_m": 500},
        )
        geo_statuses.append(response.status_code)
        if response.status_code == 429:
            geo_scope = response.json()["error"]["details"]["scope"]
            break
    assert 429 in geo_statuses
    assert geo_scope == "places:geo"

    dedup_statuses = []
    dedup_scope = None
    for _ in range(10):
        response = api_client.post(
            "/places/dedup/run",
            headers=headers_admin | {"Idempotency-Key": f"p3-dedup-rl-{uuid.uuid4()}"},
            json={"radius_m": 100, "max_groups": 1},
        )
        dedup_statuses.append(response.status_code)
        if response.status_code == 429:
            dedup_scope = response.json()["error"]["details"]["scope"]
            break
    assert 429 in dedup_statuses
    assert dedup_scope == "places:dedup:submit"
