import os
import time
import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.phase2]


def _create_trip(api_client, headers, *, idem_key: str) -> dict:
    response = api_client.post(
        "/trips",
        headers=headers | {"Idempotency-Key": idem_key},
        json={
            "title": "Phase 2 trip",
            "destination_text": "Lisbon",
            "start_date": "2026-11-01",
            "end_date": "2026-11-03",
            "budget_amount": 1100,
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


def _list_activities(api_client, headers, day_id: str) -> list[dict]:
    response = api_client.get(f"/days/{day_id}/activities", headers=headers)
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


def _submit_generate(
    api_client,
    headers,
    *,
    trip_id: str,
    version: int,
    mode: str,
    day_ids: list[str] | None = None,
    constraints: dict | None = None,
    seed: int | None = 7,
    idem_key: str | None = None,
):
    req_headers = headers | {"If-Match": str(version)}
    if idem_key is not None:
        req_headers["Idempotency-Key"] = idem_key
    return api_client.post(
        f"/trips/{trip_id}/generate",
        headers=req_headers,
        json={
            "mode": mode,
            "day_ids": day_ids,
            "constraints": constraints or {},
            "seed": seed,
        },
    )


def _submit_reset(
    api_client,
    headers,
    *,
    trip_id: str,
    version: int,
    day_ids: list[str],
    idem_key: str,
):
    return api_client.post(
        f"/trips/{trip_id}/reset-itinerary",
        headers=headers | {"If-Match": str(version), "Idempotency-Key": idem_key},
        json={"day_ids": day_ids},
    )


def _trip_version(api_client, headers, trip_id: str) -> int:
    response = api_client.get(f"/trips/{trip_id}", headers=headers)
    assert response.status_code == 200
    return int(response.json()["version"])


def test_generate_returns_202_and_reaches_succeeded(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, idem_key=f"p2-trip-{uuid.uuid4()}")
    days = _list_days(api_client, headers_user1, trip["id"])

    response = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=trip["version"],
        mode="replace",
        day_ids=[days[0]["id"]],
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert response.status_code == 202
    job_id = response.json()["job_id"]

    job = _wait_for_job(api_client, headers_user1, job_id)
    assert job["status"] == "SUCCEEDED"
    assert job["result"]["summary"]["created"] >= 3

    activities = _list_activities(api_client, headers_user1, days[0]["id"])
    generated = [item for item in activities if item["source"] == "generated"]
    assert len(generated) == 3


def test_generate_stale_if_match_returns_409_and_creates_no_job(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, idem_key=f"p2-trip-{uuid.uuid4()}")
    before_total = api_client.get("/jobs", headers=headers_user1).json()["total"]

    patch = api_client.patch(
        f"/trips/{trip['id']}",
        headers=headers_user1 | {"If-Match": str(trip["version"])},
        json={"title": "Updated trip"},
    )
    assert patch.status_code == 200

    stale = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=trip["version"],
        mode="replace",
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "CONFLICT_VERSION_MISMATCH"

    after_total = api_client.get("/jobs", headers=headers_user1).json()["total"]
    assert before_total == after_total


def test_generate_idempotency_replays_same_job(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, idem_key=f"p2-trip-{uuid.uuid4()}")
    idem_key = f"p2-generate-{uuid.uuid4()}"

    first = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=trip["version"],
        mode="replace",
        idem_key=idem_key,
    )
    second = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=trip["version"],
        mode="replace",
        idem_key=idem_key,
    )

    assert first.status_code == 202
    assert second.status_code == 202
    assert first.json()["job_id"] == second.json()["job_id"]


