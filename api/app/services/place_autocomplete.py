from app.models.places import DestinationAutocompleteItem
from app.services.google_maps import (
    search_destination_suggestions as search_google_destination_suggestions,
)


async def search_destination_suggestions(q: str, limit: int) -> list[DestinationAutocompleteItem]:
    return await search_google_destination_suggestions(q, limit)
