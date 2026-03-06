import time
import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.phase4]


def _create_trip(api_client, headers, *, title: str) -> dict:
    response = api_client.post(
        "/trips",
        headers=headers | {"Idempotency-Key": f"p4-trip-{uuid.uuid4()}"},
        json={
            "title": title,
            "destination_text": "Barcelona",
            "start_date": "2026-12-01",
            "end_date": "2026-12-03",
            "budget_amount": 1500,
            "budget_currency": "EUR",
            "trip_type": "city",
            "preferences": ["food", "culture"],
        },
    )
    assert response.status_code == 201
    return response.json()


def _list_days(api_client, headers, trip_id: str) -> list[dict]:
    response = api_client.get(f"/trips/{trip_id}/days", headers=headers)
    assert response.status_code == 200
    return response.json()["items"]


def _wait_for_job(api_client, headers, job_id: str, *, timeout_s: int = 60) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        response = api_client.get(f"/jobs/{job_id}", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        if payload["status"] in {"SUCCEEDED", "FAILED"}:
            return payload
        time.sleep(0.5)
    raise AssertionError(f"Job {job_id} did not complete within {timeout_s}s")


def _submit_transport_search(
    api_client,
    headers,
    *,
    trip_id: str,
    trip_day_id: str | None,
    providers: list[str] | None,
    transport_modes: list[str] | None = None,
    constraints: dict | None = None,
) -> dict:
    response = api_client.post(
        "/offers/transport/search",
        headers=headers | {"Idempotency-Key": f"p4-ts-{uuid.uuid4()}"},
        json={
            "trip_id": trip_id,
            "trip_day_id": trip_day_id,
            "origin_text": "Paris",
            "destination_text": "Barcelona",
            "depart_date": "2026-12-01",
            "currency": "EUR",
            "transport_modes": transport_modes,
            "providers": providers,
            "constraints": constraints or {},
        },
    )
    return {"status_code": response.status_code, "body": response.json()}


def _submit_lodging_search(
    api_client,
    headers,
    *,
    trip_id: str,
    trip_day_id: str | None,
    providers: list[str] | None,
    lodging_types: list[str] | None = None,
) -> dict:
    response = api_client.post(
        "/offers/lodging/search",
        headers=headers | {"Idempotency-Key": f"p4-ls-{uuid.uuid4()}"},
        json={
            "trip_id": trip_id,
            "trip_day_id": trip_day_id,
            "location_text": "Barcelona",
            "checkin_date": "2026-12-01",
            "checkout_date": "2026-12-03",
            "currency": "EUR",
            "lodging_types": lodging_types,
            "providers": providers,
            "constraints": {},
        },
    )
    return {"status_code": response.status_code, "body": response.json()}


def _list_offers(
    api_client,
    headers,
    trip_id: str,
    *,
    kind: str | None,
    current_only: bool,
    transport_modes: list[str] | None = None,
    lodging_types: list[str] | None = None,
) -> dict:
    params = {"current_only": str(current_only).lower(), "limit": 200, "offset": 0}
    if kind:
        params["kind"] = kind
    if transport_modes:
        params["transport_modes"] = transport_modes
    if lodging_types:
        params["lodging_types"] = lodging_types
    response = api_client.get(f"/trips/{trip_id}/offers", headers=headers, params=params)
    assert response.status_code == 200
    return response.json()


def test_transport_and_lodging_search_jobs_persist_snapshots(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase4 offers search")
    day_id = _list_days(api_client, headers_user1, trip["id"])[0]["id"]

    transport_submit = _submit_transport_search(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_day_id=day_id,
        providers=["mock_transport"],
    )
    assert transport_submit["status_code"] == 202
    transport_job = _wait_for_job(api_client, headers_user1, transport_submit["body"]["job_id"])
    assert transport_job["status"] == "SUCCEEDED"
    assert transport_job["result"]["summary"]["created"] >= 1

    lodging_submit = _submit_lodging_search(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_day_id=day_id,
        providers=["mock_lodging"],
    )
    assert lodging_submit["status_code"] == 202
    lodging_job = _wait_for_job(api_client, headers_user1, lodging_submit["body"]["job_id"])
    assert lodging_job["status"] == "SUCCEEDED"
    assert lodging_job["result"]["summary"]["created"] >= 1

    transport_offers = _list_offers(
        api_client, headers_user1, trip["id"], kind="transport", current_only=True
    )
    lodging_offers = _list_offers(
        api_client, headers_user1, trip["id"], kind="lodging", current_only=True
    )
    all_offers = _list_offers(api_client, headers_user1, trip["id"], kind=None, current_only=True)

    assert transport_offers["total"] >= 1
    assert lodging_offers["total"] >= 1
    assert all_offers["total"] >= transport_offers["total"] + lodging_offers["total"]
    assert all(item["lodging_type"] in {"hotel", None} for item in lodging_offers["items"])


def test_transport_mode_and_lodging_type_filters(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Mode/type filters")
    day_id = _list_days(api_client, headers_user1, trip["id"])[0]["id"]

    transport_submit = _submit_transport_search(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_day_id=day_id,
        providers=["mock_transport"],
        transport_modes=["flight"],
    )
    assert transport_submit["status_code"] == 202
    transport_job = _wait_for_job(api_client, headers_user1, transport_submit["body"]["job_id"])
    assert transport_job["status"] == "SUCCEEDED"

    lodging_submit = _submit_lodging_search(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_day_id=day_id,
        providers=["mock_lodging"],
        lodging_types=["hotel"],
    )
    assert lodging_submit["status_code"] == 202
    lodging_job = _wait_for_job(api_client, headers_user1, lodging_submit["body"]["job_id"])
    assert lodging_job["status"] == "SUCCEEDED"

    filtered_transport = _list_offers(
        api_client,
        headers_user1,
        trip["id"],
        kind="transport",
        current_only=True,
        transport_modes=["flight"],
    )
    assert filtered_transport["total"] >= 1
    assert all(item["transport_mode"] == "flight" for item in filtered_transport["items"])

    filtered_lodging = _list_offers(
        api_client,
        headers_user1,
        trip["id"],
        kind="lodging",
        current_only=True,
        lodging_types=["hotel"],
    )
    assert filtered_lodging["total"] >= 1
    assert all(item["lodging_type"] == "hotel" for item in filtered_lodging["items"])


def test_attach_day_enforces_invariant_and_ownership(api_client, headers_user1, headers_user2):
    trip_owner = _create_trip(api_client, headers_user1, title="Owner trip")
    trip_other = _create_trip(api_client, headers_user2, title="Other trip")

    owner_day = _list_days(api_client, headers_user1, trip_owner["id"])[0]["id"]
    foreign_day = _list_days(api_client, headers_user2, trip_other["id"])[0]["id"]

    submit = _submit_transport_search(
        api_client,
        headers_user1,
        trip_id=trip_owner["id"],
        trip_day_id=None,
        providers=["mock_transport"],
    )
    assert submit["status_code"] == 202
    job = _wait_for_job(api_client, headers_user1, submit["body"]["job_id"])
    assert job["status"] == "SUCCEEDED"

    offers = _list_offers(
        api_client, headers_user1, trip_owner["id"], kind="transport", current_only=True
    )
    offer_id = offers["items"][0]["id"]

    attach_ok = api_client.post(
        f"/trips/{trip_owner['id']}/offers/{offer_id}/attach-day",
        headers=headers_user1 | {"Idempotency-Key": f"p4-attach-{uuid.uuid4()}"},
        json={"offer_kind": "transport", "trip_day_id": owner_day},
    )
    assert attach_ok.status_code == 200
    assert attach_ok.json()["trip_day_id"] == owner_day

    attach_invalid = api_client.post(
        f"/trips/{trip_owner['id']}/offers/{offer_id}/attach-day",
        headers=headers_user1 | {"Idempotency-Key": f"p4-attach-{uuid.uuid4()}"},
        json={"offer_kind": "transport", "trip_day_id": foreign_day},
    )
    assert attach_invalid.status_code == 422

    attach_foreign_user = api_client.post(
        f"/trips/{trip_owner['id']}/offers/{offer_id}/attach-day",
        headers=headers_user2 | {"Idempotency-Key": f"p4-attach-{uuid.uuid4()}"},
        json={"offer_kind": "transport", "trip_day_id": owner_day},
    )
    assert attach_foreign_user.status_code in (403, 404)


def test_refresh_single_and_trip_preserve_snapshot_history(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Refresh lineage")
    day_id = _list_days(api_client, headers_user1, trip["id"])[0]["id"]

    submit = _submit_transport_search(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_day_id=day_id,
        providers=["mock_transport"],
    )
    assert submit["status_code"] == 202
    _wait_for_job(api_client, headers_user1, submit["body"]["job_id"])

    before = _list_offers(
        api_client, headers_user1, trip["id"], kind="transport", current_only=False
    )
    offer_id = before["items"][0]["id"]

    refresh_single = api_client.post(
        f"/offers/{offer_id}/refresh",
        headers=headers_user1 | {"Idempotency-Key": f"p4-refresh-single-{uuid.uuid4()}"},
        json={"offer_kind": "transport", "constraints": {}},
    )
    assert refresh_single.status_code == 202
    single_job = _wait_for_job(api_client, headers_user1, refresh_single.json()["job_id"])
    assert single_job["status"] == "SUCCEEDED"

    after_single = _list_offers(
        api_client, headers_user1, trip["id"], kind="transport", current_only=False
    )
    assert after_single["total"] > before["total"]
    original = next(item for item in after_single["items"] if item["id"] == offer_id)
    assert original["is_current"] is False
    assert original["superseded_by_offer_id"] is not None

    refresh_trip = api_client.post(
        f"/trips/{trip['id']}/offers/refresh",
        headers=headers_user1 | {"Idempotency-Key": f"p4-refresh-trip-{uuid.uuid4()}"},
        json={"offer_kind": "transport", "current_only": True, "constraints": {}},
    )
    assert refresh_trip.status_code == 202
    trip_job = _wait_for_job(api_client, headers_user1, refresh_trip.json()["job_id"])
    assert trip_job["status"] == "SUCCEEDED"
    assert trip_job["result"]["summary"]["scanned"] >= 1


def test_partial_provider_failure_and_live_only_missing_credentials(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Provider fallback")

    mixed = _submit_transport_search(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_day_id=None,
        providers=["mock_transport", "amadeus_transport"],
    )
    assert mixed["status_code"] == 202
    mixed_job = _wait_for_job(api_client, headers_user1, mixed["body"]["job_id"])
    assert mixed_job["status"] == "SUCCEEDED"
    assert mixed_job["result"]["summary"]["created"] >= 1
    assert any(err["provider"] == "amadeus_transport" for err in mixed_job["result"]["errors"])

    amadeus_live_only = _submit_transport_search(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_day_id=None,
        providers=["amadeus_transport"],
        transport_modes=["flight"],
    )
    assert amadeus_live_only["status_code"] in {202, 503}
    if amadeus_live_only["status_code"] == 503:
        assert amadeus_live_only["status_code"] == 503
        assert amadeus_live_only["body"]["error"]["code"] == "INTEGRATION_NOT_CONFIGURED"
        missing_vars = set(amadeus_live_only["body"]["error"]["details"]["missing_env_vars"])
        assert "VOYAGER_FLIGHTS_AMADEUS_CLIENT_ID" in missing_vars
        assert "VOYAGER_FLIGHTS_AMADEUS_CLIENT_SECRET" in missing_vars

    amadeus_lodging_live_only = _submit_lodging_search(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_day_id=None,
        providers=["amadeus_lodging"],
        lodging_types=["hotel"],
    )
    assert amadeus_lodging_live_only["status_code"] in {202, 503}
    if amadeus_lodging_live_only["status_code"] == 503:
        assert amadeus_lodging_live_only["body"]["error"]["code"] == "INTEGRATION_NOT_CONFIGURED"
        missing_vars = set(amadeus_lodging_live_only["body"]["error"]["details"]["missing_env_vars"])
        assert "VOYAGER_FLIGHTS_AMADEUS_CLIENT_ID" in missing_vars
        assert "VOYAGER_FLIGHTS_AMADEUS_CLIENT_SECRET" in missing_vars


def test_offers_submission_user_rate_limit_and_provider_limited_degradation(
    api_client, headers_user1
):
    trip = _create_trip(api_client, headers_user1, title="Rate limit + provider throttle")

    limited_submit = _submit_transport_search(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_day_id=None,
        providers=["mock_transport"],
        constraints={"force_provider_limited": "mock_transport"},
    )
    assert limited_submit["status_code"] == 202
    limited_job = _wait_for_job(api_client, headers_user1, limited_submit["body"]["job_id"])
    assert limited_job["status"] == "FAILED"
    assert limited_job["error"]["code"] == "UPSTREAM_PROVIDER_ERROR"

    status_codes = []
    for _ in range(30):
        response = api_client.post(
            "/offers/transport/search",
            headers=headers_user1 | {"Idempotency-Key": f"p4-rl-{uuid.uuid4()}"},
            json={
                "trip_id": trip["id"],
                "origin_text": "Paris",
                "destination_text": "Barcelona",
                "depart_date": "2026-12-02",
                "providers": ["amadeus_transport"],
            },
        )
        status_codes.append(response.status_code)
        if response.status_code == 429:
            break

    assert 429 in status_codes