def test_replace_keeps_manual_and_replaces_generated(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, idem_key=f"p2-trip-{uuid.uuid4()}")
    day_1 = _list_days(api_client, headers_user1, trip["id"])[0]["id"]

    manual = api_client.post(
        f"/days/{day_1}/activities",
        headers=headers_user1 | {"Idempotency-Key": f"p2-manual-{uuid.uuid4()}"},
        json={"title": "User custom plan", "source": "manual", "notes": "keep me"},
    )
    assert manual.status_code == 201

    gen1 = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=_trip_version(api_client, headers_user1, trip["id"]),
        mode="replace",
        day_ids=[day_1],
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert gen1.status_code == 202
    _wait_for_job(api_client, headers_user1, gen1.json()["job_id"])
    activities_after_first = _list_activities(api_client, headers_user1, day_1)
    first_generated_ids = {
        item["id"] for item in activities_after_first if item["source"] == "generated"
    }
    assert len(first_generated_ids) == 3

    gen2 = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=_trip_version(api_client, headers_user1, trip["id"]),
        mode="replace",
        day_ids=[day_1],
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert gen2.status_code == 202
    _wait_for_job(api_client, headers_user1, gen2.json()["job_id"])
    activities_after_second = _list_activities(api_client, headers_user1, day_1)

    manual_rows = [item for item in activities_after_second if item["source"] == "manual"]
    second_generated_ids = {
        item["id"] for item in activities_after_second if item["source"] == "generated"
    }
    assert len(manual_rows) == 1
    assert manual_rows[0]["title"] == "User custom plan"
    assert len(second_generated_ids) == 3
    assert first_generated_ids.isdisjoint(second_generated_ids)


def test_merge_preserves_manual_notes_and_avoids_duplicates(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, idem_key=f"p2-trip-{uuid.uuid4()}")
    day_1 = _list_days(api_client, headers_user1, trip["id"])[0]["id"]

    manual = api_client.post(
        f"/days/{day_1}/activities",
        headers=headers_user1 | {"Idempotency-Key": f"p2-manual-{uuid.uuid4()}"},
        json={
            "title": "Manual anchor",
            "source": "manual",
            "notes": "must stay",
            "is_favorite": True,
            "tags": ["personal"],
        },
    )
    assert manual.status_code == 201

    first = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=_trip_version(api_client, headers_user1, trip["id"]),
        mode="merge",
        day_ids=[day_1],
        seed=99,
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert first.status_code == 202
    _wait_for_job(api_client, headers_user1, first.json()["job_id"])

    second = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=_trip_version(api_client, headers_user1, trip["id"]),
        mode="merge",
        day_ids=[day_1],
        seed=99,
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert second.status_code == 202
    _wait_for_job(api_client, headers_user1, second.json()["job_id"])

    activities = _list_activities(api_client, headers_user1, day_1)
    manual_rows = [item for item in activities if item["source"] == "manual"]
    generated_rows = [item for item in activities if item["source"] == "generated"]
    assert len(manual_rows) == 1
    assert manual_rows[0]["notes"] == "must stay"
    assert manual_rows[0]["is_favorite"] is True
    assert len(generated_rows) == 3


def test_append_inserts_generated_at_tail(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, idem_key=f"p2-trip-{uuid.uuid4()}")
    day_1 = _list_days(api_client, headers_user1, trip["id"])[0]["id"]

    manual = api_client.post(
        f"/days/{day_1}/activities",
        headers=headers_user1 | {"Idempotency-Key": f"p2-manual-{uuid.uuid4()}"},
        json={"title": "Tail anchor", "source": "manual"},
    )
    assert manual.status_code == 201

    append = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=_trip_version(api_client, headers_user1, trip["id"]),
        mode="append",
        day_ids=[day_1],
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert append.status_code == 202
    _wait_for_job(api_client, headers_user1, append.json()["job_id"])

    activities = _list_activities(api_client, headers_user1, day_1)
    assert [item["order_index"] for item in activities] == list(range(len(activities)))
    assert activities[0]["title"] == "Tail anchor"
    assert all(item["source"] == "generated" for item in activities[1:])


def test_reset_itinerary_scoped_days_only(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, idem_key=f"p2-trip-{uuid.uuid4()}")
    days = _list_days(api_client, headers_user1, trip["id"])
    day_1 = days[0]["id"]
    day_2 = days[1]["id"]

    generate = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=trip["version"],
        mode="replace",
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert generate.status_code == 202
    _wait_for_job(api_client, headers_user1, generate.json()["job_id"])

    reset = _submit_reset(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=_trip_version(api_client, headers_user1, trip["id"]),
        day_ids=[day_1],
        idem_key=f"p2-reset-{uuid.uuid4()}",
    )
    assert reset.status_code == 202
    _wait_for_job(api_client, headers_user1, reset.json()["job_id"])

    day_1_items = _list_activities(api_client, headers_user1, day_1)
    day_2_items = _list_activities(api_client, headers_user1, day_2)
    assert len([item for item in day_1_items if item["source"] == "generated"]) == 0
    assert len([item for item in day_2_items if item["source"] == "generated"]) > 0


