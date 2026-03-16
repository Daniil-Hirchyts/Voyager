from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import time
from decimal import Decimal
from typing import Any

from app.db.models import Trip, TripDay

SLOT_ORDER = ("morning", "afternoon", "evening")
SLOT_START_TIMES: dict[str, time] = {
    "morning": time(9, 0),
    "afternoon": time(13, 30),
    "evening": time(19, 0),
}


@dataclass(frozen=True)
class CatalogPlaceSeed:
    slug: str
    name: str
    category: str
    address_text: str | None
    lat: float | None
    lon: float | None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CatalogActivitySeed:
    slug: str
    title: str
    description: str
    tags: tuple[str, ...]
    duration_min: int
    estimated_cost_amount: Decimal | None
    estimated_cost_currency: str | None
    place_seed: CatalogPlaceSeed | None


def _money(amount: str | None, currency: str = "EUR") -> tuple[Decimal | None, str | None]:
    if amount is None:
        return None, None
    return Decimal(amount), currency


def _seed(
    *,
    slug: str,
    title: str,
    description: str,
    tags: tuple[str, ...],
    duration_min: int,
    amount: str | None,
    place: CatalogPlaceSeed | None,
) -> CatalogActivitySeed:
    money, currency = _money(amount)
    return CatalogActivitySeed(
        slug=slug,
        title=title,
        description=description,
        tags=tags,
        duration_min=duration_min,
        estimated_cost_amount=money,
        estimated_cost_currency=currency,
        place_seed=place,
    )


ROME = {
    "morning": [
        _seed(
            slug="rome-colosseum",
            title="Colosseum and Roman Forum circuit",
            description="Start the day at Rome's ancient core with a focused walk around the Colosseum and Forum viewpoints.",
            tags=("history", "landmarks"),
            duration_min=150,
            amount="18.00",
            place=CatalogPlaceSeed(
                slug="colosseum",
                name="Colosseum",
                category="landmark",
                address_text="Piazza del Colosseo, 1, 00184 Roma RM, Italy",
                lat=41.8902,
                lon=12.4922,
                metadata={"website": "https://colosseo.it/"},
            ),
        ),
        _seed(
            slug="rome-pantheon",
            title="Pantheon and piazza coffee stop",
            description="Ease into the morning around the Pantheon with time for an espresso and a slower architectural walk.",
            tags=("architecture", "cafe"),
            duration_min=105,
            amount="8.00",
            place=CatalogPlaceSeed(
                slug="pantheon",
                name="Pantheon",
                category="landmark",
                address_text="Piazza della Rotonda, 00186 Roma RM, Italy",
                lat=41.8986,
                lon=12.4769,
                metadata={"website": "https://www.pantheonroma.com/"},
            ),
        ),
        _seed(
            slug="rome-campo-fiori",
            title="Campo de' Fiori market breakfast loop",
            description="Use the market streets around Campo de' Fiori for an easy first look at central Rome and local produce stalls.",
            tags=("food", "market"),
            duration_min=90,
            amount="14.00",
            place=CatalogPlaceSeed(
                slug="campo-fiori",
                name="Campo de' Fiori",
                category="market_square",
                address_text="Campo de' Fiori, 00186 Roma RM, Italy",
                lat=41.8957,
                lon=12.4722,
                metadata={"website": "https://www.turismoroma.it/en/places/campo-de-fiori"},
            ),
        ),
        _seed(
            slug="rome-trevi",
            title="Trevi Fountain and Quirinale stroll",
            description="Catch the Trevi Fountain before the heavier crowds and continue uphill through the historic center.",
            tags=("walking", "landmarks"),
            duration_min=95,
            amount=None,
            place=CatalogPlaceSeed(
                slug="trevi-fountain",
                name="Trevi Fountain",
                category="fountain",
                address_text="Piazza di Trevi, 00187 Roma RM, Italy",
                lat=41.9009,
                lon=12.4833,
                metadata={"website": "https://www.turismoroma.it/en/places/trevi-fountain"},
            ),
        ),
    ],
    "afternoon": [
        _seed(
            slug="rome-vatican",
            title="Vatican Museums deep dive",
            description="Use the afternoon for a concentrated Vatican Museums visit while keeping the route compact and museum-heavy.",
            tags=("museum", "art"),
            duration_min=180,
            amount="20.00",
            place=CatalogPlaceSeed(
                slug="vatican-museums",
                name="Vatican Museums",
                category="museum",
                address_text="Viale Vaticano, 00165 Roma RM, Italy",
                lat=41.9065,
                lon=12.4536,
                metadata={"website": "https://www.museivaticani.va/"},
            ),
        ),
        _seed(
            slug="rome-villa-borghese",
            title="Villa Borghese and Pincio promenade",
            description="Reset in the greenery of Villa Borghese with a slower walk, terrace viewpoints, and room to linger.",
            tags=("park", "viewpoint"),
            duration_min=135,
            amount=None,
            place=CatalogPlaceSeed(
                slug="villa-borghese",
                name="Villa Borghese",
                category="park",
                address_text="Piazzale Napoleone I, 00197 Roma RM, Italy",
                lat=41.9142,
                lon=12.4923,
                metadata={"website": "https://www.galleriaborghese.beniculturali.it/en/"},
            ),
        ),
        _seed(
            slug="rome-capitoline",
            title="Capitoline Museums and Piazza del Campidoglio",
            description="Keep the afternoon on Capitoline Hill for museum time and one of the city's strongest civic spaces.",
            tags=("museum", "history"),
            duration_min=150,
            amount="15.00",
            place=CatalogPlaceSeed(
                slug="capitoline-museums",
                name="Capitoline Museums",
                category="museum",
                address_text="Piazza del Campidoglio, 1, 00186 Roma RM, Italy",
                lat=41.8932,
                lon=12.4829,
                metadata={"website": "https://www.museicapitolini.org/en"},
            ),
        ),
        _seed(
            slug="rome-trastevere",
            title="Trastevere lane-by-lane neighborhood walk",
            description="Use the afternoon to drift through Trastevere's quieter lanes and pause in its small piazzas.",
            tags=("neighborhood", "walking"),
            duration_min=120,
            amount="12.00",
            place=CatalogPlaceSeed(
                slug="trastevere",
                name="Basilica of Santa Maria in Trastevere",
                category="church",
                address_text="Piazza di Santa Maria in Trastevere, 00153 Roma RM, Italy",
                lat=41.8897,
                lon=12.4696,
                metadata={
                    "website": "https://www.turismoroma.it/en/places/basilica-santa-maria-trastevere"
                },
            ),
        ),
    ],
    "evening": [
        _seed(
            slug="rome-navona",
            title="Piazza Navona aperitivo and late walk",
            description="Anchor the evening around Piazza Navona with enough time for aperitivo and a slower after-dark wander.",
            tags=("aperitivo", "nightlife"),
            duration_min=120,
            amount="22.00",
            place=CatalogPlaceSeed(
                slug="piazza-navona",
                name="Piazza Navona",
                category="square",
                address_text="Piazza Navona, 00186 Roma RM, Italy",
                lat=41.8992,
                lon=12.4731,
                metadata={"website": "https://www.turismoroma.it/en/places/piazza-navona"},
            ),
        ),
        _seed(
            slug="rome-janiculum",
            title="Janiculum Terrace sunset sequence",
            description="Line up an evening climb for city views from the Janiculum and stay long enough for the light to shift.",
            tags=("sunset", "viewpoint"),
            duration_min=105,
            amount=None,
            place=CatalogPlaceSeed(
                slug="janiculum",
                name="Janiculum Terrace",
                category="viewpoint",
                address_text="Piazzale Giuseppe Garibaldi, 00165 Roma RM, Italy",
                lat=41.8894,
                lon=12.4663,
                metadata={
                    "website": "https://www.turismoroma.it/en/places/giuseppe-garibaldi-terrace"
                },
            ),
        ),
        _seed(
            slug="rome-castel-santangelo",
            title="Castel Sant'Angelo riverside evening",
            description="Use the Tiber edge and Castel Sant'Angelo for a photogenic evening loop with less museum pressure.",
            tags=("walking", "photography"),
            duration_min=100,
            amount="16.00",
            place=CatalogPlaceSeed(
                slug="castel-santangelo",
                name="Castel Sant'Angelo",
                category="museum",
                address_text="Lungotevere Castello, 50, 00193 Roma RM, Italy",
                lat=41.9031,
                lon=12.4663,
                metadata={"website": "https://www.castelsantangelo.beniculturali.it/"},
            ),
        ),
        _seed(
            slug="rome-monti",
            title="Monti dinner-and-streets night",
            description="Keep the evening in Monti for a lighter neighborhood atmosphere and a flexible dinner window.",
            tags=("food", "neighborhood"),
            duration_min=110,
            amount="28.00",
            place=CatalogPlaceSeed(
                slug="madonna-monti",
                name="Piazza della Madonna dei Monti",
                category="square",
                address_text="Piazza della Madonna dei Monti, 00184 Roma RM, Italy",
                lat=41.8959,
                lon=12.4894,
                metadata={"website": "https://www.turismoroma.it/en/places/rione-monti"},
            ),
        ),
    ],
}

