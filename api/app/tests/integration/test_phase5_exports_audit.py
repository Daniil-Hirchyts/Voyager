import re
import time
import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.phase5]


def _create_trip(api_client, headers, *, title: str) -> dict:
    response = api_client.post(
        "/trips",
        headers=headers | {"Idempotency-Key": f"p5-trip-{uuid.uuid4()}"},
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


def _create_place(
    api_client,
    headers,
    *,
    name: str,
    lat: float,
    lon: float,
    address_text: str,
    category: str = "poi",
) -> dict:
    response = api_client.post(
        "/places",
        headers=headers | {"Idempotency-Key": f"p5-place-{uuid.uuid4()}"},
        json={
            "source": "phase5",
            "external_id": None,
            "name": name,
            "category": category,
            "address_text": address_text,
            "lat": lat,
            "lon": lon,
            "metadata": {},
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


def _submit_export(
    api_client,
    headers,
    *,
    trip_id: str,
    trip_version: int,
    format_name: str,
    idempotency_key: str | None = None,
):
    return api_client.post(
        f"/trips/{trip_id}/exports",
        headers=headers
        | {
            "Idempotency-Key": idempotency_key or f"p5-export-{uuid.uuid4()}",
            "If-Match": str(trip_version),
        },
        json={"format": format_name},
    )


def _extract_pdf_text(pdf_bytes: bytes) -> str:
    match = re.search(br"stream\n(.*?)\nendstream", pdf_bytes, flags=re.DOTALL)
    assert match is not None, "PDF stream not found"
    stream = match.group(1).decode("utf-8")
    chunks = re.findall(r"\((.*?)\)\sTj", stream)
    normalized = [chunk.replace("\\(", "(").replace("\\)", ")").replace("\\\\", "\\") for chunk in chunks]
    return "\n".join(normalized)


def test_export_submit_poll_metadata_and_content(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase5 export flow")
    submit = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=trip["version"],
        format_name="json",
    )
    assert submit.status_code == 202
    job = _wait_for_job(api_client, headers_user1, submit.json()["job_id"])
    assert job["status"] == "SUCCEEDED"

    export_id = job["result"]["export_id"]
    metadata = api_client.get(f"/exports/{export_id}", headers=headers_user1)
    assert metadata.status_code == 200
    metadata_json = metadata.json()
    assert metadata_json["status"] == "SUCCEEDED"
    assert metadata_json["download_url"] == f"/exports/{export_id}/content"
    assert metadata_json["format"] == "json"
    assert metadata_json["size_bytes"] > 0

    content = api_client.get(f"/exports/{export_id}/content", headers=headers_user1)
    assert content.status_code == 200
    assert content.headers["content-type"].startswith("application/json")
    assert content.text.strip().startswith("{")
    assert "offers" not in content.json()


def test_export_content_includes_locations_and_richer_formats(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase5 rich export")
    day_id = _list_days(api_client, headers_user1, trip["id"])[0]["id"]
    place = _create_place(
        api_client,
        headers_user1,
        name="Time Out Market",
        lat=38.7071,
        lon=-9.1453,
        address_text="Avenida 24 de Julho 49, Lisbon",
        category="food_hall",
    )

    activity = api_client.post(
        f"/days/{day_id}/activities",
        headers=headers_user1 | {"Idempotency-Key": f"p5-rich-activity-{uuid.uuid4()}"},
        json={
            "title": "Breakfast at Time Out Market",
            "source": "manual",
            "category": "eat",
            "description": "Start the morning with a tasting stop at the market.",
            "notes": "Try the local pastries before the crowds build.",
            "place_id": place["id"],
            "start_time": "08:30",
            "duration_min": 90,
            "estimated_cost_amount": 18,
            "estimated_cost_currency": "EUR",
        },
    )
    assert activity.status_code == 201
    current_trip = api_client.get(f"/trips/{trip['id']}", headers=headers_user1)
    assert current_trip.status_code == 200
    current_version = current_trip.json()["version"]

    json_submit = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=current_version,
        format_name="json",
    )
    json_job = _wait_for_job(api_client, headers_user1, json_submit.json()["job_id"])
    assert json_job["status"] == "SUCCEEDED"
    json_content = api_client.get(
        f"/exports/{json_job['result']['export_id']}/content",
        headers=headers_user1,
    )
    assert json_content.status_code == 200
    assert '\n  "days": [' in json_content.text
    payload = json_content.json()
    exported_activity = payload["days"][0]["activities"][0]
    assert exported_activity["location"]["name"] == "Time Out Market"
    assert exported_activity["location"]["address_text"] == "Avenida 24 de Julho 49, Lisbon"
    assert exported_activity["location"]["lat"] == pytest.approx(38.7071)
    assert exported_activity["cost_label"] == "18.00 EUR"

    ics_submit = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=current_version,
        format_name="ics",
    )
    ics_job = _wait_for_job(api_client, headers_user1, ics_submit.json()["job_id"])
    assert ics_job["status"] == "SUCCEEDED"
    ics_content = api_client.get(
        f"/exports/{ics_job['result']['export_id']}/content",
        headers=headers_user1,
    )
    assert ics_content.status_code == 200
    assert "LOCATION:Time Out Market" in ics_content.text
    assert "GEO:38.707100;-9.145300" in ics_content.text
    assert "Budget: 18.00 EUR" in ics_content.text

    pdf_submit = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=current_version,
        format_name="pdf",
    )
    pdf_job = _wait_for_job(api_client, headers_user1, pdf_submit.json()["job_id"])
    assert pdf_job["status"] == "SUCCEEDED"
    pdf_content = api_client.get(
        f"/exports/{pdf_job['result']['export_id']}/content",
        headers=headers_user1,
    )
    assert pdf_content.status_code == 200
    pdf_text = _extract_pdf_text(pdf_content.content)
    assert "Breakfast at Time Out Market" in pdf_text
    assert "Location: Time Out Market, Avenida 24 de Julho 49, Lisbon" in pdf_text
    assert "Notes: Try the local pastries before the crowds build." in pdf_text


def test_stale_if_match_conflict_and_no_job_created(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase5 stale export")

    jobs_before = api_client.get("/jobs?limit=500&offset=0", headers=headers_user1)
    assert jobs_before.status_code == 200
    total_before = jobs_before.json()["total"]

    stale_submit = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=trip["version"] - 1,
        format_name="json",
    )
    assert stale_submit.status_code == 409
    assert stale_submit.json()["error"]["code"] == "CONFLICT_VERSION_MISMATCH"

    jobs_after = api_client.get("/jobs?limit=500&offset=0", headers=headers_user1)
    assert jobs_after.status_code == 200
    assert jobs_after.json()["total"] == total_before


def test_export_idempotency_replays_same_job(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase5 idempotency")
    idem_key = f"p5-export-idem-{uuid.uuid4()}"

    first = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=trip["version"],
        format_name="ics",
        idempotency_key=idem_key,
    )
    second = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=trip["version"],
        format_name="ics",
        idempotency_key=idem_key,
    )
    assert first.status_code == 202
    assert second.status_code == 202
    assert first.json()["job_id"] == second.json()["job_id"]


