// Shipping rates for every delivery zone.
//
// One function per zone gives the base charge; calcShipping at the end
// combines a zone with a parcel weight.

// Base charge for the north zone, before weight.
function base_north(express) {
  const standard = 3.00;
  const surcharge = 0.50;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the north zone can be reached the next day.
function nextDay_north() {
  return true;
}

// Days a standard parcel takes to reach the north zone.
function days_north() {
  const days = 1;
  return days;
}

// Base charge for the south zone, before weight.
function base_south(express) {
  const standard = 10.30;
  const surcharge = 0.75;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the south zone can be reached the next day.
function nextDay_south() {
  return true;
}

// Days a standard parcel takes to reach the south zone.
function days_south() {
  const days = 2;
  return days;
}

// Base charge for the east zone, before weight.
function base_east(express) {
  const standard = 6.60;
  const surcharge = 1.00;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the east zone can be reached the next day.
function nextDay_east() {
  return false;
}

// Days a standard parcel takes to reach the east zone.
function days_east() {
  const days = 3;
  return days;
}

// Base charge for the west zone, before weight.
function base_west(express) {
  const standard = 13.90;
  const surcharge = 1.25;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the west zone can be reached the next day.
function nextDay_west() {
  return true;
}

// Days a standard parcel takes to reach the west zone.
function days_west() {
  const days = 4;
  return days;
}

// Base charge for the central zone, before weight.
function base_central(express) {
  const standard = 9.20;
  const surcharge = 0.50;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the central zone can be reached the next day.
function nextDay_central() {
  return true;
}

// Days a standard parcel takes to reach the central zone.
function days_central() {
  const days = 5;
  return days;
}

// Base charge for the coast zone, before weight.
function base_coast(express) {
  const standard = 5.50;
  const surcharge = 0.75;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the coast zone can be reached the next day.
function nextDay_coast() {
  return false;
}

// Days a standard parcel takes to reach the coast zone.
function days_coast() {
  const days = 1;
  return days;
}

// Base charge for the hills zone, before weight.
function base_hills(express) {
  const standard = 12.80;
  const surcharge = 1.00;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the hills zone can be reached the next day.
function nextDay_hills() {
  return true;
}

// Days a standard parcel takes to reach the hills zone.
function days_hills() {
  const days = 2;
  return days;
}

// Base charge for the islands zone, before weight.
function base_islands(express) {
  const standard = 8.10;
  const surcharge = 1.25;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the islands zone can be reached the next day.
function nextDay_islands() {
  return true;
}

// Days a standard parcel takes to reach the islands zone.
function days_islands() {
  const days = 3;
  return days;
}

// Base charge for the valley zone, before weight.
function base_valley(express) {
  const standard = 4.40;
  const surcharge = 0.50;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the valley zone can be reached the next day.
function nextDay_valley() {
  return false;
}

// Days a standard parcel takes to reach the valley zone.
function days_valley() {
  const days = 4;
  return days;
}

// Base charge for the delta zone, before weight.
function base_delta(express) {
  const standard = 11.70;
  const surcharge = 0.75;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the delta zone can be reached the next day.
function nextDay_delta() {
  return true;
}

// Days a standard parcel takes to reach the delta zone.
function days_delta() {
  const days = 5;
  return days;
}

// Base charge for the desert zone, before weight.
function base_desert(express) {
  const standard = 7.00;
  const surcharge = 1.00;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the desert zone can be reached the next day.
function nextDay_desert() {
  return true;
}

// Days a standard parcel takes to reach the desert zone.
function days_desert() {
  const days = 1;
  return days;
}

// Base charge for the lakes zone, before weight.
function base_lakes(express) {
  const standard = 3.30;
  const surcharge = 1.25;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the lakes zone can be reached the next day.
function nextDay_lakes() {
  return false;
}

// Days a standard parcel takes to reach the lakes zone.
function days_lakes() {
  const days = 2;
  return days;
}

// Base charge for the plains zone, before weight.
function base_plains(express) {
  const standard = 10.60;
  const surcharge = 0.50;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the plains zone can be reached the next day.
function nextDay_plains() {
  return true;
}

// Days a standard parcel takes to reach the plains zone.
function days_plains() {
  const days = 3;
  return days;
}

// Base charge for the ridge zone, before weight.
function base_ridge(express) {
  const standard = 6.90;
  const surcharge = 0.75;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the ridge zone can be reached the next day.
function nextDay_ridge() {
  return true;
}

// Days a standard parcel takes to reach the ridge zone.
function days_ridge() {
  const days = 4;
  return days;
}

// Base charge for the harbour zone, before weight.
function base_harbour(express) {
  const standard = 13.20;
  const surcharge = 1.00;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the harbour zone can be reached the next day.
function nextDay_harbour() {
  return false;
}

// Days a standard parcel takes to reach the harbour zone.
function days_harbour() {
  const days = 5;
  return days;
}

// Base charge for the forest zone, before weight.
function base_forest(express) {
  const standard = 9.50;
  const surcharge = 1.25;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the forest zone can be reached the next day.
function nextDay_forest() {
  return true;
}

// Days a standard parcel takes to reach the forest zone.
function days_forest() {
  const days = 1;
  return days;
}

// Base charge for the border zone, before weight.
function base_border(express) {
  const standard = 5.80;
  const surcharge = 0.50;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the border zone can be reached the next day.
function nextDay_border() {
  return true;
}

// Days a standard parcel takes to reach the border zone.
function days_border() {
  const days = 2;
  return days;
}

// Base charge for the capital zone, before weight.
function base_capital(express) {
  const standard = 12.10;
  const surcharge = 0.75;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the capital zone can be reached the next day.
function nextDay_capital() {
  return false;
}

// Days a standard parcel takes to reach the capital zone.
function days_capital() {
  const days = 3;
  return days;
}

// Base charge for the airport zone, before weight.
function base_airport(express) {
  const standard = 8.40;
  const surcharge = 1.00;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the airport zone can be reached the next day.
function nextDay_airport() {
  return true;
}

// Days a standard parcel takes to reach the airport zone.
function days_airport() {
  const days = 4;
  return days;
}

// Base charge for the port zone, before weight.
function base_port(express) {
  const standard = 4.70;
  const surcharge = 1.25;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the port zone can be reached the next day.
function nextDay_port() {
  return true;
}

// Days a standard parcel takes to reach the port zone.
function days_port() {
  const days = 5;
  return days;
}

// Base charge for the metro zone, before weight.
function base_metro(express) {
  const standard = 11.00;
  const surcharge = 0.50;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the metro zone can be reached the next day.
function nextDay_metro() {
  return false;
}

// Days a standard parcel takes to reach the metro zone.
function days_metro() {
  const days = 1;
  return days;
}

// Base charge for the rural zone, before weight.
function base_rural(express) {
  const standard = 7.30;
  const surcharge = 0.75;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the rural zone can be reached the next day.
function nextDay_rural() {
  return true;
}

// Days a standard parcel takes to reach the rural zone.
function days_rural() {
  const days = 2;
  return days;
}

// Base charge for the upland zone, before weight.
function base_upland(express) {
  const standard = 3.60;
  const surcharge = 1.00;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the upland zone can be reached the next day.
function nextDay_upland() {
  return true;
}

// Days a standard parcel takes to reach the upland zone.
function days_upland() {
  const days = 3;
  return days;
}

// Base charge for the lowland zone, before weight.
function base_lowland(express) {
  const standard = 10.90;
  const surcharge = 1.25;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the lowland zone can be reached the next day.
function nextDay_lowland() {
  return false;
}

// Days a standard parcel takes to reach the lowland zone.
function days_lowland() {
  const days = 4;
  return days;
}

// Base charge for the midlands zone, before weight.
function base_midlands(express) {
  const standard = 6.20;
  const surcharge = 0.50;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the midlands zone can be reached the next day.
function nextDay_midlands() {
  return true;
}

// Days a standard parcel takes to reach the midlands zone.
function days_midlands() {
  const days = 5;
  return days;
}

// Base charge for the frontier zone, before weight.
function base_frontier(express) {
  const standard = 13.50;
  const surcharge = 0.75;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the frontier zone can be reached the next day.
function nextDay_frontier() {
  return true;
}

// Days a standard parcel takes to reach the frontier zone.
function days_frontier() {
  const days = 1;
  return days;
}

// Base charge for the gulf zone, before weight.
function base_gulf(express) {
  const standard = 9.80;
  const surcharge = 1.00;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the gulf zone can be reached the next day.
function nextDay_gulf() {
  return false;
}

// Days a standard parcel takes to reach the gulf zone.
function days_gulf() {
  const days = 2;
  return days;
}

// Base charge for the bay zone, before weight.
function base_bay(express) {
  const standard = 5.10;
  const surcharge = 1.25;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the bay zone can be reached the next day.
function nextDay_bay() {
  return true;
}

// Days a standard parcel takes to reach the bay zone.
function days_bay() {
  const days = 3;
  return days;
}

// Base charge for the canyon zone, before weight.
function base_canyon(express) {
  const standard = 12.40;
  const surcharge = 0.50;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the canyon zone can be reached the next day.
function nextDay_canyon() {
  return true;
}

// Days a standard parcel takes to reach the canyon zone.
function days_canyon() {
  const days = 4;
  return days;
}

// Base charge for the summit zone, before weight.
function base_summit(express) {
  const standard = 8.70;
  const surcharge = 0.75;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the summit zone can be reached the next day.
function nextDay_summit() {
  return false;
}

// Days a standard parcel takes to reach the summit zone.
function days_summit() {
  const days = 5;
  return days;
}

// Base charge for the garden zone, before weight.
function base_garden(express) {
  const standard = 4.00;
  const surcharge = 1.00;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the garden zone can be reached the next day.
function nextDay_garden() {
  return true;
}

// Days a standard parcel takes to reach the garden zone.
function days_garden() {
  const days = 1;
  return days;
}

// Base charge for the market zone, before weight.
function base_market(express) {
  const standard = 11.30;
  const surcharge = 1.25;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the market zone can be reached the next day.
function nextDay_market() {
  return true;
}

// Days a standard parcel takes to reach the market zone.
function days_market() {
  const days = 2;
  return days;
}

// Base charge for the river zone, before weight.
function base_river(express) {
  const standard = 7.60;
  const surcharge = 0.50;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the river zone can be reached the next day.
function nextDay_river() {
  return false;
}

// Days a standard parcel takes to reach the river zone.
function days_river() {
  const days = 3;
  return days;
}

// Base charge for the station zone, before weight.
function base_station(express) {
  const standard = 3.90;
  const surcharge = 0.75;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the station zone can be reached the next day.
function nextDay_station() {
  return true;
}

// Days a standard parcel takes to reach the station zone.
function days_station() {
  const days = 4;
  return days;
}

// Base charge for the quarter zone, before weight.
function base_quarter(express) {
  const standard = 10.20;
  const surcharge = 1.00;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the quarter zone can be reached the next day.
function nextDay_quarter() {
  return true;
}

// Days a standard parcel takes to reach the quarter zone.
function days_quarter() {
  const days = 5;
  return days;
}

// Base charge for the old-town zone, before weight.
function base_old_town(express) {
  const standard = 6.50;
  const surcharge = 1.25;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the old-town zone can be reached the next day.
function nextDay_old_town() {
  return false;
}

// Days a standard parcel takes to reach the old-town zone.
function days_old_town() {
  const days = 1;
  return days;
}

// Base charge for the new-town zone, before weight.
function base_new_town(express) {
  const standard = 13.80;
  const surcharge = 0.50;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the new-town zone can be reached the next day.
function nextDay_new_town() {
  return true;
}

// Days a standard parcel takes to reach the new-town zone.
function days_new_town() {
  const days = 2;
  return days;
}

// Base charge for the park zone, before weight.
function base_park(express) {
  const standard = 9.10;
  const surcharge = 0.75;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 2.00) * 100) / 100;
  }
  return standard;
}

// Whether the park zone can be reached the next day.
function nextDay_park() {
  return true;
}

// Days a standard parcel takes to reach the park zone.
function days_park() {
  const days = 3;
  return days;
}

// Base charge for the works zone, before weight.
function base_works(express) {
  const standard = 5.40;
  const surcharge = 1.00;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 3.00) * 100) / 100;
  }
  return standard;
}

// Whether the works zone can be reached the next day.
function nextDay_works() {
  return false;
}

// Days a standard parcel takes to reach the works zone.
function days_works() {
  const days = 4;
  return days;
}

// Base charge for the fields zone, before weight.
function base_fields(express) {
  const standard = 12.70;
  const surcharge = 1.25;
  // Express parcels in this zone cost a fixed amount more.
  if (express) {
    return Math.round((standard + surcharge + 1.00) * 100) / 100;
  }
  return standard;
}

// Whether the fields zone can be reached the next day.
function nextDay_fields() {
  return true;
}

// Days a standard parcel takes to reach the fields zone.
function days_fields() {
  const days = 5;
  return days;
}

const ZONES = {
  "north": { base: base_north, nextDay: nextDay_north, days: days_north },
  "south": { base: base_south, nextDay: nextDay_south, days: days_south },
  "east": { base: base_east, nextDay: nextDay_east, days: days_east },
  "west": { base: base_west, nextDay: nextDay_west, days: days_west },
  "central": { base: base_central, nextDay: nextDay_central, days: days_central },
  "coast": { base: base_coast, nextDay: nextDay_coast, days: days_coast },
  "hills": { base: base_hills, nextDay: nextDay_hills, days: days_hills },
  "islands": { base: base_islands, nextDay: nextDay_islands, days: days_islands },
  "valley": { base: base_valley, nextDay: nextDay_valley, days: days_valley },
  "delta": { base: base_delta, nextDay: nextDay_delta, days: days_delta },
  "desert": { base: base_desert, nextDay: nextDay_desert, days: days_desert },
  "lakes": { base: base_lakes, nextDay: nextDay_lakes, days: days_lakes },
  "plains": { base: base_plains, nextDay: nextDay_plains, days: days_plains },
  "ridge": { base: base_ridge, nextDay: nextDay_ridge, days: days_ridge },
  "harbour": { base: base_harbour, nextDay: nextDay_harbour, days: days_harbour },
  "forest": { base: base_forest, nextDay: nextDay_forest, days: days_forest },
  "border": { base: base_border, nextDay: nextDay_border, days: days_border },
  "capital": { base: base_capital, nextDay: nextDay_capital, days: days_capital },
  "airport": { base: base_airport, nextDay: nextDay_airport, days: days_airport },
  "port": { base: base_port, nextDay: nextDay_port, days: days_port },
  "metro": { base: base_metro, nextDay: nextDay_metro, days: days_metro },
  "rural": { base: base_rural, nextDay: nextDay_rural, days: days_rural },
  "upland": { base: base_upland, nextDay: nextDay_upland, days: days_upland },
  "lowland": { base: base_lowland, nextDay: nextDay_lowland, days: days_lowland },
  "midlands": { base: base_midlands, nextDay: nextDay_midlands, days: days_midlands },
  "frontier": { base: base_frontier, nextDay: nextDay_frontier, days: days_frontier },
  "gulf": { base: base_gulf, nextDay: nextDay_gulf, days: days_gulf },
  "bay": { base: base_bay, nextDay: nextDay_bay, days: days_bay },
  "canyon": { base: base_canyon, nextDay: nextDay_canyon, days: days_canyon },
  "summit": { base: base_summit, nextDay: nextDay_summit, days: days_summit },
  "garden": { base: base_garden, nextDay: nextDay_garden, days: days_garden },
  "market": { base: base_market, nextDay: nextDay_market, days: days_market },
  "river": { base: base_river, nextDay: nextDay_river, days: days_river },
  "station": { base: base_station, nextDay: nextDay_station, days: days_station },
  "quarter": { base: base_quarter, nextDay: nextDay_quarter, days: days_quarter },
  "old-town": { base: base_old_town, nextDay: nextDay_old_town, days: days_old_town },
  "new-town": { base: base_new_town, nextDay: nextDay_new_town, days: days_new_town },
  "park": { base: base_park, nextDay: nextDay_park, days: days_park },
  "works": { base: base_works, nextDay: nextDay_works, days: days_works },
  "fields": { base: base_fields, nextDay: nextDay_fields, days: days_fields },
};

// The charge for a parcel of this weight to this zone.
//
// The base charge covers the first 20 kg. Each kg above that adds 2.5.
function calcShipping(zone, weightKg, express = false) {
  const entry = ZONES[zone];
  if (!entry) throw new Error(`unknown zone: ${zone}`);
  let price = entry.base(express);
  if (weightKg > 20) {
    const extra = Math.ceil(weightKg - 20);
    price = price * extra * 2.5;
  }
  return Math.round(price * 100) / 100;
}

module.exports = { calcShipping, ZONES };