PARIS = {
    "morning": [
        _seed(
            slug="paris-louvre",
            title="Louvre opening-hour circuit",
            description="Use the quietest part of the day for the Louvre and keep the route concentrated around its main wings.",
            tags=("museum", "art"),
            duration_min=180,
            amount="22.00",
            place=CatalogPlaceSeed(
                slug="louvre",
                name="Louvre Museum",
                category="museum",
                address_text="Rue de Rivoli, 75001 Paris, France",
                lat=48.8606,
                lon=2.3376,
                metadata={"website": "https://www.louvre.fr/en"},
            ),
        ),
        _seed(
            slug="paris-notre-dame",
            title="Ile de la Cite and Notre-Dame walk",
            description="Start in the historic center with a compact loop around the Seine islands and cathedral frontage.",
            tags=("history", "walking"),
            duration_min=105,
            amount=None,
            place=CatalogPlaceSeed(
                slug="notre-dame",
                name="Notre-Dame de Paris",
                category="cathedral",
                address_text="6 Parvis Notre-Dame - Pl. Jean-Paul II, 75004 Paris, France",
                lat=48.853,
                lon=2.3499,
                metadata={"website": "https://www.notredamedeparis.fr/en/"},
            ),
        ),
        _seed(
            slug="paris-rue-cler",
            title="Rue Cler breakfast and market street pass",
            description="Keep the morning easy with bakery stops and a slower pass through one of Paris's strongest food streets.",
            tags=("food", "market"),
            duration_min=90,
            amount="16.00",
            place=CatalogPlaceSeed(
                slug="rue-cler",
                name="Rue Cler",
                category="market_street",
                address_text="Rue Cler, 75007 Paris, France",
                lat=48.8559,
                lon=2.3042,
                metadata={"website": "https://parisjetaime.com/eng/place/732/rue-cler"},
            ),
        ),
        _seed(
            slug="paris-luxembourg",
            title="Luxembourg Gardens and Left Bank reset",
            description="Use the gardens and the neighboring streets for a calmer morning before heavier museum time.",
            tags=("park", "walking"),
            duration_min=95,
            amount=None,
            place=CatalogPlaceSeed(
                slug="luxembourg-gardens",
                name="Luxembourg Gardens",
                category="park",
                address_text="75006 Paris, France",
                lat=48.8462,
                lon=2.3371,
                metadata={"website": "https://jardin.senat.fr/"},
            ),
        ),
    ],
    "afternoon": [
        _seed(
            slug="paris-orsay",
            title="Musee d'Orsay afternoon block",
            description="Dedicate the afternoon to Musee d'Orsay and keep the pace focused on one strong collection.",
            tags=("museum", "art"),
            duration_min=165,
            amount="16.00",
            place=CatalogPlaceSeed(
                slug="orsay",
                name="Musee d'Orsay",
                category="museum",
                address_text="Esplanade Valery Giscard d'Estaing, 75007 Paris, France",
                lat=48.860,
                lon=2.3266,
                metadata={"website": "https://www.musee-orsay.fr/en"},
            ),
        ),
        _seed(
            slug="paris-marais",
            title="Le Marais gallery-to-courtyard walk",
            description="Use Le Marais for a denser afternoon of small design shops, galleries, and hidden courtyards.",
            tags=("design", "neighborhood"),
            duration_min=135,
            amount="18.00",
            place=CatalogPlaceSeed(
                slug="place-des-vosges",
                name="Place des Vosges",
                category="square",
                address_text="Place des Vosges, 75004 Paris, France",
                lat=48.8554,
                lon=2.365,
                metadata={"website": "https://parisjetaime.com/eng/place/799/place-des-vosges"},
            ),
        ),
        _seed(
            slug="paris-eiffel",
            title="Trocadero and Eiffel photo route",
            description="Aim the afternoon around the Trocadero and Eiffel zone for open views and a lighter outdoor sequence.",
            tags=("landmarks", "photography"),
            duration_min=125,
            amount=None,
            place=CatalogPlaceSeed(
                slug="eiffel-tower",
                name="Eiffel Tower",
                category="landmark",
                address_text="Champ de Mars, 5 Av. Anatole France, 75007 Paris, France",
                lat=48.8584,
                lon=2.2945,
                metadata={"website": "https://www.toureiffel.paris/en"},
            ),
        ),
        _seed(
            slug="paris-pompidou",
            title="Centre Pompidou and Beaubourg loop",
            description="Keep the afternoon energetic with a modern-art stop and a compact walk around Beaubourg.",
            tags=("museum", "modern_art"),
            duration_min=140,
            amount="15.00",
            place=CatalogPlaceSeed(
                slug="pompidou",
                name="Centre Pompidou",
                category="museum",
                address_text="Place Georges-Pompidou, 75004 Paris, France",
                lat=48.8606,
                lon=2.3522,
                metadata={"website": "https://www.centrepompidou.fr/en/"},
            ),
        ),
    ],
    "evening": [
        _seed(
            slug="paris-montmartre",
            title="Montmartre sunset climb",
            description="Use the evening light for the ascent to Sacre-Coeur and a slower pass through Montmartre's lanes.",
            tags=("sunset", "viewpoint"),
            duration_min=120,
            amount="20.00",
            place=CatalogPlaceSeed(
                slug="sacre-coeur",
                name="Basilique du Sacre-Coeur de Montmartre",
                category="basilica",
                address_text="35 Rue du Chevalier de la Barre, 75018 Paris, France",
                lat=48.8867,
                lon=2.3431,
                metadata={"website": "https://www.sacre-coeur-montmartre.com/english/"},
            ),
        ),
        _seed(
            slug="paris-seine",
            title="Seine evening promenade",
            description="Keep the evening flexible with a river walk, bridges, and room for spontaneous cafe stops.",
            tags=("walking", "riverfront"),
            duration_min=105,
            amount="14.00",
            place=CatalogPlaceSeed(
                slug="pont-alexandre-iii",
                name="Pont Alexandre III",
                category="bridge",
                address_text="Pont Alexandre III, 75008 Paris, France",
                lat=48.8638,
                lon=2.313,
                metadata={"website": "https://parisjetaime.com/eng/place/2664/pont-alexandre-iii"},
            ),
        ),
        _seed(
            slug="paris-latin-quarter",
            title="Latin Quarter dinner and streets",
            description="Use the Latin Quarter for a dinner-forward evening with a denser, older street pattern.",
            tags=("food", "neighborhood"),
            duration_min=115,
            amount="28.00",
            place=CatalogPlaceSeed(
                slug="place-contrescarpe",
                name="Place de la Contrescarpe",
                category="square",
                address_text="Place de la Contrescarpe, 75005 Paris, France",
                lat=48.8421,
                lon=2.3495,
                metadata={
                    "website": "https://parisjetaime.com/eng/place/2322/place-de-la-contrescarpe"
                },
            ),
        ),
        _seed(
            slug="paris-canal",
            title="Canal Saint-Martin late stroll",
            description="Use the canal edge for a less formal evening and a lighter neighborhood rhythm.",
            tags=("walking", "nightlife"),
            duration_min=95,
            amount="18.00",
            place=CatalogPlaceSeed(
                slug="canal-saint-martin",
                name="Canal Saint-Martin",
                category="canal",
                address_text="Quai de Valmy, 75010 Paris, France",
                lat=48.8721,
                lon=2.3636,
                metadata={"website": "https://parisjetaime.com/eng/place/70/canal-saint-martin"},
            ),
        ),
    ],
}

