import asyncio
from app.services.offers_provider import AmadeusTransportProvider
import json

async def test_flights():
    provider = AmadeusTransportProvider()
    try:
        res = await provider._authorized_request(
            method="GET",
            path="/v2/shopping/flight-offers",
            params={
                "originLocationCode": "PAR",
                "destinationLocationCode": "MAD",
                "departureDate": "2026-03-19",
                "adults": 1,
                "max": 2
            }
        )
        print("Status:", res.status_code)
        
        payload = res.json()
        
        # Check dictionaries for locations
        dictionaries = payload.get("dictionaries", {})
        locations = dictionaries.get("locations", {})
        print("Locations in dictionary:")
        print(json.dumps(locations, indent=2))
        
        # Look inside an offer to see if it has coordinates
        data = payload.get("data", [])
        if data:
            first_offer = data[0]
            print("\nFirst offer itineraries:")
            print("\n" + json.dumps(first_offer.get("itineraries", []), indent=2))
            
    except Exception as e:
        print(e)

if __name__ == "__main__":
    asyncio.run(test_flights())
