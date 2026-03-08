import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.phase7]


def _create_trip(api_client, headers, *, title: str) -> dict:
    response = api_client.post(
        "/trips",
        headers=headers | {"Idempotency-Key": f"p7-trip-{uuid.uuid4()}"},
        json={
            "title": title,
            "destination_text": "Paris",
            "start_date": "2026-11-10",
            "end_date": "2026-11-14",
            "budget_amount": 2400,
            "budget_currency": "EUR",
            "trip_type": "city",
            "preferences": ["maps", "walking"],
        },
    )
    assert response.status_code == 201
    return response.json()


def _create_map_layer(api_client, headers, trip_id: str, *, idempotency_key: str | None = None) -> dict:
    response = api_client.post(
        f"/trips/{trip_id}/map-layers",
        headers=headers | {"Idempotency-Key": idempotency_key or f"p7-layer-{uuid.uuid4()}"},
        json={
            "name": "Route draft",
            "source": "routes",
            "renderer": "native",
            "feature_collection": {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"summary": "Hotel to museum"},
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [
                                [2.3333, 48.8602],
                                [2.3376, 48.8606],
                            ],
                        },
                    }
                ],
            },
            "style": {"strokeColor": "#2F6F73", "strokeWeight": 4},
            "metadata": {"distance_m": 350},
            "is_visible": True,
            "is_locked": False,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_trip_map_layer_crud_listing_and_idempotency(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase7 layer CRUD")
    idem_key = f"p7-layer-idem-{uuid.uuid4()}"

    first = _create_map_layer(api_client, headers_user1, trip["id"], idempotency_key=idem_key)
    second = _create_map_layer(api_client, headers_user1, trip["id"], idempotency_key=idem_key)

    assert first["id"] == second["id"]
    assert first["trip_id"] == trip["id"]
    assert first["order_index"] == 0
    assert first["feature_collection"]["features"][0]["geometry"]["type"] == "LineString"

    analytics = api_client.post(
        f"/trips/{trip['id']}/map-layers",
        headers=headers_user1 | {"Idempotency-Key": f"p7-layer-{uuid.uuid4()}"},
        json={
            "name": "Density",
            "source": "analytics",
            "renderer": "deckgl",
            "feature_collection": {"type": "FeatureCollection", "features": []},
            "style": {},
            "metadata": {"deckKind": "heatmap"},
            "order_index": 3,
        },
    )
    assert analytics.status_code == 201
    analytics_body = analytics.json()
    assert analytics_body["order_index"] == 3

    listing = api_client.get(
        f"/trips/{trip['id']}/map-layers?limit=100&offset=0",
        headers=headers_user1,
    )
    assert listing.status_code == 200
    listing_body = listing.json()
    assert listing_body["total"] == 2
    assert [item["name"] for item in listing_body["items"]] == ["Route draft", "Density"]

    detail = api_client.get(
        f"/trips/{trip['id']}/map-layers/{first['id']}",
        headers=headers_user1,
    )
    assert detail.status_code == 200
    assert detail.json()["metadata"]["distance_m"] == 350

    patched = api_client.patch(
        f"/trips/{trip['id']}/map-layers/{first['id']}",
        headers=headers_user1,
        json={
            "name": "Route final",
            "is_visible": False,
            "is_locked": True,
            "order_index": 4,
            "metadata": {"distance_m": 410, "alternativeIndex": 1},
        },
    )
    assert patched.status_code == 200
    patched_body = patched.json()
    assert patched_body["name"] == "Route final"
    assert patched_body["is_visible"] is False
    assert patched_body["is_locked"] is True
    assert patched_body["order_index"] == 4
    assert patched_body["metadata"]["alternativeIndex"] == 1

    relisted = api_client.get(
        f"/trips/{trip['id']}/map-layers?limit=100&offset=0",
        headers=headers_user1,
    )
    assert relisted.status_code == 200
    assert [item["name"] for item in relisted.json()["items"]] == ["Density", "Route final"]

    deleted = api_client.delete(
        f"/trips/{trip['id']}/map-layers/{first['id']}",
        headers=headers_user1,
    )
    assert deleted.status_code == 204

    final_listing = api_client.get(
        f"/trips/{trip['id']}/map-layers?limit=100&offset=0",
        headers=headers_user1,
    )
    assert final_listing.status_code == 200
    assert final_listing.json()["total"] == 1
    assert final_listing.json()["items"][0]["id"] == analytics_body["id"]


def test_trip_map_layer_audit_and_owner_scoping(api_client, headers_user1, headers_user2):
    trip = _create_trip(api_client, headers_user1, title="Phase7 layer ownership")
    layer = _create_map_layer(api_client, headers_user1, trip["id"])

    foreign_get = api_client.get(
        f"/trips/{trip['id']}/map-layers/{layer['id']}",
        headers=headers_user2,
    )
    assert foreign_get.status_code in (403, 404)

    foreign_patch = api_client.patch(
        f"/trips/{trip['id']}/map-layers/{layer['id']}",
        headers=headers_user2,
        json={"name": "Stolen layer"},
    )
    assert foreign_patch.status_code in (403, 404)

    update = api_client.patch(
        f"/trips/{trip['id']}/map-layers/{layer['id']}",
        headers=headers_user1,
        json={"name": "Owner updated layer", "is_locked": True},
    )
    assert update.status_code == 200

    delete = api_client.delete(
        f"/trips/{trip['id']}/map-layers/{layer['id']}",
        headers=headers_user1,
    )
    assert delete.status_code == 204

    audit = api_client.get(
        f"/trips/{trip['id']}/audit?entity_type=trip_map_layer&limit=100&offset=0",
        headers=headers_user1,
    )
    assert audit.status_code == 200
    audit_items = audit.json()["items"]
    actions = [item["action"] for item in audit_items]
    assert actions.count("CREATE") == 1
    assert actions.count("UPDATE") == 1
    assert actions.count("DELETE") == 1
    assert {item["entity_id"] for item in audit_items} == {layer["id"]}