LISBON = {
    "morning": [
        _seed(
            slug="lisbon-alfama",
            title="Alfama lanes and Portas do Sol viewpoint",
            description="Start in Alfama while the streets are quieter and hold enough time for one of Lisbon's classic viewpoints.",
            tags=("walking", "viewpoint"),
            duration_min=115,
            amount="8.00",
            place=CatalogPlaceSeed(
                slug="portas-do-sol",
                name="Miradouro das Portas do Sol",
                category="viewpoint",
                address_text="Largo Portas do Sol, 1100-411 Lisboa, Portugal",
                lat=38.7121,
                lon=-9.1291,
                metadata={
                    "website": "https://www.visitlisboa.com/en/places/miradouro-das-portas-do-sol"
                },
            ),
        ),
        _seed(
            slug="lisbon-jeronimos",
            title="Jeronimos Monastery and Belem pastry stop",
            description="Use the morning for Belem's monastery core and fold in a pastry stop while the area is still relatively calm.",
            tags=("history", "food"),
            duration_min=145,
            amount="18.00",
            place=CatalogPlaceSeed(
                slug="jeronimos",
                name="Jeronimos Monastery",
                category="monastery",
                address_text="Praca do Imperio 1400-206 Lisboa, Portugal",
                lat=38.6979,
                lon=-9.2061,
                metadata={"website": "https://www.mosteirojeronimos.gov.pt/en/"},
            ),
        ),
        _seed(
            slug="lisbon-castelo",
            title="Castelo de Sao Jorge ramparts",
            description="Anchor the morning at Lisbon's hilltop castle for broad views and a stronger sense of the old city layout.",
            tags=("history", "viewpoint"),
            duration_min=135,
            amount="15.00",
            place=CatalogPlaceSeed(
                slug="castelo-sao-jorge",
                name="Castelo de Sao Jorge",
                category="castle",
                address_text="R. de Santa Cruz do Castelo, 1100-129 Lisboa, Portugal",
                lat=38.7139,
                lon=-9.1335,
                metadata={"website": "https://castelodesaojorge.pt/en/"},
            ),
        ),
        _seed(
            slug="lisbon-ribeira",
            title="Ribeira market breakfast and river edge",
            description="Keep the first hours easy with the market halls and the nearby riverfront streets.",
            tags=("food", "market"),
            duration_min=90,
            amount="14.00",
            place=CatalogPlaceSeed(
                slug="mercado-ribeira",
                name="Mercado da Ribeira",
                category="market",
                address_text="Av. 24 de Julho 49, 1200-479 Lisboa, Portugal",
                lat=38.7074,
                lon=-9.1467,
                metadata={"website": "https://www.timeoutmarket.com/lisboa/en/"},
            ),
        ),
    ],
    "afternoon": [
        _seed(
            slug="lisbon-azulejo",
            title="National Tile Museum visit",
            description="Use the afternoon for a more focused museum block around one of Lisbon's strongest design collections.",
            tags=("museum", "design"),
            duration_min=130,
            amount="10.00",
            place=CatalogPlaceSeed(
                slug="tile-museum",
                name="National Tile Museum",
                category="museum",
                address_text="Rua da Madre de Deus 4, 1900-312 Lisboa, Portugal",
                lat=38.7231,
                lon=-9.1138,
                metadata={"website": "https://www.museudoazulejo.gov.pt/en/"},
            ),
        ),
        _seed(
            slug="lisbon-belem-tower",
            title="Belem Tower and waterfront loop",
            description="Keep the afternoon outward-facing with a riverfront sequence between monuments and open views.",
            tags=("landmarks", "photography"),
            duration_min=120,
            amount="8.00",
            place=CatalogPlaceSeed(
                slug="belem-tower",
                name="Belem Tower",
                category="landmark",
                address_text="Av. Brasilia, 1400-038 Lisboa, Portugal",
                lat=38.6916,
                lon=-9.216,
                metadata={"website": "https://www.torrebelem.gov.pt/en/"},
            ),
        ),
        _seed(
            slug="lisbon-chiado",
            title="Chiado and Baixa design walk",
            description="Use the afternoon for central Lisbon's shopping streets, viewpoints, and classic facades.",
            tags=("walking", "shopping"),
            duration_min=115,
            amount="16.00",
            place=CatalogPlaceSeed(
                slug="chiado",
                name="Chiado",
                category="district",
                address_text="Largo do Chiado, 1200-108 Lisboa, Portugal",
                lat=38.7105,
                lon=-9.1434,
                metadata={"website": "https://www.visitlisboa.com/en/places/chiado"},
            ),
        ),
        _seed(
            slug="lisbon-lx-factory",
            title="LX Factory creative stop",
            description="Shift the afternoon toward design studios, bookstores, and a more creative industrial setting.",
            tags=("design", "food"),
            duration_min=110,
            amount="18.00",
            place=CatalogPlaceSeed(
                slug="lx-factory",
                name="LX Factory",
                category="creative_hub",
                address_text="R. Rodrigues de Faria 103, 1300-501 Lisboa, Portugal",
                lat=38.7039,
                lon=-9.1784,
                metadata={"website": "https://lxfactory.com/en/homepage-en/"},
            ),
        ),
    ],
    "evening": [
        _seed(
            slug="lisbon-senhora-do-monte",
            title="Senhora do Monte sunset",
            description="Aim the evening at one of Lisbon's highest miradouros and stay through the color change over the city.",
            tags=("sunset", "viewpoint"),
            duration_min=95,
            amount=None,
            place=CatalogPlaceSeed(
                slug="senhora-do-monte",
                name="Miradouro da Senhora do Monte",
                category="viewpoint",
                address_text="Largo Monte, 1170-253 Lisboa, Portugal",
                lat=38.7202,
                lon=-9.1326,
                metadata={
                    "website": "https://www.visitlisboa.com/en/places/miradouro-da-senhora-do-monte"
                },
            ),
        ),
        _seed(
            slug="lisbon-cais-do-sodre",
            title="Cais do Sodre riverfront evening",
            description="Use the river edge and nearby bars for a more relaxed evening that still feels central.",
            tags=("nightlife", "riverfront"),
            duration_min=110,
            amount="24.00",
            place=CatalogPlaceSeed(
                slug="cais-do-sodre",
                name="Cais do Sodre",
                category="district",
                address_text="Praça Duque da Terceira, 1200-161 Lisboa, Portugal",
                lat=38.7069,
                lon=-9.1458,
                metadata={"website": "https://www.visitlisboa.com/en/places/cais-do-sodre"},
            ),
        ),
        _seed(
            slug="lisbon-fado",
            title="Alfama dinner and fado block",
            description="Keep the evening in Alfama for a dinner-led experience in a stronger historic setting.",
            tags=("food", "music"),
            duration_min=140,
            amount="36.00",
            place=CatalogPlaceSeed(
                slug="clube-de-fado",
                name="Clube de Fado",
                category="music_venue",
                address_text="R. de São João da Praça 86, 1100-519 Lisboa, Portugal",
                lat=38.7095,
                lon=-9.1294,
                metadata={"website": "https://www.clube-de-fado.com/"},
            ),
        ),
        _seed(
            slug="lisbon-comercio",
            title="Praca do Comercio night walk",
            description="Use the open square and riverfront axis for a lighter evening with broad views and less commitment.",
            tags=("walking", "landmarks"),
            duration_min=90,
            amount=None,
            place=CatalogPlaceSeed(
                slug="praca-do-comercio",
                name="Praca do Comercio",
                category="square",
                address_text="Praça do Comércio, 1100-148 Lisboa, Portugal",
                lat=38.7079,
                lon=-9.1366,
                metadata={"website": "https://www.visitlisboa.com/en/places/praca-do-comercio"},
            ),
        ),
    ],
}

