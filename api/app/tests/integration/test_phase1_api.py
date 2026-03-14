import uuid

import jwt
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.phase1]

PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT\x08\x99c\xf8\xff"
    b"\xff?\x00\x05\xfe\x02\xfeA\x0f\xdb\xb5\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _fresh_travel_claims(keycloak_client, *, username: str) -> dict:
    response = keycloak_client.post(
        "/realms/travel/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "voyager-api",
            "username": username,
            "password": "voyager_pass",
        },
    )
    response.raise_for_status()
    return jwt.decode(
        response.json()["access_token"],
        options={"verify_signature": False, "verify_exp": False},
    )


def test_profile_auth_valid_and_invalid(api_client, headers_user1):
    ok = api_client.get("/users/profile", headers=headers_user1)
    assert ok.status_code == 200
    body = ok.json()
    assert body["keycloak_sub"]
    assert body["first_name"]
    assert body["last_name"]
    assert body["display_name"] == f"{body['first_name']} {body['last_name']}"

    bad = api_client.get("/users/profile", headers={"Authorization": "Bearer bad.token"})
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "AUTH_INVALID_TOKEN"


def test_profile_patch_updates_keycloak_names(api_client, headers_user1, keycloak_client):
    try:
        response = api_client.patch(
            "/users/profile",
            headers=headers_user1,
            json={"first_name": "Captain", "last_name": "Atlas"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["first_name"] == "Captain"
        assert body["last_name"] == "Atlas"
        assert body["display_name"] == "Captain Atlas"

        updated_claims = _fresh_travel_claims(keycloak_client, username="voyager_user")
        assert updated_claims["given_name"] == "Captain"
        assert updated_claims["family_name"] == "Atlas"
        assert updated_claims["name"] == "Captain Atlas"
    finally:
        reset_response = api_client.patch(
            "/users/profile",
            headers=headers_user1,
            json={
                "first_name": "Voyager",
                "last_name": "User",
            },
        )
        assert reset_response.status_code == 200


def test_profile_avatar_upload_and_delete(api_client, headers_user1):
    upload = api_client.post(
        "/users/profile/avatar",
        headers=headers_user1,
        files={"file": ("avatar.png", PNG_1X1, "image/png")},
    )
    assert upload.status_code == 200
    body = upload.json()
    assert body["avatar_url"]
    assert body["avatar_thumbnail_url"]

    profile = api_client.get("/users/profile", headers=headers_user1)
    assert profile.status_code == 200
    assert profile.json()["avatar_url"]

    delete = api_client.delete("/users/profile/avatar", headers=headers_user1)
    assert delete.status_code == 200
    assert delete.json()["avatar_url"] is None
    assert delete.json()["avatar_thumbnail_url"] is None


def test_profile_avatar_rejects_non_images(api_client, headers_user1):
    response = api_client.post(
        "/users/profile/avatar",
        headers=headers_user1,
        files={"file": ("avatar.txt", b"not-an-image", "text/plain")},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_trip_create_and_idempotency(api_client, headers_user1, unique_idempotency_key):
    payload = {
        "title": "Lisbon Week",
        "destination_text": "Lisbon, Portugal",
        "start_date": "2026-06-10",
        "end_date": "2026-06-14",
        "budget_amount": 1200,
        "budget_currency": "EUR",
        "trip_type": "cultural",
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
    assert trip_1["title"] == "Trip to Lisbon"
    assert "preferences" not in trip_1


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


def test_trip_route_travel_mode_roundtrip(api_client, headers_user1):
    idem_key = f"travel-mode-trip-{uuid.uuid4()}"
    created = api_client.post(
        "/trips",
        headers=headers_user1 | {"Idempotency-Key": idem_key},
        json={
            "title": "Travel mode trip",
            "destination_text": "Prague",
            "start_date": "2026-07-10",
            "end_date": "2026-07-12",
            "budget_amount": 500,
            "budget_currency": "EUR",
            "trip_type": "city_break",
            "route_travel_mode": "BICYCLE",
        },
    )
    assert created.status_code == 201
    trip = created.json()
    assert trip["route_travel_mode"] == "BICYCLE"

    updated = api_client.patch(
        f"/trips/{trip['id']}",
        headers=headers_user1 | {"If-Match": str(trip["version"])},
        json={"route_travel_mode": "TRANSIT"},
    )
    assert updated.status_code == 200
    assert updated.json()["route_travel_mode"] == "TRANSIT"

    fetched = api_client.get(f"/trips/{trip['id']}", headers=headers_user1)
    assert fetched.status_code == 200
    assert fetched.json()["route_travel_mode"] == "TRANSIT"


def test_trip_cover_preference_fallback_roundtrip(api_client, headers_user1):
    idem_key = f"cover-pref-trip-{uuid.uuid4()}"
    created = api_client.post(
        "/trips",
        headers=headers_user1 | {"Idempotency-Key": idem_key},
        json={
            "title": "Kyoto cover trip",
            "destination_text": "Kyoto, Japan",
            "start_date": "2026-04-18",
            "end_date": "2026-04-24",
            "budget_amount": 2400,
            "budget_currency": "USD",
            "trip_type": "culture",
        },
    )
    assert created.status_code == 201
    trip = created.json()

    patch_payload = {
        "place_id": None,
        "place_label": "Kyoto, Japan",
        "place_lat": 35.0116,
        "place_lng": 135.7681,
        "photo_id": None,
        "asset_id": None,
        "fallback_image_url": "/images/trips/kyoto-lantern-week.jpg",
    }
    patched = api_client.patch(
        f"/trips/{trip['id']}/cover-preference",
        headers=headers_user1,
        json=patch_payload,
    )
    assert patched.status_code == 200
    patched_body = patched.json()

    assert patched_body["version"] == trip["version"]
    assert patched_body["cover_preference"] == patch_payload
    assert patched_body["cover_photo"] == {
        "source": "fallback",
        "url": "/images/trips/kyoto-lantern-week.jpg",
        "thumbnail_url": "/images/trips/kyoto-lantern-week.jpg",
        "asset_id": None,
        "photo_id": None,
        "place_id": None,
        "attribution_text": "Kyoto, Japan",
        "is_fallback": True,
    }

    fetched = api_client.get(f"/trips/{trip['id']}", headers=headers_user1)
    assert fetched.status_code == 200
    fetched_body = fetched.json()
    assert fetched_body["version"] == trip["version"]
    assert fetched_body["cover_preference"] == patch_payload
    assert fetched_body["cover_photo"] == patched_body["cover_photo"]

    listed = api_client.get("/trips", headers=headers_user1)
    assert listed.status_code == 200
    listed_item = next(item for item in listed.json()["items"] if item["id"] == trip["id"])
    assert listed_item["cover_preference"] == patch_payload
    assert listed_item["cover_photo"] == patched_body["cover_photo"]

    planner = api_client.get(f"/trips/{trip['id']}/planner", headers=headers_user1)
    assert planner.status_code == 200
    planner_trip = planner.json()["trip"]
    assert planner_trip["version"] == trip["version"]
    assert planner_trip["cover_preference"] == patch_payload
    assert planner_trip["cover_photo"] == patched_body["cover_photo"]


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
        },
    )
    assert created.status_code == 201
    trip_id = created.json()["id"]

    days = api_client.get(f"/trips/{trip_id}/days", headers=headers_user1)
    assert days.status_code == 200
    day_items = days.json()["items"]
    day_1 = day_items[0]["id"]
    day_2 = day_items[1]["id"]

    source_ids = []
    for idx in range(3):
        activity = api_client.post(
            f"/days/{day_1}/activities",
            headers=headers_user1 | {"Idempotency-Key": f"{activity_key_prefix}-{idx}"},
            json={"title": f"Act {idx}", "source": "manual", "category": "visit"},
        )
        assert activity.status_code == 201
        source_ids.append(activity.json()["id"])

    target_activity = api_client.post(
        f"/days/{day_2}/activities",
        headers=headers_user1 | {"Idempotency-Key": f"{activity_key_prefix}-target"},
        json={"title": "Target occupant", "source": "manual", "category": "visit"},
    )
    assert target_activity.status_code == 201
    target_id = target_activity.json()["id"]

    trip_read = api_client.get(f"/trips/{trip_id}", headers=headers_user1)
    version = trip_read.json()["version"]

    reorder = api_client.post(
        f"/days/{day_1}/activities/reorder",
        headers=headers_user1 | {"If-Match": str(version)},
        json={
            "items": [
                {"activity_id": source_ids[2], "order_index": 0},
                {"activity_id": source_ids[0], "order_index": 1},
                {"activity_id": source_ids[1], "order_index": 2},
            ]
        },
    )
    assert reorder.status_code == 200
    reordered_items = reorder.json()["items"]
    assert [item["order_index"] for item in reordered_items] == [0, 1, 2]

    trip_read_2 = api_client.get(f"/trips/{trip_id}", headers=headers_user1)
    version_2 = trip_read_2.json()["version"]

    move = api_client.post(
        f"/activities/{source_ids[2]}/move",
        headers=headers_user1 | {"If-Match": str(version_2)},
        json={"target_day_id": day_2, "target_index": 0},
    )
    assert move.status_code == 200

    trip_read_3 = api_client.get(f"/trips/{trip_id}", headers=headers_user1)
    version_3 = trip_read_3.json()["version"]

    second_move = api_client.post(
        f"/activities/{source_ids[0]}/move",
        headers=headers_user1 | {"If-Match": str(version_3)},
        json={"target_day_id": day_2, "target_index": 1},
    )
    assert second_move.status_code == 200

    source_activities = api_client.get(f"/days/{day_1}/activities", headers=headers_user1)
    target_activities = api_client.get(f"/days/{day_2}/activities", headers=headers_user1)
    assert source_activities.status_code == 200
    assert target_activities.status_code == 200

    source_items = source_activities.json()["items"]
    target_items = target_activities.json()["items"]
    assert [item["order_index"] for item in source_items] == list(range(len(source_items)))
    assert [item["order_index"] for item in target_items] == list(range(len(target_items)))
    assert [item["id"] for item in target_items] == [source_ids[2], source_ids[0], target_id]


def test_trip_scoped_inbox_activity_roundtrip_and_planner_partition(api_client, headers_user1):
    trip_key = f"inbox-trip-{uuid.uuid4()}"
    created = api_client.post(
        "/trips",
        headers=headers_user1 | {"Idempotency-Key": trip_key},
        json={
            "title": "Inbox roundtrip trip",
            "destination_text": "Madrid",
            "start_date": "2026-10-01",
            "end_date": "2026-10-03",
            "budget_amount": 900,
            "budget_currency": "EUR",
            "trip_type": "city_break",
        },
    )
    assert created.status_code == 201
    trip_id = created.json()["id"]

    days = api_client.get(f"/trips/{trip_id}/days", headers=headers_user1)
    assert days.status_code == 200
    day_1 = days.json()["items"][0]["id"]

    inbox_create = api_client.post(
        f"/trips/{trip_id}/planner/activities",
        headers=headers_user1 | {"Idempotency-Key": f"inbox-activity-{uuid.uuid4()}"},
        json={
            "title": "Choose tapas bar",
            "source": "manual",
            "category": "eat",
            "start_time": "10:15:00",
        },
    )
    assert inbox_create.status_code == 201
    inbox_activity = inbox_create.json()
    assert inbox_activity["trip_day_id"] is None
    assert inbox_activity["start_time"] is None
    assert inbox_activity["category"] == "eat"

    planner = api_client.get(f"/trips/{trip_id}/planner", headers=headers_user1)
    assert planner.status_code == 200
    planner_body = planner.json()
    assert [item["id"] for item in planner_body["inbox_activities"]] == [inbox_activity["id"]]
    assert all(
        item["id"] != inbox_activity["id"]
        for day in planner_body["days"]
        for item in day["activities"]
    )

    version = api_client.get(f"/trips/{trip_id}", headers=headers_user1).json()["version"]
    assign_to_day = api_client.post(
        f"/activities/{inbox_activity['id']}/move",
        headers=headers_user1 | {"If-Match": str(version)},
        json={"target_day_id": day_1, "target_index": 0},
    )
    assert assign_to_day.status_code == 200
    assert assign_to_day.json()["trip_day_id"] == day_1
    assert assign_to_day.json()["start_time"] is None

    planner_after_assign = api_client.get(f"/trips/{trip_id}/planner", headers=headers_user1)
    assert planner_after_assign.status_code == 200
    assigned_body = planner_after_assign.json()
    assert assigned_body["inbox_activities"] == []
    assigned_day = next(day for day in assigned_body["days"] if day["id"] == day_1)
    assert assigned_day["activities"][0]["id"] == inbox_activity["id"]
    assert assigned_day["activities"][0]["start_time"] is None

    version_2 = api_client.get(f"/trips/{trip_id}", headers=headers_user1).json()["version"]
    move_back_to_inbox = api_client.post(
        f"/activities/{inbox_activity['id']}/move",
        headers=headers_user1 | {"If-Match": str(version_2)},
        json={"target_day_id": None, "target_index": 0},
    )
    assert move_back_to_inbox.status_code == 200
    assert move_back_to_inbox.json()["trip_day_id"] is None
    assert move_back_to_inbox.json()["start_time"] is None

    planner_after_return = api_client.get(f"/trips/{trip_id}/planner", headers=headers_user1)
    assert planner_after_return.status_code == 200
    returned_body = planner_after_return.json()
    assert [item["id"] for item in returned_body["inbox_activities"]] == [inbox_activity["id"]]
    assert all(
        item["id"] != inbox_activity["id"]
        for day in returned_body["days"]
        for item in day["activities"]
    )


def test_duplicate_trip_preserves_inbox_activities(api_client, headers_user1):
    trip_key = f"duplicate-inbox-trip-{uuid.uuid4()}"
    created = api_client.post(
        "/trips",
        headers=headers_user1 | {"Idempotency-Key": trip_key},
        json={
            "title": "Duplicate inbox trip",
            "destination_text": "Athens",
            "start_date": "2026-11-05",
            "end_date": "2026-11-07",
            "budget_amount": 800,
            "budget_currency": "EUR",
            "trip_type": "city_break",
        },
    )
    assert created.status_code == 201
    trip_id = created.json()["id"]

    days = api_client.get(f"/trips/{trip_id}/days", headers=headers_user1)
    assert days.status_code == 200
    day_1 = days.json()["items"][0]["id"]

    day_activity = api_client.post(
        f"/days/{day_1}/activities",
        headers=headers_user1 | {"Idempotency-Key": f"duplicate-day-activity-{uuid.uuid4()}"},
        json={"title": "Acropolis sunrise", "source": "manual", "category": "visit"},
    )
    assert day_activity.status_code == 201

    inbox_activity = api_client.post(
        f"/trips/{trip_id}/planner/activities",
        headers=headers_user1 | {"Idempotency-Key": f"duplicate-inbox-activity-{uuid.uuid4()}"},
        json={"title": "Museum shortlist", "source": "manual", "category": "activity"},
    )
    assert inbox_activity.status_code == 201
    assert inbox_activity.json()["trip_day_id"] is None

    duplicate = api_client.post(
        f"/trips/{trip_id}/duplicate",
        headers=headers_user1 | {"Idempotency-Key": f"duplicate-trip-{uuid.uuid4()}"},
    )
    assert duplicate.status_code == 201
    duplicate_trip_id = duplicate.json()["id"]
    assert duplicate_trip_id != trip_id

    duplicate_planner = api_client.get(f"/trips/{duplicate_trip_id}/planner", headers=headers_user1)
    assert duplicate_planner.status_code == 200
    duplicate_body = duplicate_planner.json()

    assert [item["title"] for item in duplicate_body["inbox_activities"]] == ["Museum shortlist"]
    assert duplicate_body["inbox_activities"][0]["trip_day_id"] is None
    assert duplicate_body["inbox_activities"][0]["category"] == "activity"
    assert any(
        activity["title"] == "Acropolis sunrise"
        for day in duplicate_body["days"]
        for activity in day["activities"]
    )


def test_create_trip_with_editorial_route_seeds_generated_activities(api_client, headers_user1):
    created = api_client.post(
        "/trips",
        headers=headers_user1 | {"Idempotency-Key": f"editorial-trip-{uuid.uuid4()}"},
        json={
            "destination_text": "Kyoto, Japan",
            "start_date": "2026-04-18",
            "end_date": "2026-04-24",
            "budget_amount": 2400,
            "budget_currency": "USD",
            "trip_type": "culture",
            "route_travel_mode": "WALK",
            "editorial_route_id": "kyoto-lantern-week",
        },
    )
    assert created.status_code == 201
    trip_id = created.json()["id"]

    planner = api_client.get(f"/trips/{trip_id}/planner", headers=headers_user1)
    assert planner.status_code == 200
    body = planner.json()

    assert len(body["days"]) == 7
    assert body["inbox_activities"] == []
    assert all(len(day["activities"]) == 3 for day in body["days"])
    assert all(activity["source"] == "generated" for day in body["days"] for activity in day["activities"])
    assert all(activity["place_id"] is not None for day in body["days"] for activity in day["activities"])
    assert all(activity["place"] is not None for day in body["days"] for activity in day["activities"])
    assert all(
        activity["place"]["address_text"]
        for day in body["days"]
        for activity in day["activities"]
    )


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
