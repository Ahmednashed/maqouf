import { check } from "./_harness.ts";
import { gpsCheckState, branchHasCoords, tallyGps, type GpsTallyRow } from "@/lib/gps-status";


const coords = { lat: 24.7, lng: 46.7 };

console.log("1) the NOT NULL DEFAULT FALSE trap");
{
  // A visit started with no GPS at all. The column says false, but nothing
  // was ever measured — this must not read as a failed check.
  const s = gpsCheckState({ checkin_verified: false, checkin_lat: null, checkin_lng: null });
  check("false with no fix is not_recorded, not a failure", s === "not_recorded", s);
}

console.log("2) a real verified check-in");
{
  const s = gpsCheckState({ checkin_verified: true, checkin_lat: 24.7, checkin_lng: 46.7 });
  check("verified", s === "verified", s);
}

console.log("3) a captured fix that did not validate");
{
  const s = gpsCheckState({ checkin_verified: false, checkin_lat: 24.9, checkin_lng: 46.9 });
  check("false WITH a fix is outside", s === "outside", s);
}

console.log("4) null verified column is still no measurement");
{
  const s = gpsCheckState({ checkin_verified: null, checkin_lat: null, checkin_lng: null });
  check("null + no fix is not_recorded", s === "not_recorded", s);
}

console.log("5) a half-written fix does not count as measured");
{
  // lat without lng cannot locate anything.
  const s = gpsCheckState({ checkin_verified: false, checkin_lat: 24.7, checkin_lng: null });
  check("lat without lng is not_recorded", s === "not_recorded", s);
}

console.log("6) branchHasCoords");
{
  check("both present", branchHasCoords(coords) === true);
  check("null place", branchHasCoords(null) === false);
  check("undefined place", branchHasCoords(undefined) === false);
  check("lat only", branchHasCoords({ lat: 24.7, lng: null }) === false);
  check("explicit nulls", branchHasCoords({ lat: null, lng: null }) === false);
  // 0,0 is a real coordinate (Gulf of Guinea) — must not be treated as absent.
  check("zero coordinates are real", branchHasCoords({ lat: 0, lng: 0 }) === true);
}

console.log("7) rate is null, never 0, when nothing was measured");
{
  const rows: GpsTallyRow[] = [
    { checkin_verified: false, checkin_lat: null, checkin_lng: null, place: coords },
    { checkin_verified: false, checkin_lat: null, checkin_lng: null, place: coords },
  ];
  const t = tallyGps(rows);
  check("started = 2", t.started === 2, t.started);
  check("notRecorded = 2", t.notRecorded === 2, t.notRecorded);
  check("rate is null, not 0", t.rate === null, t.rate);
  check("avgDistance is null, not 0", t.avgDistance === null, t.avgDistance);
  check("verified = 0", t.verified === 0);
}

console.log("8) unmeasured visits do not dilute the rate");
{
  const rows: GpsTallyRow[] = [
    { checkin_verified: true,  checkin_lat: 24.7, checkin_lng: 46.7, checkin_distance_meters: 10, place: coords },
    { checkin_verified: false, checkin_lat: null, checkin_lng: null, place: coords },
    { checkin_verified: false, checkin_lat: null, checkin_lng: null, place: coords },
    { checkin_verified: false, checkin_lat: null, checkin_lng: null, place: coords },
  ];
  const t = tallyGps(rows);
  // Old behaviour would have been 1/4 = 25% and painted red.
  check("rate is 100% over MEASURED visits", t.rate === 100, t.rate);
  check("the three unmeasured are reported separately", t.notRecorded === 3, t.notRecorded);
  check("started still counts all four", t.started === 4, t.started);
}

console.log("9) a genuine failure does lower the rate");
{
  const rows: GpsTallyRow[] = [
    { checkin_verified: true,  checkin_lat: 24.7, checkin_lng: 46.7, checkin_distance_meters: 20, place: coords },
    { checkin_verified: false, checkin_lat: 25.9, checkin_lng: 46.9, place: coords },
  ];
  const t = tallyGps(rows);
  check("1 of 2 measured -> 50%", t.rate === 50, t.rate);
  check("outside = 1", t.outside === 1, t.outside);
  check("notRecorded = 0", t.notRecorded === 0);
}

console.log("10) branches without coordinates are counted as the cause");
{
  const rows: GpsTallyRow[] = [
    { checkin_verified: false, checkin_lat: null, checkin_lng: null, place: { lat: null, lng: null } },
    { checkin_verified: false, checkin_lat: null, checkin_lng: null, place: null },
    { checkin_verified: true,  checkin_lat: 24.7, checkin_lng: 46.7, checkin_distance_meters: 5, place: coords },
  ];
  const t = tallyGps(rows);
  check("two visits were to branches with no coordinates", t.noBranchCoords === 2, t.noBranchCoords);
  check("the branch WITH coordinates is not counted", t.noBranchCoords !== 3);
  check("rate over measured is still 100%", t.rate === 100, t.rate);
}

console.log("11) avgDistance uses verified check-ins only");
{
  const rows: GpsTallyRow[] = [
    { checkin_verified: true, checkin_lat: 1, checkin_lng: 1, checkin_distance_meters: 10, place: coords },
    { checkin_verified: true, checkin_lat: 1, checkin_lng: 1, checkin_distance_meters: 30, place: coords },
    // an outside fix carries a distance too, but must not enter the average
    { checkin_verified: false, checkin_lat: 1, checkin_lng: 1, checkin_distance_meters: 5000, place: coords },
  ];
  const t = tallyGps(rows);
  check("mean of 10 and 30 is 20", t.avgDistance === 20, t.avgDistance);
}

console.log("12) a verified check-in with no recorded distance");
{
  const rows: GpsTallyRow[] = [
    { checkin_verified: true, checkin_lat: 1, checkin_lng: 1, checkin_distance_meters: null, place: coords },
  ];
  const t = tallyGps(rows);
  check("counts as verified", t.verified === 1);
  check("but contributes no distance", t.avgDistance === null, t.avgDistance);
}

console.log("13) empty input");
{
  const t = tallyGps([]);
  check("no throw", t.started === 0 && t.rate === null && t.avgDistance === null);
}