BARCELONA = {
    "morning": [
        _seed(
            slug="barcelona-sagrada",
            title="Sagrada Familia morning block",
            description="Use the first hours of the day for Gaudi's major work and keep the morning structured around a single landmark.",
            tags=("architecture", "landmarks"),
            duration_min=150,
            amount="26.00",
            place=CatalogPlaceSeed(
                slug="sagrada-familia",
                name="Sagrada Familia",
                category="basilica",
                address_text="C/ de Mallorca, 401, L'Eixample, 08013 Barcelona, Spain",
                lat=41.4036,
                lon=2.1744,
                metadata={"website": "https://sagradafamilia.org/en/"},
            ),
        ),
        _seed(
            slug="barcelona-boqueria",
            title="Boqueria breakfast and Rambla pass",
            description="Start with Barcelona's food pulse and keep the route easy through the early Rambla.",
            tags=("food", "market"),
            duration_min=95,
            amount="18.00",
            place=CatalogPlaceSeed(
                slug="la-boqueria",
                name="Mercat de la Boqueria",
                category="market",
                address_text="La Rambla, 91, Ciutat Vella, 08001 Barcelona, Spain",
                lat=41.3817,
                lon=2.1715,
                metadata={"website": "https://www.boqueria.barcelona/home"},
            ),
        ),
        _seed(
            slug="barcelona-gothic",
            title="Gothic Quarter morning walk",
            description="Use the morning for the Gothic Quarter's tighter medieval fabric before it gets busier.",
            tags=("history", "walking"),
            duration_min=105,
            amount=None,
            place=CatalogPlaceSeed(
                slug="barcelona-cathedral",
                name="Barcelona Cathedral",
                category="cathedral",
                address_text="Pla de la Seu, s/n, Ciutat Vella, 08002 Barcelona, Spain",
                lat=41.3839,
                lon=2.1763,
                metadata={"website": "https://catedralbcn.org/en/"},
            ),
        ),
        _seed(
            slug="barcelona-guell",
            title="Park Guell panorama loop",
            description="Keep the first half of the day on higher ground for Gaudi details and wide city views.",
            tags=("park", "viewpoint"),
            duration_min=140,
            amount="10.00",
            place=CatalogPlaceSeed(
                slug="park-guell",
                name="Park Guell",
                category="park",
                address_text="08024 Barcelona, Spain",
                lat=41.4145,
                lon=2.1527,
                metadata={"website": "https://parkguell.barcelona/en"},
            ),
        ),
    ],
    "afternoon": [
        _seed(
            slug="barcelona-picasso",
            title="Picasso Museum and El Born block",
            description="Use the afternoon for museum time and one of the most walkable neighborhoods in the old city.",
            tags=("museum", "art"),
            duration_min=135,
            amount="12.00",
            place=CatalogPlaceSeed(
                slug="picasso-museum",
                name="Museu Picasso",
                category="museum",
                address_text="Carrer de Montcada, 15-23, Ciutat Vella, 08003 Barcelona, Spain",
                lat=41.3853,
                lon=2.1814,
                metadata={"website": "https://museupicassobcn.cat/en"},
            ),
        ),
        _seed(
            slug="barcelona-batllo",
            title="Passeig de Gracia and Casa Batllo route",
            description="Keep the afternoon design-heavy along Passeig de Gracia with time for facades and interiors.",
            tags=("architecture", "shopping"),
            duration_min=120,
            amount="29.00",
            place=CatalogPlaceSeed(
                slug="casa-batllo",
                name="Casa Batllo",
                category="house_museum",
                address_text="Pg. de Gracia, 43, L'Eixample, 08007 Barcelona, Spain",
                lat=41.3917,
                lon=2.1649,
                metadata={"website": "https://www.casabatllo.es/en/"},
            ),
        ),
        _seed(
            slug="barcelona-montjuic",
            title="Montjuic terraces and museum edge",
            description="Shift the afternoon uphill for a broader city perspective and a more open walking rhythm.",
            tags=("viewpoint", "walking"),
            duration_min=135,
            amount="14.00",
            place=CatalogPlaceSeed(
                slug="montjuic-castle",
                name="Montjuic Castle",
                category="castle",
                address_text="Ctra. de Montjuic, 66, Sants-Montjuic, 08038 Barcelona, Spain",
                lat=41.363,
                lon=2.1699,
                metadata={"website": "https://ajuntament.barcelona.cat/castelldemontjuic/en"},
            ),
        ),
        _seed(
            slug="barcelona-barceloneta",
            title="Barceloneta promenade and sea break",
            description="Use the afternoon for a lighter coastal stretch and a reset away from the densest tourist core.",
            tags=("waterfront", "walking"),
            duration_min=110,
            amount="16.00",
            place=CatalogPlaceSeed(
                slug="barceloneta-beach",
                name="Barceloneta Beach",
                category="beach",
                address_text="Passeig Maritim de la Barceloneta, 16, 08003 Barcelona, Spain",
                lat=41.378,
                lon=2.1925,
                metadata={
                    "website": "https://www.barcelona.cat/en/what-to-do-in-bcn/beaches/barceloneta-beach_92086009636.html"
                },
            ),
        ),
    ],
    "evening": [
        _seed(
            slug="barcelona-bunkers",
            title="Bunkers del Carmel sunset",
            description="Use the evening light for one of Barcelona's strongest panoramic viewpoints.",
            tags=("sunset", "viewpoint"),
            duration_min=95,
            amount=None,
            place=CatalogPlaceSeed(
                slug="bunkers-del-carmel",
                name="Bunkers del Carmel",
                category="viewpoint",
                address_text="Carrer de Marià Labèrnia, s/n, Horta-Guinardó, 08032 Barcelona, Spain",
                lat=41.418,
                lon=2.1527,
                metadata={
                    "website": "https://www.barcelona.cat/en/what-to-do-in-bcn/parks-and-gardens/turo-de-la-rovira_92086018673.html"
                },
            ),
        ),
        _seed(
            slug="barcelona-placa-reial",
            title="Placa Reial tapas evening",
            description="Keep the night close to the old city with a dinner-first sequence around one of its livelier squares.",
            tags=("food", "nightlife"),
            duration_min=120,
            amount="30.00",
            place=CatalogPlaceSeed(
                slug="placa-reial",
                name="Placa Reial",
                category="square",
                address_text="Placa Reial, Ciutat Vella, 08002 Barcelona, Spain",
                lat=41.3802,
                lon=2.1751,
                metadata={
                    "website": "https://www.barcelona.cat/en/what-to-do-in-bcn/parks-and-gardens/plaza-real_92086009769.html"
                },
            ),
        ),
        _seed(
            slug="barcelona-port-vell",
            title="Port Vell and harbor night walk",
            description="Use the harbor edge for an easier evening with room to wander and linger.",
            tags=("walking", "waterfront"),
            duration_min=100,
            amount="14.00",
            place=CatalogPlaceSeed(
                slug="port-vell",
                name="Port Vell",
                category="harbor",
                address_text="Moll de Bosch i Alsina, 08039 Barcelona, Spain",
                lat=41.3748,
                lon=2.1828,
                metadata={"website": "https://www.portvellbcn.cat/en/"},
            ),
        ),
        _seed(
            slug="barcelona-born",
            title="El Born bars and late lanes",
            description="Keep the evening in El Born for a denser, more compact finish close to the center.",
            tags=("neighborhood", "nightlife"),
            duration_min=110,
            amount="24.00",
            place=CatalogPlaceSeed(
                slug="born-cultural-centre",
                name="El Born Centre de Cultura i Memoria",
                category="cultural_center",
                address_text="Placa Comercial, 12, Ciutat Vella, 08003 Barcelona, Spain",
                lat=41.3852,
                lon=2.1826,
                metadata={"website": "https://elbornculturaimemoria.barcelona.cat/en/"},
            ),
        ),
    ],
}

