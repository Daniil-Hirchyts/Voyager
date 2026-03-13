from __future__ import annotations

from dataclasses import dataclass
from datetime import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Activity, ActivityCategory, Trip, TripDay


@dataclass(frozen=True)
class EditorialActivitySeed:
    category: ActivityCategory
    title: str
    description: str | None
    start_time: time
    duration_min: int


EditorialTripTemplate = tuple[tuple[EditorialActivitySeed, ...], ...]


def _at(hour: int, minute: int = 0) -> time:
    return time(hour, minute)


def _visit(title: str, description: str, *, hour: int, minute: int = 0, duration: int = 120):
    return EditorialActivitySeed(
        category=ActivityCategory.VISIT,
        title=title,
        description=description,
        start_time=_at(hour, minute),
        duration_min=duration,
    )


def _eat(title: str, description: str, *, hour: int, minute: int = 0, duration: int = 90):
    return EditorialActivitySeed(
        category=ActivityCategory.EAT,
        title=title,
        description=description,
        start_time=_at(hour, minute),
        duration_min=duration,
    )


def _activity(
    title: str,
    description: str,
    *,
    hour: int,
    minute: int = 0,
    duration: int = 120,
):
    return EditorialActivitySeed(
        category=ActivityCategory.ACTIVITY,
        title=title,
        description=description,
        start_time=_at(hour, minute),
        duration_min=duration,
    )


def _day(*items: EditorialActivitySeed) -> tuple[EditorialActivitySeed, ...]:
    return items


