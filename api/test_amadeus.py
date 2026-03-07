import asyncio
from app.services.offers_provider import AmadeusTransportProvider
from app.config import get_settings

async def test_locations():
    provider = AmadeusTransportProvider()
    
    # Try the cities endpoint
    print("Testing /locations with CITY,AIRPORT")
    try:
        res1 = await provider._authorized_request(
            method="GET",
            path="/v1/reference-data/locations",
            params={"keyword": "PARIS", "subType": "CITY,AIRPORT", "page[limit]": 5}
        )
        print("locations status:", res1.status_code)
        print(res1.text)
    except Exception as e:
        print(e)
        
    print("Testing /locations/cities")
    try:
        res2 = await provider._authorized_request(
            method="GET",
            path="/v1/reference-data/locations/cities",
            params={"keyword": "PARIS", "max": 5}
        )
        print("cities status:", res2.status_code)
        # print(res2.text)
    except Exception as e:
        print(e)

if __name__ == "__main__":
    asyncio.run(test_locations())