BERLIN = {
    "morning": [
        _seed(
            slug="berlin-museum-island",
            title="Museum Island morning circuit",
            description="Start on Museum Island with a concentrated walk across Berlin's strongest cluster of cultural institutions.",
            tags=("museum", "history"),
            duration_min=150,
            amount="24.00",
            place=CatalogPlaceSeed(
                slug="museum-island",
                name="Museum Island",
                category="museum_district",
                address_text="Bodestraße 1-3, 10178 Berlin, Germany",
                lat=52.5169,
                lon=13.401,
                metadata={
                    "website": "https://www.smb.museum/en/museums-institutions/museum-island-berlin/home/"
                },
            ),
        ),
        _seed(
            slug="berlin-brandenburg",
            title="Brandenburg Gate and Tiergarten walk",
            description="Keep the morning broad and outdoors with Berlin's central symbols and the park edge.",
            tags=("landmarks", "walking"),
            duration_min=100,
            amount=None,
            place=CatalogPlaceSeed(
                slug="brandenburg-gate",
                name="Brandenburg Gate",
                category="landmark",
                address_text="Pariser Platz, 10117 Berlin, Germany",
                lat=52.5163,
                lon=13.3777,
                metadata={"website": "https://www.visitberlin.de/en/brandenburg-gate"},
            ),
        ),
        _seed(
            slug="berlin-east-side",
            title="East Side Gallery river walk",
            description="Use the first hours of the day for the mural stretch before it gets crowded.",
            tags=("street_art", "walking"),
            duration_min=95,
            amount=None,
            place=CatalogPlaceSeed(
                slug="east-side-gallery",
                name="East Side Gallery",
                category="open_air_gallery",
                address_text="Mühlenstraße 3-100, 10243 Berlin, Germany",
                lat=52.505,
                lon=13.4394,
                metadata={"website": "https://www.eastsidegalleryberlin.de/"},
            ),
        ),
        _seed(
            slug="berlin-wall-memorial",
            title="Berlin Wall Memorial visit",
            description="Use the morning for a more focused historical stop with strong context about the divided city.",
            tags=("history", "museum"),
            duration_min=120,
            amount=None,
            place=CatalogPlaceSeed(
                slug="wall-memorial",
                name="Berlin Wall Memorial",
                category="memorial",
                address_text="Bernauer Str. 111, 13355 Berlin, Germany",
                lat=52.5351,
                lon=13.3903,
                metadata={"website": "https://www.berliner-mauer-gedenkstaette.de/en/"},
            ),
        ),
    ],
    "afternoon": [
        _seed(
            slug="berlin-neues",
            title="Neues Museum afternoon block",
            description="Dedicate the afternoon to a single museum anchor and let the rest of the schedule stay compact.",
            tags=("museum", "history"),
            duration_min=140,
            amount="14.00",
            place=CatalogPlaceSeed(
                slug="neues-museum",
                name="Neues Museum",
                category="museum",
                address_text="Bodestraße 1-3, 10178 Berlin, Germany",
                lat=52.5208,
                lon=13.3989,
                metadata={
                    "website": "https://www.smb.museum/en/museums-institutions/neues-museum/home/"
                },
            ),
        ),
        _seed(
            slug="berlin-tempelhof",
            title="Tempelhof Field open-air reset",
            description="Use the afternoon for Berlin's large-scale urban openness and a different rhythm from the museum core.",
            tags=("park", "walking"),
            duration_min=125,
            amount=None,
            place=CatalogPlaceSeed(
                slug="tempelhofer-feld",
                name="Tempelhofer Feld",
                category="park",
                address_text="Tempelhofer Damm, 12101 Berlin, Germany",
                lat=52.4738,
                lon=13.4035,
                metadata={"website": "https://tempelhoferfeld.berlin.de/"},
            ),
        ),
        _seed(
            slug="berlin-reichstag",
            title="Reichstag government district loop",
            description="Keep the afternoon in the government district with a walk that stays strong on major architecture.",
            tags=("architecture", "history"),
            duration_min=105,
            amount=None,
            place=CatalogPlaceSeed(
                slug="reichstag",
                name="Reichstag Building",
                category="government_building",
                address_text="Platz der Republik 1, 11011 Berlin, Germany",
                lat=52.5186,
                lon=13.3762,
                metadata={"website": "https://www.bundestag.de/en/visittheBundestag"},
            ),
        ),
        _seed(
            slug="berlin-kreuzberg-afternoon",
            title="Kreuzberg canal-side afternoon",
            description="Shift the afternoon toward Kreuzberg for a denser neighborhood pattern and easier cafe stops.",
            tags=("neighborhood", "food"),
            duration_min=110,
            amount="16.00",
            place=CatalogPlaceSeed(
                slug="landwehrkanal",
                name="Landwehr Canal",
                category="canal",
                address_text="Admiralbrücke, 10967 Berlin, Germany",
                lat=52.4915,
                lon=13.4218,
                metadata={"website": "https://www.visitberlin.de/en/landwehr-canal"},
            ),
        ),
    ],
    "evening": [
        _seed(
            slug="berlin-alexanderplatz",
            title="Alexanderplatz and Fernsehturm night",
            description="Use the evening for Berlin's brighter center and a higher-energy finish.",
            tags=("nightlife", "landmarks"),
            duration_min=105,
            amount="28.00",
            place=CatalogPlaceSeed(
                slug="fernsehturm",
                name="Berliner Fernsehturm",
                category="tower",
                address_text="Panoramastraße 1A, 10178 Berlin, Germany",
                lat=52.5208,
                lon=13.4094,
                metadata={"website": "https://tv-turm.de/en/"},
            ),
        ),
        _seed(
            slug="berlin-hackescher",
            title="Hackescher Markt dinner circuit",
            description="Keep the evening compact around Hackescher Markt for food, courtyards, and a strong urban mix.",
            tags=("food", "nightlife"),
            duration_min=120,
            amount="30.00",
            place=CatalogPlaceSeed(
                slug="hackescher-markt",
                name="Hackescher Markt",
                category="square",
                address_text="Hackescher Markt, 10178 Berlin, Germany",
                lat=52.5228,
                lon=13.4022,
                metadata={"website": "https://www.visitberlin.de/en/hackesche-hoefe"},
            ),
        ),
        _seed(
            slug="berlin-kreuzberg-evening",
            title="Kreuzberg evening by the canal",
            description="Use the canal-side edges of Kreuzberg for a lighter, local-leaning night.",
            tags=("nightlife", "walking"),
            duration_min=115,
            amount="24.00",
            place=CatalogPlaceSeed(
                slug="admiralbrucke",
                name="Admiralbrucke",
                category="bridge",
                address_text="Admiralbrücke, 10967 Berlin, Germany",
                lat=52.4929,
                lon=13.4217,
                metadata={"website": "https://www.visitberlin.de/en/admiralbrucke"},
            ),
        ),
        _seed(
            slug="berlin-postdamer",
            title="Potsdamer Platz lights and architecture",
            description="Keep the evening strong on contemporary architecture and an easier central return.",
            tags=("architecture", "nightlife"),
            duration_min=95,
            amount="18.00",
            place=CatalogPlaceSeed(
                slug="potsdamer-platz",
                name="Potsdamer Platz",
                category="square",
                address_text="Potsdamer Platz, 10785 Berlin, Germany",
                lat=52.5096,
                lon=13.376,
                metadata={"website": "https://www.visitberlin.de/en/potsdamer-platz"},
            ),
        ),
    ],
}