EDITORIAL_ROUTE_TEMPLATES: dict[str, EditorialTripTemplate] = {
    "kyoto-lantern-week": (
        _day(
            _eat(
                "Nishiki Market breakfast crawl",
                "Ease into Kyoto with a slow breakfast loop through tea counters and market stalls.",
                hour=9,
            ),
            _visit(
                "Higashiyama lanes and temple approach",
                "Walk the stone lanes around Kiyomizu-dera before the late afternoon crowds build.",
                hour=13,
                minute=30,
                duration=150,
            ),
            _eat(
                "Gion kaiseki dinner",
                "Keep the first evening polished with a long seasonal dinner in Gion.",
                hour=19,
                duration=120,
            ),
        ),
        _day(
            _visit(
                "Fushimi Inari dawn walk",
                "Start early for the torii climb while the mountain still feels quiet.",
                hour=8,
                duration=135,
            ),
            _activity(
                "Fushimi sake district tasting",
                "Use the afternoon for cellar rooms, tastings, and a slower river edge reset.",
                hour=13,
                minute=30,
            ),
            _eat(
                "Pontocho lantern dinner",
                "Return to central Kyoto for a narrow-lane dinner under the evening lights.",
                hour=19,
            ),
        ),
        _day(
            _visit(
                "Arashiyama bamboo and garden loop",
                "Pair the bamboo grove with temple gardens and a quieter riverside stretch.",
                hour=8,
                duration=150,
            ),
            _eat(
                "Katsura River lunch stop",
                "Keep lunch simple and scenic before drifting through the western district.",
                hour=13,
                minute=0,
            ),
            _activity(
                "Onsen and early night reset",
                "Trade checklists for a longer soak and a quieter Kyoto evening.",
                hour=18,
                minute=30,
                duration=120,
            ),
        ),
        _day(
            _activity(
                "Nishijin craft studio session",
                "Spend the morning inside textile and craft studios instead of another temple run.",
                hour=9,
            ),
            _activity(
                "Tea ceremony in a machiya townhouse",
                "Let the afternoon slow down with tea, etiquette, and a more intimate setting.",
                hour=14,
                duration=105,
            ),
            _visit(
                "Temple illumination evening",
                "Use one of the late openings for a quieter temple visit after dark.",
                hour=19,
                duration=105,
            ),
        ),
        _day(
            _visit(
                "Uji riverside and matcha morning",
                "Take a lighter day south for tea houses, riverside walks, and a focused side trip.",
                hour=9,
                duration=150,
            ),
            _eat(
                "Matcha lunch and sweets pause",
                "Build in time for soba, parfaits, and a slower reset before heading back.",
                hour=13,
                minute=30,
            ),
            _eat(
                "Pacer dinner by the Kamo River",
                "Keep the evening open enough for a river walk before dinner.",
                hour=19,
            ),
        ),
        _day(
            _visit(
                "Philosopher's Path start",
                "Take the canal route first thing and keep the pace deliberately light.",
                hour=9,
                duration=135,
            ),
            _activity(
                "Independent cafe and bookstore afternoon",
                "Use the middle of the day for shops, stationery, and a slower neighborhood rhythm.",
                hour=13,
                minute=30,
            ),
            _eat(
                "Small-plate dinner in central Kyoto",
                "Leave room for a longer dinner and a final detour through the side streets.",
                hour=19,
            ),
        ),
        _day(
            _eat(
                "Bakery and market breakfast",
                "Keep the final morning easy with one last market pass and coffee stop.",
                hour=9,
            ),
            _activity(
                "Ceramics and souvenir edit",
                "Use the afternoon for the shops you skipped earlier in the week.",
                hour=13,
                minute=30,
            ),
            _eat(
                "Farewell izakaya night",
                "Finish with a livelier dinner and one last walk through the lantern alleys.",
                hour=19,
            ),
        ),
    ),
    "marrakech-riad-edit": (
        _day(
            _eat(
                "Riad breakfast and rooftop coffee",
                "Start slowly inside the riad before stepping into the medina energy.",
                hour=9,
            ),
            _visit(
                "Medina orientation and souk loop",
                "Use the first afternoon to get your bearings in the souks without overcommitting.",
                hour=13,
                minute=30,
                duration=150,
            ),
            _eat(
                "Courtyard dinner in the medina",
                "Keep the first night atmospheric with a long dinner inside a quieter riad courtyard.",
                hour=19,
                duration=120,
            ),
        ),
        _day(
            _visit(
                "Majorelle and YSL Museum morning",
                "Lean into the design side of Marrakech before the gardens get busier.",
                hour=9,
                duration=135,
            ),
            _activity(
                "Gueliz gallery and design shop edit",
                "Shift out of the old city for a more contemporary afternoon of interiors and fashion.",
                hour=13,
                minute=30,
            ),
            _activity(
                "Hammam reset",
                "Trade one sightseeing block for a proper hammam and recovery window.",
                hour=18,
                minute=30,
                duration=120,
            ),
        ),
        _day(
            _eat(
                "Spice breakfast and pastry run",
                "Keep the morning local with msemen, coffee, and a lighter medina detour.",
                hour=9,
            ),
            _visit(
                "Bahia Palace and artisan courtyards",
                "Pair palace rooms with nearby workshops rather than chasing every headline site.",
                hour=13,
                minute=0,
                duration=150,
            ),
            _eat(
                "Rooftop dinner over Jemaa el-Fnaa",
                "Use sunset as the cue for a longer rooftop dinner while the square fills in below.",
                hour=19,
                duration=120,
            ),
        ),
        _day(
            _activity(
                "Atlas foothill drive",
                "Give the route one full scenic day outside the city for air, views, and a reset.",
                hour=9,
                duration=180,
            ),
            _eat(
                "Mountain lunch with a long pause",
                "Keep the middle of the day loose enough to actually enjoy the detour.",
                hour=13,
                minute=30,
                duration=105,
            ),
            _eat(
                "Easy dinner back at the riad",
                "Come back lighter after the drive instead of forcing another big night.",
                hour=19,
            ),
        ),
        _day(
            _activity(
                "Agafay edge-of-desert day",
                "Swap the city texture for stone desert light, a pool stop, and open space.",
                hour=9,
                duration=180,
            ),
            _eat(
                "Lunch under canvas",
                "Make the midday break part of the day rather than just a transit stop.",
                hour=13,
                minute=30,
            ),
            _eat(
                "Late dinner in Hivernage",
                "Return for a more polished dinner and a gentler city re-entry.",
                hour=20,
                duration=120,
            ),
        ),
        _day(
            _eat(
                "Pastry breakfast and one last souk run",
                "Use the final morning for the stalls and shops worth revisiting.",
                hour=9,
            ),
            _activity(
                "Textiles and leather edit",
                "Keep the last afternoon focused on fewer, better design stops.",
                hour=13,
                minute=30,
            ),
            _eat(
                "Farewell tasting menu",
                "Finish with a longer dinner that leans into the city's richer flavors.",
                hour=19,
                duration=120,
            ),
        ),
    ),
    "reykjavik-midnight-route": (
        _day(
            _eat(
                "Harbor coffee and bakery start",
                "Begin softly in Reykjavik with coffee, pastries, and a slow harbor walk.",
                hour=9,
            ),
            _visit(
                "Hallgrimskirkja to design district walk",
                "Use the first afternoon for an easy city orientation across shops and landmark stops.",
                hour=13,
                minute=30,
                duration=150,
            ),
            _eat(
                "Harbor seafood dinner",
                "Keep the first night simple and local with a long dinner near the water.",
                hour=19,
                duration=120,
            ),
        ),
        _day(
            _activity(
                "Sky Lagoon reset",
                "Let the morning belong to the lagoon and a slower start rather than another drive.",
                hour=9,
                duration=150,
            ),
            _visit(
                "Harpa and waterfront cultural stops",
                "Use the afternoon for architecture, galleries, and a lighter city loop.",
                hour=13,
                minute=30,
            ),
            _eat(
                "Wine bar dinner in central Reykjavik",
                "Keep the evening compact so the day still feels restorative.",
                hour=19,
            ),
        ),
        _day(
            _activity(
                "South Coast scenic drive",
                "Commit one day to the black-sand and waterfall route instead of compressing it.",
                hour=8,
                duration=210,
            ),
            _visit(
                "Waterfall and beach stops",
                "Build in enough time for the key pull-offs rather than rushing through the route.",
                hour=13,
                minute=30,
                duration=150,
            ),
            _eat(
                "Late dinner back in the city",
                "Return to Reykjavik for a slower dinner after the road day.",
                hour=20,
                duration=105,
            ),
        ),
        _day(
            _activity(
                "Golden Circle thermal route",
                "Use another day for the classic loop, but keep the pace tailored and comfortable.",
                hour=8,
                duration=210,
            ),
            _eat(
                "Greenhouse lunch stop",
                "Turn lunch into part of the route rather than a quick necessity.",
                hour=13,
                minute=30,
            ),
            _activity(
                "Evening geothermal soak",
                "Finish the loop with one more swim instead of another dense city plan.",
                hour=19,
                duration=120,
            ),
        ),
        _day(
            _activity(
                "Snaefellsnes peninsula outing",
                "Give the west side a full day for wider landscapes and fewer decisions.",
                hour=8,
                duration=210,
            ),
            _visit(
                "Cliff and fishing village stops",
                "Use the afternoon for a few scenic pauses instead of trying to see everything.",
                hour=13,
                minute=30,
                duration=150,
            ),
            _eat(
                "Quiet neighborhood dinner",
                "Keep the return simple with one good dinner and an early night.",
                hour=19,
            ),
        ),
        _day(
            _visit(
                "Bookshops and studio cafes",
                "Slow the itinerary down with a city day that still feels distinctly Reykjavik.",
                hour=9,
                duration=135,
            ),
            _activity(
                "Harbor-side tasting and design stops",
                "Use the afternoon for local shops, tastings, and a little drift.",
                hour=13,
                minute=30,
            ),
            _eat(
                "Tasting-menu dinner",
                "Save one longer dinner for the end of the week while the city still feels easy.",
                hour=19,
                duration=135,
            ),
        ),
        _day(
            _eat(
                "Bakery breakfast and shoreline air",
                "Keep the last morning light and local instead of scheduling another excursion.",
                hour=9,
            ),
            _activity(
                "Final swim and packing window",
                "Leave space for one last spa stop before the route closes out.",
                hour=13,
                minute=30,
                duration=120,
            ),
            _eat(
                "Farewell harbor table",
                "Finish with a final waterfront dinner while the light still stretches late.",
                hour=19,
            ),
        ),
    ),
    "santorini-blue-hour": (
        _day(
            _eat(
                "Cliffside brunch on arrival",
                "Start with a slower first meal and settle into the caldera pace.",
                hour=10,
            ),
            _visit(
                "Fira to Imerovigli orientation walk",
                "Use the first afternoon for a long caldera walk instead of chasing every viewpoint.",
                hour=14,
                duration=150,
            ),
            _eat(
                "First-night terrace dinner",
                "Keep the opening dinner long and easy with the view doing most of the work.",
                hour=19,
                duration=120,
            ),
        ),
        _day(
            _visit(
                "Oia blue-hour route scouting",
                "See Oia earlier in the day, then circle back for the better light and fewer crowds.",
                hour=9,
                duration=135,
            ),
            _activity(
                "Boutiques and gallery pauses",
                "Use the midday stretch for smaller shops and a slower village edit.",
                hour=13,
                minute=30,
            ),
            _eat(
                "Seafood dinner above Ammoudi",
                "Finish the day with a water-facing dinner and a slower return uphill.",
                hour=19,
                duration=120,
            ),
        ),
        _day(
            _activity(
                "Catamaran swim day",
                "Give one day fully to the boat route, the swim stops, and not much else.",
                hour=10,
                duration=210,
            ),
            _eat(
                "Lunch on the water",
                "Keep the middle of the day attached to the sail rather than rushing back ashore.",
                hour=13,
                minute=30,
                duration=90,
            ),
            _eat(
                "Late wine bar evening",
                "Come back lighter with a shorter evening built around drinks and the view.",
                hour=20,
                duration=90,
            ),
        ),
        _day(
            _visit(
                "Pyrgos village morning",
                "Trade the caldera edge for a quieter inland village and a slower climb.",
                hour=9,
                duration=120,
            ),
            _activity(
                "Winery cliff tasting",
                "Use the afternoon for one strong tasting stop instead of a packed circuit.",
                hour=14,
                duration=120,
            ),
            _eat(
                "Candlelit dinner in Fira",
                "Return to town for a more dressed-up evening after the tasting.",
                hour=19,
                duration=120,
            ),
        ),
        _day(
            _visit(
                "Akrotiri ruins and south coast",
                "Give the day some structure with the ruins before drifting toward the beaches.",
                hour=9,
                duration=135,
            ),
            _activity(
                "Beach club and swim window",
                "Keep the afternoon deliberately loose and weather-dependent.",
                hour=14,
                duration=150,
            ),
            _eat(
                "Sunset dinner with a slower finish",
                "Save the evening for a final long table rather than another activity block.",
                hour=19,
                duration=120,
            ),
        ),
        _day(
            _eat(
                "Bakery breakfast in the village",
                "Keep the last morning simple before squeezing in the final view stops.",
                hour=9,
            ),
            _activity(
                "Last swim and shopping edit",
                "Use the final afternoon for a shorter dip and the shops you skipped earlier.",
                hour=13,
                minute=30,
                duration=120,
            ),
            _eat(
                "Farewell lunch stretching into evening",
                "Let the last meal drift long enough to close the route gently.",
                hour=18,
                minute=30,
                duration=120,
            ),
        ),
    ),
    "cape-town-peninsula-cut": (
        _day(
            _eat(
                "Sea Point breakfast and promenade",
                "Ease in with coffee, sea air, and a light first read on the city.",
                hour=9,
            ),
            _visit(
                "V&A Waterfront orientation",
                "Use the first afternoon to get your bearings without committing to a big excursion.",
                hour=13,
                minute=30,
                duration=135,
            ),
            _eat(
                "Kloof Street dinner",
                "Keep the first night central with one strong dinner and an early return.",
                hour=19,
                duration=105,
            ),
        ),
        _day(
            _visit(
                "Table Mountain morning",
                "Go up early for clearer light and a calmer start to one of the signature stops.",
                hour=8,
                duration=150,
            ),
            _eat(
                "Oranjezicht Market lunch",
                "Use lunch as part of the day rather than a rushed break between viewpoints.",
                hour=13,
                minute=0,
            ),
            _eat(
                "Camps Bay sunset dinner",
                "Close the day by the water instead of squeezing in another inland stop.",
                hour=19,
                duration=120,
            ),
        ),
        _day(
            _activity(
                "Cape Peninsula drive",
                "Give the peninsula a full day and let the coastal route be the point of the day.",
                hour=8,
                duration=210,
            ),
            _visit(
                "Boulders Beach and cape pull-offs",
                "Build in enough time for the scenic pauses that make the drive worth it.",
                hour=13,
                minute=30,
                duration=150,
            ),
            _eat(
                "Coastal seafood dinner",
                "Keep the evening simple and local after the longest drive day.",
                hour=19,
                duration=105,
            ),
        ),
        _day(
            _activity(
                "Stellenbosch tasting route",
                "Move inland for a polished wine-country day with enough room to slow down.",
                hour=9,
                duration=180,
            ),
            _eat(
                "Long cellar lunch",
                "Treat lunch as part of the tasting arc rather than a quick midpoint stop.",
                hour=13,
                minute=30,
                duration=120,
            ),
            _eat(
                "Back-in-town supper",
                "Return lighter after wine country instead of forcing another elaborate night.",
                hour=19,
            ),
        ),
        _day(
            _visit(
                "Woodstock galleries and studio stops",
                "Spend the morning on the city's more creative edge rather than another scenic loop.",
                hour=9,
                duration=135,
            ),
            _eat(
                "Biscuit Mill style lunch",
                "Keep the middle of the day casual and social.",
                hour=13,
                minute=0,
            ),
            _eat(
                "Chef's counter dinner",
                "Use one evening for a stronger food-led plan while the city energy is still high.",
                hour=19,
                duration=135,
            ),
        ),
        _day(
            _visit(
                "Kirstenbosch garden morning",
                "Take a greener, slower turn through the gardens before the next tasting block.",
                hour=9,
                duration=135,
            ),
            _activity(
                "Constantia wine afternoon",
                "Choose one wine pocket and stay there rather than overloading the route.",
                hour=14,
                duration=120,
            ),
            _eat(
                "Relaxed dinner in the city bowl",
                "Keep the evening easy after another half day on the move.",
                hour=19,
            ),
        ),
        _day(
            _activity(
                "Muizenberg to Kalk Bay coast run",
                "Use the day for a softer coastal route with shops, surf color, and lunch built in.",
                hour=9,
                duration=165,
            ),
            _eat(
                "Harbor lunch in Kalk Bay",
                "Make the midday stop part of the draw instead of just a refuel.",
                hour=13,
                minute=30,
            ),
            _eat(
                "Late dinner back in town",
                "Return for a later dinner after the coast settles down.",
                hour=20,
                duration=105,
            ),
        ),
        _day(
            _eat(
                "Clifton breakfast and last walk",
                "Keep the final morning clean and scenic rather than ambitious.",
                hour=9,
            ),
            _activity(
                "Design shopping and packing window",
                "Use the last afternoon for the stops you saved and a slower close-out.",
                hour=13,
                minute=30,
                duration=120,
            ),
            _eat(
                "Farewell steakhouse night",
                "Finish with one classic Cape Town dinner before the route closes.",
                hour=19,
                duration=120,
            ),
        ),
    ),
    "buenos-aires-late-tables": (
        _day(
            _eat(
                "Palermo brunch start",
                "Ease into the city with a late breakfast and a slower first pass through Palermo.",
                hour=10,
            ),
            _visit(
                "Palermo Soho neighborhood walk",
                "Use the afternoon for boutiques, bookstores, and a first feel for the local pace.",
                hour=14,
                duration=135,
            ),
            _eat(
                "Late parrilla dinner",
                "Start the city properly with a steakhouse table that begins late and runs long.",
                hour=21,
                duration=120,
            ),
        ),
        _day(
            _visit(
                "Recoleta morning circuit",
                "Keep the morning on the cemetery, museums, and the statelier side of the city.",
                hour=9,
                duration=150,
            ),
            _eat(
                "Bookstore cafe lunch",
                "Break the day with coffee and lunch inside one of the city's grander reading rooms.",
                hour=13,
                minute=30,
            ),
            _eat(
                "Cocktail bar and small plates",
                "Use the evening for drinks first and dinner second, Buenos Aires style.",
                hour=20,
                duration=120,
            ),
        ),
        _day(
            _visit(
                "San Telmo market wander",
                "Give the neighborhood enough time for antique stalls, side streets, and drift.",
                hour=10,
                duration=135,
            ),
            _activity(
                "Tango atelier or rehearsal room",
                "Keep the afternoon rooted in the city's performance culture without turning it into a rush.",
                hour=15,
                duration=105,
            ),
            _eat(
                "Wine-led dinner in San Telmo",
                "Stay local for the evening and let the neighborhood carry the mood.",
                hour=21,
                duration=120,
            ),
        ),
        _day(
            _visit(
                "La Boca early color walk",
                "Go earlier for better light and less friction before the area fills out.",
                hour=9,
                duration=120,
            ),
            _eat(
                "Puerto Madero lunch",
                "Shift the pace with a waterfront lunch and a cleaner midday reset.",
                hour=13,
                minute=30,
            ),
            _activity(
                "Theater evening on Corrientes",
                "Keep one night for a show and the late energy around the avenue.",
                hour=20,
                duration=150,
            ),
        ),
        _day(
            _visit(
                "Chacarita and Colegiales cafe route",
                "Take the morning into neighborhoods that feel less polished and more lived-in.",
                hour=10,
                duration=135,
            ),
            _activity(
                "Design boutiques and record shops",
                "Use the afternoon for smaller finds instead of another marquee attraction.",
                hour=15,
                duration=105,
            ),
            _eat(
                "Neighborhood bodega dinner",
                "Keep the night grounded with a less formal dinner and good wine.",
                hour=21,
                duration=120,
            ),
        ),
        _day(
            _activity(
                "Tigre delta day trip",
                "Break the city rhythm with a river day that still feels social and easy.",
                hour=9,
                duration=180,
            ),
            _eat(
                "Long riverside lunch",
                "Let lunch stretch out before heading back toward the city.",
                hour=13,
                minute=30,
                duration=120,
            ),
            _eat(
                "Palermo late table",
                "Return for one more proper late dinner in the neighborhood that does it best.",
                hour=21,
                duration=120,
            ),
        ),
        _day(
            _eat(
                "Medialunas and coffee morning",
                "Keep the last morning simple and local with a final bakery stop.",
                hour=10,
            ),
            _activity(
                "Souvenir run and vermouth pause",
                "Use the last afternoon for the shops and bars you meant to revisit.",
                hour=15,
                duration=105,
            ),
            _eat(
                "Farewell dinner with a midnight finish",
                "Close the trip in the rhythm the city taught you all week.",
                hour=21,
                duration=135,
            ),
        ),
    ),
}