def test_retry_and_dead_letter_injected_failures(api_client, headers_user1):
    retry_trip = _create_trip(api_client, headers_user1, idem_key=f"p2-trip-{uuid.uuid4()}")
    retry_job_resp = _submit_generate(
        api_client,
        headers_user1,
        trip_id=retry_trip["id"],
        version=retry_trip["version"],
        mode="replace",
        constraints={"force_fail": "retry_once"},
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert retry_job_resp.status_code == 202
    retry_job = _wait_for_job(api_client, headers_user1, retry_job_resp.json()["job_id"])
    assert retry_job["status"] == "SUCCEEDED"
    assert retry_job["attempts"] == 2

    dead_trip = _create_trip(api_client, headers_user1, idem_key=f"p2-trip-{uuid.uuid4()}")
    dead_job_resp = _submit_generate(
        api_client,
        headers_user1,
        trip_id=dead_trip["id"],
        version=dead_trip["version"],
        mode="replace",
        constraints={"force_fail": "always_fail"},
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert dead_job_resp.status_code == 202
    dead_job = _wait_for_job(api_client, headers_user1, dead_job_resp.json()["job_id"])
    assert dead_job["status"] == "FAILED"
    assert dead_job["dead_lettered_at"] is not None
    assert dead_job["error"]["code"] == "ITINERARY_PERMANENT_FAILURE"


def test_generation_and_job_polling_enforce_ownership(api_client, headers_user1, headers_user2):
    trip = _create_trip(api_client, headers_user1, idem_key=f"p2-trip-{uuid.uuid4()}")
    generated = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=trip["version"],
        mode="replace",
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert generated.status_code == 202
    job_id = generated.json()["job_id"]

    foreign_poll = api_client.get(f"/jobs/{job_id}", headers=headers_user2)
    assert foreign_poll.status_code in (403, 404)

    foreign_submit = _submit_generate(
        api_client,
        headers_user2,
        trip_id=trip["id"],
        version=trip["version"],
        mode="replace",
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert foreign_submit.status_code in (403, 404)


@pytest.mark.skipif(
    not os.getenv("VOYAGER_LLM_OPENROUTER_API_KEY"),
    reason="OpenRouter key not configured for compose runtime",
)
def test_generate_reports_openrouter_engine_metadata(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, idem_key=f"p2-trip-{uuid.uuid4()}")
    response = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=trip["version"],
        mode="replace",
        constraints={"llm_mock_mode": "success"},
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert response.status_code == 202
    job = _wait_for_job(api_client, headers_user1, response.json()["job_id"])
    assert job["status"] == "SUCCEEDED"
    assert job["result"]["generator_engine"] == "openrouter"
    assert job["result"]["llm_model"] is not None
    assert job["result"]["fallback_used"] is False
    assert isinstance(job["result"]["provider_errors"], list)


def test_generate_falls_back_to_deterministic_on_provider_error(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, idem_key=f"p2-trip-{uuid.uuid4()}")
    response = _submit_generate(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        version=trip["version"],
        mode="replace",
        constraints={"llm_mock_mode": "provider_error"},
        idem_key=f"p2-generate-{uuid.uuid4()}",
    )
    assert response.status_code == 202
    job = _wait_for_job(api_client, headers_user1, response.json()["job_id"])
    assert job["status"] == "SUCCEEDED"
    assert job["result"]["generator_engine"] == "deterministic"
    assert job["result"]["llm_model"] is None
    assert job["result"]["fallback_used"] is True
    assert isinstance(job["result"]["provider_errors"], list)
    assert len(job["result"]["provider_errors"]) >= 1