DESTINATION_CATALOGS: dict[str, dict[str, list[CatalogActivitySeed]]] = {
    "rome": ROME,
    "paris": PARIS,
    "lisbon": LISBON,
    "barcelona": BARCELONA,
    "berlin": BERLIN,
}


def _stable_index(key: str, modulo: int) -> int:
    if modulo <= 0:
        return 0
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % modulo


def _normalize_destination(destination_text: str) -> str:
    primary = destination_text.split(",")[0].strip().lower()
    return " ".join(primary.split())


def _generic_catalog(destination_label: str) -> dict[str, list[CatalogActivitySeed]]:
    return {
        "morning": [
            _seed(
                slug="generic-old-town",
                title=f"Historic center orientation in {destination_label}",
                description=f"Use the morning to get your bearings in the older core of {destination_label} before the day gets busier.",
                tags=("walking", "history"),
                duration_min=105,
                amount="10.00",
                place=CatalogPlaceSeed(
                    slug="historic-center",
                    name=f"{destination_label} historic center",
                    category="historic_center",
                    address_text=destination_label,
                    lat=None,
                    lon=None,
                    metadata={"description": f"Seeded planner anchor for {destination_label}"},
                ),
            )
        ],
        "afternoon": [
            _seed(
                slug="generic-museum-quarter",
                title=f"Cultural district stop in {destination_label}",
                description=f"Keep the afternoon focused on one museum or cultural district to avoid overscheduling in {destination_label}.",
                tags=("museum", "culture"),
                duration_min=135,
                amount="15.00",
                place=CatalogPlaceSeed(
                    slug="cultural-quarter",
                    name=f"{destination_label} cultural quarter",
                    category="cultural_district",
                    address_text=destination_label,
                    lat=None,
                    lon=None,
                    metadata={"description": f"Seeded planner anchor for {destination_label}"},
                ),
            )
        ],
        "evening": [
            _seed(
                slug="generic-waterfront",
                title=f"Evening promenade in {destination_label}",
                description=f"Use the evening for a relaxed promenade and dinner window that leaves room for spontaneous stops in {destination_label}.",
                tags=("walking", "food"),
                duration_min=105,
                amount="24.00",
                place=CatalogPlaceSeed(
                    slug="evening-promenade",
                    name=f"{destination_label} evening promenade",
                    category="district",
                    address_text=destination_label,
                    lat=None,
                    lon=None,
                    metadata={"description": f"Seeded planner anchor for {destination_label}"},
                ),
            )
        ],
    }


