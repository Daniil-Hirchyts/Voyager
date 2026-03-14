from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Place, PlacePhoto, Trip, TripAsset
from app.db.repositories import PlacePhotoRepository
from app.models.trips import TripCoverPhoto, TripCoverPreference, TripCoverPreferencePatchRequest
from app.services.trip_assets import build_trip_asset_access_urls


def parse_trip_cover_preference(raw_value: Any) -> TripCoverPreference | None:
    if not isinstance(raw_value, dict):
        return None

    try:
        preference = TripCoverPreference.model_validate(raw_value)
    except ValidationError:
        return None

    if not any(
        [
            preference.place_id,
            preference.place_label,
            preference.place_lat is not None,
            preference.place_lng is not None,
            preference.photo_id,
            preference.asset_id,
            preference.fallback_image_url,
        ]
    ):
        return None

    return preference


def merge_trip_cover_preference(
    raw_value: Any,
    patch: TripCoverPreferencePatchRequest,
) -> dict[str, Any]:
    current = parse_trip_cover_preference(raw_value) or TripCoverPreference()
    patch_data = patch.model_dump(mode="json", exclude_unset=True)
    merged = current.model_copy(update=patch_data)

    if "place_id" in patch_data:
        next_place_id = patch_data.get("place_id")
        current_place_id = str(current.place_id) if current.place_id is not None else None
        if next_place_id is None or next_place_id != current_place_id:
            merged = merged.model_copy(update={"photo_id": None})

    if patch_data.get("asset_id") is not None:
        merged = merged.model_copy(update={"photo_id": None})

    if patch_data.get("photo_id") is not None:
        merged = merged.model_copy(update={"asset_id": None})

    return merged.model_dump(mode="json", exclude_none=True)


def _cover_photo_from_place_photo(
    *,
    photo: PlacePhoto,
    place_id: uuid.UUID,
) -> TripCoverPhoto:
    summary = PlacePhotoRepository._summary(photo)
    return TripCoverPhoto(
        source="place_photo",
        url=summary.display_url or summary.image_url,
        thumbnail_url=summary.display_thumbnail_url or summary.thumbnail_url,
        photo_id=photo.id,
        place_id=place_id,
        attribution_text=summary.attribution_text,
        is_fallback=False,
    )


def _cover_photo_from_place_photo_summary(
    *,
    photo,
    place_id: uuid.UUID,
) -> TripCoverPhoto:
    return TripCoverPhoto(
        source="place_photo",
        url=photo.display_url or photo.image_url,
        thumbnail_url=photo.display_thumbnail_url or photo.thumbnail_url,
        photo_id=photo.id,
        place_id=place_id,
        attribution_text=photo.attribution_text,
        is_fallback=False,
    )


def _cover_photo_from_trip_asset(asset: TripAsset) -> TripCoverPhoto:
    preview_url, download_url = build_trip_asset_access_urls(
        object_key=asset.object_key,
        thumbnail_object_key=asset.thumbnail_object_key,
        original_filename=asset.original_filename,
    )
    return TripCoverPhoto(
        source="uploaded",
        url=preview_url or download_url,
        thumbnail_url=preview_url or download_url,
        asset_id=asset.id,
        attribution_text=asset.original_filename,
        is_fallback=False,
    )


def _cover_photo_from_fallback(
    *,
    url: str,
    place_id: uuid.UUID | None,
    attribution_text: str | None,
) -> TripCoverPhoto:
    return TripCoverPhoto(
        source="fallback",
        url=url,
        thumbnail_url=url,
        place_id=place_id,
        attribution_text=attribution_text,
        is_fallback=True,
    )


async def resolve_trip_cover_payloads(
    db: AsyncSession,
    trips: Sequence[Trip],
) -> dict[uuid.UUID, tuple[TripCoverPreference | None, TripCoverPhoto | None]]:
    preferences_by_trip: dict[uuid.UUID, TripCoverPreference | None] = {}
    asset_ids: set[uuid.UUID] = set()
    place_ids: set[uuid.UUID] = set()
    selected_photo_ids: set[uuid.UUID] = set()

    for trip in trips:
        preference = parse_trip_cover_preference(trip.cover_preference_json)
        preferences_by_trip[trip.id] = preference
        if preference is None:
            continue
        if preference.asset_id is not None:
            asset_ids.add(preference.asset_id)
        if preference.place_id is not None:
            place_ids.add(preference.place_id)
        if preference.photo_id is not None:
            selected_photo_ids.add(preference.photo_id)

    assets_by_id: dict[uuid.UUID, TripAsset] = {}
    if asset_ids:
        rows = await db.execute(select(TripAsset).where(TripAsset.id.in_(asset_ids)))
        assets_by_id = {item.id: item for item in rows.scalars().all()}

    places_by_id: dict[uuid.UUID, Place] = {}
    if place_ids:
        rows = await db.execute(select(Place).where(Place.id.in_(place_ids)))
        places_by_id = {item.id: item for item in rows.scalars().all()}

    selected_photos_by_id: dict[uuid.UUID, PlacePhoto] = {}
    if selected_photo_ids:
        rows = await db.execute(select(PlacePhoto).where(PlacePhoto.id.in_(selected_photo_ids)))
        selected_photos_by_id = {item.id: item for item in rows.scalars().all()}

    primary_photos_by_place_id = (
        await PlacePhotoRepository.photo_summaries_for_place_ids(db, list(place_ids))
        if place_ids
        else {}
    )

    payloads: dict[uuid.UUID, tuple[TripCoverPreference | None, TripCoverPhoto | None]] = {}
    for trip in trips:
        preference = preferences_by_trip[trip.id]
        cover_photo: TripCoverPhoto | None = None

        if preference is not None and preference.asset_id is not None:
            asset = assets_by_id.get(preference.asset_id)
            if asset is not None and asset.trip_id == trip.id and asset.kind == "photo":
                cover_photo = _cover_photo_from_trip_asset(asset)

        if cover_photo is None and preference is not None and preference.place_id is not None:
            if preference.photo_id is not None:
                selected_photo = selected_photos_by_id.get(preference.photo_id)
                if (
                    selected_photo is not None
                    and selected_photo.place_id == preference.place_id
                ):
                    cover_photo = _cover_photo_from_place_photo(
                        photo=selected_photo,
                        place_id=preference.place_id,
                    )

            if cover_photo is None:
                _count, primary_photo = primary_photos_by_place_id.get(
                    preference.place_id,
                    (0, None),
                )
                if primary_photo is not None:
                    cover_photo = _cover_photo_from_place_photo_summary(
                        photo=primary_photo,
                        place_id=preference.place_id,
                    )

        if (
            cover_photo is None
            and preference is not None
            and preference.fallback_image_url is not None
        ):
            cover_photo = _cover_photo_from_fallback(
                url=preference.fallback_image_url,
                place_id=preference.place_id,
                attribution_text=preference.place_label,
            )

        if cover_photo is None and preference is not None and preference.place_id is not None:
            place = places_by_id.get(preference.place_id)
            metadata = place.metadata_json if place is not None else {}
            seeded_image_url = metadata.get("seeded_image_url") if isinstance(metadata, dict) else None
            if isinstance(seeded_image_url, str) and seeded_image_url.strip():
                cover_photo = _cover_photo_from_fallback(
                    url=seeded_image_url.strip(),
                    place_id=preference.place_id,
                    attribution_text=preference.place_label or (place.name if place else None),
                )

        payloads[trip.id] = (preference, cover_photo)

    return payloads
