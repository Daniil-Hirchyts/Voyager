import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.phase1]


def test_profile_auth_valid_and_invalid(api_client, headers_user1):
    ok = api_client.get("/users/profile", headers=headers_user1)
    assert ok.status_code == 200
    body = ok.json()
    assert body["keycloak_sub"]

    bad = api_client.get("/users/profile", headers={"Authorization": "Bearer bad.token"})
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "AUTH_INVALID_TOKEN"


def test_trip_create_and_idempotency(api_client, headers_user1, unique_idempotency_key):
    payload = {
        "title": "Lisbon Week",
        "destination_text": "Lisbon, Portugal",
        "start_date": "2026-06-10",
        "end_date": "2026-06-14",
        "budget_amount": 1200,
        "budget_currency": "EUR",
        "trip_type": "cultural",
        "preferences": ["museums", "food"],
    }

    first = api_client.post(
        "/trips",
        headers=headers_user1 | {"Idempotency-Key": unique_idempotency_key},
        json=payload,
    )
    assert first.status_code == 201
    trip_1 = first.json()

    second = api_client.post(
        "/trips",
        headers=headers_user1 | {"Idempotency-Key": unique_idempotency_key},
        json=payload,
    )
    assert second.status_code == 201
    trip_2 = second.json()

    assert trip_1["id"] == trip_2["id"]
    assert trip_1["version"] == trip_2["version"] == 1


def test_trip_version_conflict(api_client, headers_user1):
    idem_key = f"conflict-trip-{uuid.uuid4()}"
    create_payload = {
        "title": "Version test",
        "destination_text": "Porto",
        "start_date": "2026-07-10",
        "end_date": "2026-07-12",
        "budget_amount": 500,
        "budget_currency": "EUR",
        "trip_type": "food",
        "preferences": ["restaurants"],
    }

    created = api_client.post(
        "/trips",
        headers=headers_user1 | {"Idempotency-Key": idem_key},
        json=create_payload,
    )
    assert created.status_code == 201
    trip_id = created.json()["id"]

    ok_patch = api_client.patch(
        f"/trips/{trip_id}",
        headers=headers_user1 | {"If-Match": "1"},
        json={"title": "Version test updated"},
    )
    assert ok_patch.status_code == 200

    stale_patch = api_client.patch(
        f"/trips/{trip_id}",
        headers=headers_user1 | {"If-Match": "1"},
        json={"title": "Stale write"},
    )
    assert stale_patch.status_code == 409
    assert stale_patch.json()["error"]["code"] == "CONFLICT_VERSION_MISMATCH"


def test_reorder_and_move_activity(api_client, headers_user1):
    trip_key = f"reorder-trip-{uuid.uuid4()}"
    activity_key_prefix = f"reorder-act-{uuid.uuid4()}"
    created = api_client.post(
        "/trips",
        headers=headers_user1 | {"Idempotency-Key": trip_key},
        json={
            "title": "Reorder trip",
            "destination_text": "Rome",
            "start_date": "2026-08-01",
            "end_date": "2026-08-03",
            "budget_amount": 700,
            "budget_currency": "EUR",
            "trip_type": "cultural",
            "preferences": ["history"],
        },
    )
    assert created.status_code == 201
    trip_id = created.json()["id"]

    days = api_client.get(f"/trips/{trip_id}/days", headers=headers_user1)
    assert days.status_code == 200
    day_items = days.json()["items"]
    day_1 = day_items[0]["id"]
    day_2 = day_items[1]["id"]

    ids = []
    for idx in range(3):
        activity = api_client.post(
            f"/days/{day_1}/activities",
            headers=headers_user1 | {"Idempotency-Key": f"{activity_key_prefix}-{idx}"},
            json={"title": f"Act {idx}", "source": "manual", "tags": []},
        )
        assert activity.status_code == 201
        ids.append(activity.json()["id"])

    trip_read = api_client.get(f"/trips/{trip_id}", headers=headers_user1)
    version = trip_read.json()["version"]

    reorder = api_client.post(
        f"/days/{day_1}/activities/reorder",
        headers=headers_user1 | {"If-Match": str(version)},
        json={
            "items": [
                {"activity_id": ids[2], "order_index": 0},
                {"activity_id": ids[0], "order_index": 1},
                {"activity_id": ids[1], "order_index": 2},
            ]
        },
    )
    assert reorder.status_code == 200
    reordered_items = reorder.json()["items"]
    assert [item["order_index"] for item in reordered_items] == [0, 1, 2]

    trip_read_2 = api_client.get(f"/trips/{trip_id}", headers=headers_user1)
    version_2 = trip_read_2.json()["version"]

    move = api_client.post(
        f"/activities/{ids[2]}/move",
        headers=headers_user1 | {"If-Match": str(version_2)},
        json={"target_day_id": day_2, "target_index": 0},
    )
    assert move.status_code == 200

    source_activities = api_client.get(f"/days/{day_1}/activities", headers=headers_user1)
    target_activities = api_client.get(f"/days/{day_2}/activities", headers=headers_user1)
    assert source_activities.status_code == 200
    assert target_activities.status_code == 200

    source_items = source_activities.json()["items"]
    target_items = target_activities.json()["items"]
    assert [item["order_index"] for item in source_items] == list(range(len(source_items)))
    assert [item["order_index"] for item in target_items] == list(range(len(target_items)))


def test_ownership_isolation(api_client, headers_user1, headers_user2):
    idem_key = f"ownership-trip-{uuid.uuid4()}"
    created = api_client.post(
        "/trips",
        headers=headers_user1 | {"Idempotency-Key": idem_key},
        json={
            "title": "Owner only",
            "destination_text": "Berlin",
            "start_date": "2026-09-01",
            "end_date": "2026-09-02",
            "budget_amount": 300,
            "budget_currency": "EUR",
            "trip_type": "city",
            "preferences": ["walk"],
        },
    )
    assert created.status_code == 201
    trip_id = created.json()["id"]

    forbidden = api_client.get(f"/trips/{trip_id}", headers=headers_user2)
    assert forbidden.status_code in (403, 404)


def test_user_rate_limit(api_client, headers_user1):
    statuses = []
    for _ in range(140):
        response = api_client.get("/users/profile", headers=headers_user1)
        statuses.append(response.status_code)
        if response.status_code == 429:
            break

    assert 429 in statuses
