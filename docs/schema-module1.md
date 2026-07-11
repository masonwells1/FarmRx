# Farm Rx Module 1 Schema — Owner Review Draft

These files are a database blueprint only. They have not been applied to a database.

## What each table does

- **Farms:** The farm's private workspace—the digital equivalent of one farm office and everything filed inside it.
- **Farm memberships:** The list of people who belong to that farm workspace, whether they are an owner, manager, worker, or read-only viewer.
- **Farm rep access:** The named permission slip for one specific Crop RX representative; it can be turned off or revoked without changing farm membership.
- **Entities:** The operating businesses under the farm, such as Wells Farm Group or Next Generation Farms, so fields and future reports can be separated by business.
- **Fields:** The master card for each piece of ground, including its name, acres, location, FSA numbers, productivity index, and operating entity.
- **Commodities:** The approved crop list; yellow corn, white corn, Non-GMO corn, regular soybeans, double-crop soybeans, and wheat are separate marketable products.
- **Crop assignments:** One yearly planting line for one field, crop, and planted acreage—like a field history ledger that allows wheat and double-crop beans on the same field in the same year.
- **Arrangements:** The lease or ownership terms for a field, including owned ground, cash rent, flex cash rent, or crop share and the landlord's share of crop and each input-cost category.

## How privacy works

Every private record is stamped with its farm workspace. The database checks that stamp before showing or changing a row, so belonging to Farm A does not open anything from Farm B.

An active farm member can see the farm's Module 1 records. Owners, managers, and workers can edit them; read-only members cannot. A person's general job title or app-wide role never opens a farm by itself.

The **Share with my Crop RX rep** toggle starts **OFF**. Turning it on is only half of the permission: the farm must also have a separate, enabled permission slip naming that exact representative. Both must be true at the same time. Turning the toggle off or revoking the named permission blocks the representative on the next database request.

Representatives receive read-only access through this Module 1 draft. They cannot edit farm records, manage members, or grant themselves access. Grain positions, prices, contracts, yields, and financial records must live in farm-stamped tables in later modules; they are private unless the same deliberate sharing rules are applied.

## Decisions I made and why

- I made crop assignments separate records instead of putting a crop on the field. That lets one field carry wheat and double-crop soybeans in the same year without overwriting either crop.
- I made white corn and Non-GMO corn separate commodities. Their buyers, premiums, contracts, bins, and delivery rules are not interchangeable with yellow corn.
- I made every field belong to an operating entity. That guarantees future reports can be filtered by Wells Farm Group, Next Generation Farms, or another business without rebuilding the field data.
- I stored crop-share input percentages in separate named columns. A landlord may receive one percentage of the crop while paying different percentages of seed, fertilizer, chemical, fuel, insurance, or other costs.
- I kept old arrangements by effective dates and allow only one open-ended current arrangement per field. That preserves lease history while preventing two current answers for the same ground.