def test_export_determinism_json_ics_pdf(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase5 determinism")

    # JSON determinism by hash
    json_submit_1 = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=trip["version"],
        format_name="json",
    )
    json_job_1 = _wait_for_job(api_client, headers_user1, json_submit_1.json()["job_id"])
    assert json_job_1["status"] == "SUCCEEDED"

    json_submit_2 = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=trip["version"],
        format_name="json",
    )
    json_job_2 = _wait_for_job(api_client, headers_user1, json_submit_2.json()["job_id"])
    assert json_job_2["status"] == "SUCCEEDED"
    assert json_job_1["result"]["sha256"] == json_job_2["result"]["sha256"]

    # ICS determinism by hash
    ics_submit_1 = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=trip["version"],
        format_name="ics",
    )
    ics_job_1 = _wait_for_job(api_client, headers_user1, ics_submit_1.json()["job_id"])
    assert ics_job_1["status"] == "SUCCEEDED"

    ics_submit_2 = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=trip["version"],
        format_name="ics",
    )
    ics_job_2 = _wait_for_job(api_client, headers_user1, ics_submit_2.json()["job_id"])
    assert ics_job_2["status"] == "SUCCEEDED"
    assert ics_job_1["result"]["sha256"] == ics_job_2["result"]["sha256"]

    # PDF semantic determinism by extracted text
    pdf_submit_1 = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=trip["version"],
        format_name="pdf",
    )
    pdf_job_1 = _wait_for_job(api_client, headers_user1, pdf_submit_1.json()["job_id"])
    assert pdf_job_1["status"] == "SUCCEEDED"

    pdf_submit_2 = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=trip["version"],
        format_name="pdf",
    )
    pdf_job_2 = _wait_for_job(api_client, headers_user1, pdf_submit_2.json()["job_id"])
    assert pdf_job_2["status"] == "SUCCEEDED"

    pdf_export_1 = pdf_job_1["result"]["export_id"]
    pdf_export_2 = pdf_job_2["result"]["export_id"]
    pdf_content_1 = api_client.get(f"/exports/{pdf_export_1}/content", headers=headers_user1)
    pdf_content_2 = api_client.get(f"/exports/{pdf_export_2}/content", headers=headers_user1)
    assert pdf_content_1.status_code == 200
    assert pdf_content_2.status_code == 200
    assert _extract_pdf_text(pdf_content_1.content) == _extract_pdf_text(pdf_content_2.content)