def build_catalog_candidates(
    *,
    trip: Trip,
    days: list[TripDay],
    seed: int | None,
) -> dict[Any, list[dict[str, Any]]]:
    destination_key = _normalize_destination(trip.destination_text)
    destination_label = trip.destination_text.split(",")[0].strip() or trip.destination_text
    focus_label = (
        trip.trip_type.strip().replace("_", " ")
        if isinstance(trip.trip_type, str) and trip.trip_type.strip()
        else "local highlights"
    )

    catalog = DESTINATION_CATALOGS.get(destination_key, _generic_catalog(destination_label))
    base_seed = seed if seed is not None else 0

    candidates_by_day: dict[Any, list[dict[str, Any]]] = {}
    for day in days:
        day_rows: list[dict[str, Any]] = []
        for slot_index, slot in enumerate(SLOT_ORDER):
            pool = catalog[slot]
            choice_index = _stable_index(
                f"{trip.id}:{destination_key}:{slot}:{base_seed}",
                len(pool),
            )
            item = pool[(choice_index + day.day_index + slot_index) % len(pool)]
            tags_json = list(dict.fromkeys([slot, *item.tags, focus_label]))
            description = item.description
            if focus_label not in description.lower():
                description = f"{description} Keeps the focus on {focus_label}."
            day_rows.append(
                {
                    "title": item.title,
                    "description": description,
                    "start_time": SLOT_START_TIMES[slot],
                    "duration_min": item.duration_min,
                    "tags_json": tags_json,
                    "estimated_cost_amount": item.estimated_cost_amount,
                    "estimated_cost_currency": item.estimated_cost_currency,
                    "place_seed": item.place_seed,
                }
            )
        candidates_by_day[day.id] = day_rows

    return candidates_by_day