def _normalize_route_id(route_id: str) -> str:
    return route_id.strip().casefold()


def has_editorial_route_template(route_id: str | None) -> bool:
    if not isinstance(route_id, str):
        return False
    return _normalize_route_id(route_id) in EDITORIAL_ROUTE_TEMPLATES


async def seed_editorial_route_template(
    db: AsyncSession,
    *,
    trip: Trip,
    route_id: str,
) -> None:
    template = EDITORIAL_ROUTE_TEMPLATES[_normalize_route_id(route_id)]
    day_rows = await db.execute(
        select(TripDay).where(TripDay.trip_id == trip.id).order_by(TripDay.day_index.asc())
    )
    days = list(day_rows.scalars().all())

    for day, day_template in zip(days, template):
        for order_index, item in enumerate(day_template):
            db.add(
                Activity(
                    trip_id=trip.id,
                    trip_day_id=day.id,
                    order_index=order_index,
                    category=item.category,
                    category_details_json={},
                    title=item.title,
                    description=item.description,
                    start_time=item.start_time,
                    duration_min=item.duration_min,
                    estimated_cost_amount=None,
                    estimated_cost_currency=None,
                    place_id=None,
                    event_snapshot_id=None,
                    notes=None,
                    is_favorite=False,
                    visited_at=None,
                    source="generated",
                )
            )

    await db.flush()