def test_audit_logs_capture_mutations_and_filters(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase5 audit coverage")
    day_id = _list_days(api_client, headers_user1, trip["id"])[0]["id"]

    patch_day = api_client.patch(
        f"/days/{day_id}",
        headers=headers_user1,
        json={"notes": "Audit day notes"},
    )
    assert patch_day.status_code == 200

    created_activity = api_client.post(
        f"/days/{day_id}/activities",
        headers=headers_user1 | {"Idempotency-Key": f"p5-act-create-{uuid.uuid4()}"},
        json={"title": "Audit activity", "source": "manual"},
    )
    assert created_activity.status_code == 201
    activity_id = created_activity.json()["id"]

    patched_activity = api_client.patch(
        f"/activities/{activity_id}",
        headers=headers_user1,
        json={"notes": "Changed by audit test", "is_favorite": True},
    )
    assert patched_activity.status_code == 200

    deleted_activity = api_client.delete(f"/activities/{activity_id}", headers=headers_user1)
    assert deleted_activity.status_code == 204

    audit_all = api_client.get(
        f"/trips/{trip['id']}/audit?limit=500&offset=0",
        headers=headers_user1,
    )
    assert audit_all.status_code == 200
    payload = audit_all.json()
    assert payload["total"] >= 1
    assert all(item["correlation_id"] for item in payload["items"])

    audit_activity = api_client.get(
        f"/trips/{trip['id']}/audit?entity_type=activity&limit=500&offset=0",
        headers=headers_user1,
    )
    assert audit_activity.status_code == 200
    actions = {item["action"] for item in audit_activity.json()["items"]}
    assert {"INSERT", "UPDATE", "DELETE"}.issubset(actions)

    audit_updates = api_client.get(
        f"/trips/{trip['id']}/audit?action=UPDATE&limit=500&offset=0",
        headers=headers_user1,
    )
    assert audit_updates.status_code == 200
    assert all(item["action"] == "UPDATE" for item in audit_updates.json()["items"])


def test_export_and_audit_are_owner_scoped(api_client, headers_user1, headers_user2):
    trip = _create_trip(api_client, headers_user1, title="Phase5 ownership")
    submit = _submit_export(
        api_client,
        headers_user1,
        trip_id=trip["id"],
        trip_version=trip["version"],
        format_name="json",
    )
    job = _wait_for_job(api_client, headers_user1, submit.json()["job_id"])
    assert job["status"] == "SUCCEEDED"
    export_id = job["result"]["export_id"]

    foreign_export = api_client.get(f"/exports/{export_id}", headers=headers_user2)
    assert foreign_export.status_code in (403, 404)

    foreign_export_content = api_client.get(f"/exports/{export_id}/content", headers=headers_user2)
    assert foreign_export_content.status_code in (403, 404)

    foreign_audit = api_client.get(f"/trips/{trip['id']}/audit", headers=headers_user2)
    assert foreign_audit.status_code in (403, 404)


def test_export_submit_rate_limit_and_metrics(api_client, headers_user1):
    trip = _create_trip(api_client, headers_user1, title="Phase5 limiter")
    statuses: list[int] = []
    for _ in range(30):
        response = _submit_export(
            api_client,
            headers_user1,
            trip_id=trip["id"],
            trip_version=trip["version"],
            format_name="json",
        )
        statuses.append(response.status_code)
        if response.status_code == 429:
            break
    assert 429 in statuses

    metrics = api_client.get("/metrics")
    assert metrics.status_code == 200
    assert "voyager_http_requests_total" in metrics.text
    assert "voyager_worker_jobs_total" in metrics.text
    assert "voyager_job_queue_depth" in metrics.text
