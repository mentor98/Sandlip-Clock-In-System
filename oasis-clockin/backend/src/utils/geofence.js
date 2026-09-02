const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two lat/long points, in meters. */
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

function isWithinGeofence(studentLat, studentLon, locationLat, locationLon, radiusM) {
  return haversineDistanceMeters(studentLat, studentLon, locationLat, locationLon) <= radiusM;
}

module.exports = { haversineDistanceMeters, isWithinGeofence };
