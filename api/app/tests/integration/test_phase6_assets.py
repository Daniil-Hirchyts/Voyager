from __future__ import annotations

import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.phase6]


PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT\x08\x99c\xf8\xff"
    b"\xff?\x00\x05\xfe\x02\xfeA\x0f\xdb\xb5\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _create_trip(api_client, headers, *, title: str) -> dict:
    response = api_client.post(
        "/trips",
        headers=headers | {"Idempotency-Key": f"p6-trip-{uuid.uuid4()}"},
        json={
            "title": title,
            "destination_text": "Lisbon",
            "start_date": "2026-12-10",
            "end_date": "2026-12-12",
            "budget_amount": 1800,
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


def _upload_trip_photo_asset(api_client, headers, trip_id: str) -> dict:
    response = api_client.post(
        f"/trips/{trip_id}/assets",
        headers=headers,
        files={"file": ("cover-photo.png", PNG_1X1, "image/png")},
    )
    assert response.status_code == 201
    return response.json()


def test_trip_and_activity_asset_uploads_round_trip(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase6 assets")
    day_id = _list_days(api_client, headers_user1, trip["id"])[0]["id"]

    trip_asset = api_client.post(
        f"/trips/{trip['id']}/assets",
        headers=headers_user1,
        files={"file": ("passport-scan.pdf", b"synthetic passport scan", "application/pdf")},
    )
    assert trip_asset.status_code == 201
    trip_asset_json = trip_asset.json()
    assert trip_asset_json["kind"] == "file"
    assert trip_asset_json["download_url"].startswith("http://localhost:9000/")

    list_trip_assets = api_client.get(f"/trips/{trip['id']}/assets", headers=headers_user1)
    assert list_trip_assets.status_code == 200
    assert list_trip_assets.json()["total"] == 1
    assert list_trip_assets.json()["items"][0]["id"] == trip_asset_json["id"]

    activity = api_client.post(
        f"/days/{day_id}/activities",
        headers=headers_user1 | {"Idempotency-Key": f"p6-activity-{uuid.uuid4()}"},
        json={"title": "Museum stop", "source": "manual", "category": "visit"},
    )
    assert activity.status_code == 201
    activity_id = activity.json()["id"]

    activity_asset = api_client.post(
        f"/trips/{trip['id']}/assets",
        headers=headers_user1,
        data={"activity_id": activity_id},
        files={"file": ("museum-photo.png", PNG_1X1, "image/png")},
    )
    assert activity_asset.status_code == 201
    activity_asset_json = activity_asset.json()
    assert activity_asset_json["kind"] == "photo"
    assert activity_asset_json["activity_id"] == activity_id
    assert activity_asset_json["preview_url"]

    list_activity_assets = api_client.get(
        f"/trips/{trip['id']}/assets",
        headers=headers_user1,
        params={"activity_id": activity_id},
    )
    assert list_activity_assets.status_code == 200
    assert list_activity_assets.json()["total"] == 1
    assert list_activity_assets.json()["items"][0]["id"] == activity_asset_json["id"]

    delete_trip_asset = api_client.delete(
        f"/assets/{trip_asset_json['id']}",
        headers=headers_user1,
    )
    assert delete_trip_asset.status_code == 204

    list_trip_assets_after_delete = api_client.get(
        f"/trips/{trip['id']}/assets",
        headers=headers_user1,
    )
    assert list_trip_assets_after_delete.status_code == 200
    assert list_trip_assets_after_delete.json()["total"] == 0


def test_duplicate_trip_remaps_selected_cover_asset(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase6 duplicate cover")
    photo_asset = _upload_trip_photo_asset(api_client, headers_user1, trip["id"])

    patch = api_client.patch(
        f"/trips/{trip['id']}/cover-preference",
        headers=headers_user1,
        json={"asset_id": photo_asset["id"]},
    )
    assert patch.status_code == 200
    assert patch.json()["cover_preference"]["asset_id"] == photo_asset["id"]
    assert patch.json()["cover_photo"]["asset_id"] == photo_asset["id"]

    duplicate = api_client.post(
        f"/trips/{trip['id']}/duplicate",
        headers=headers_user1 | {"Idempotency-Key": f"p6-duplicate-{uuid.uuid4()}"},
    )
    assert duplicate.status_code == 201
    duplicate_body = duplicate.json()

    assert duplicate_body["id"] != trip["id"]
    assert duplicate_body["cover_preference"]["asset_id"] != photo_asset["id"]
    assert duplicate_body["cover_photo"]["source"] == "uploaded"
    assert (
        duplicate_body["cover_photo"]["asset_id"]
        == duplicate_body["cover_preference"]["asset_id"]
    )

    duplicate_assets = api_client.get(
        f"/trips/{duplicate_body['id']}/assets",
        headers=headers_user1,
    )
    assert duplicate_assets.status_code == 200
    assert duplicate_assets.json()["total"] == 1
    assert duplicate_assets.json()["items"][0]["id"] == duplicate_body["cover_preference"]["asset_id"]


def test_deleting_selected_cover_asset_clears_cover_preference(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase6 clear cover")
    photo_asset = _upload_trip_photo_asset(api_client, headers_user1, trip["id"])

    patch = api_client.patch(
        f"/trips/{trip['id']}/cover-preference",
        headers=headers_user1,
        json={"asset_id": photo_asset["id"]},
    )
    assert patch.status_code == 200
    assert patch.json()["cover_photo"]["asset_id"] == photo_asset["id"]

    delete_response = api_client.delete(
        f"/assets/{photo_asset['id']}",
        headers=headers_user1,
    )
    assert delete_response.status_code == 204

    fetched = api_client.get(f"/trips/{trip['id']}", headers=headers_user1)
    assert fetched.status_code == 200
    fetched_body = fetched.json()
    assert fetched_body["cover_preference"] is None
    assert fetched_body["cover_photo"] is None
