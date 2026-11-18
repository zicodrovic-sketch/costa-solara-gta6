// Costa Solara — kota pantai modern prosedural ("Costa Solara").
// Dibangun dari seed: grid jalan, blok berisi bangunan/taman, laut di timur,
// pantai pasir di selatan, plus landmark tetap untuk misi dan spawn.
// Bukan jiplakan kota dari game mana pun: semua nama dan tata letak orisinal.

import { WORLD, ROAD, PALETTE } from './config.js';

/** Jalan vertikal berpusat di x ini; jalan horizontal berpusat di y yang sama. */
const GRID_CENTERS = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000];
/** Batas area grid kota (di luar ini hanya laut di timur dan pantai di selatan). */
const GRID_RIGHT = 2960;
const GRID_BOTTOM = 2160;
/** Trotoar: jarak bangunan dari tepi jalan. */
const SIDEWALK = 14;
/** Warna dinding bangunan, dipilih dari PALETTE. */
const WALL_COLORS = [PALETTE.building, PALETTE.building2, PALETTE.building3];

/** Landmark tetap: koordinat {x, y} di jalan/trotoar, bukan di dalam bangunan. */
const LANDMARK_POINTS = [
  { name: 'Marina', x: 2880, y: 2000 },
  { name: 'Old Town', x: 600, y: 600 },
  { name: 'Harbor', x: 2880, y: 1000 },
  { name: 'Lighthouse', x: 3050, y: 400 },
  { name: 'Garage', x: 1000, y: 1800 },
  { name: 'Market', x: 1400, y: 1000 },
  { name: 'Beachfront', x: 1600, y: 2280 },
  { name: 'North Gate', x: 1600, y: 120 },
];

/** Objek reusable untuk nearestRoadPoint: hasilnya ditulis ulang tiap panggilan. */
const _nearest = { x: 0, y: 0 };

/** Bilangan bulat acak 0..n-1 dari random() yang dilewatkan. */
function randInt(random, n) {
  return Math.floor(random() * n);
}

/** Pilih satu elemen array secara acak. */
function pick(random, arr) {
  return arr[randInt(random, arr.length)];
}

/** Apakah titik (x, y) jatuh di dalam rect yang diperlebar margin. */
function pointInRect(x, y, r, margin) {
  return x >= r.x - margin && x <= r.x + r.w + margin &&
    y >= r.y - margin && y <= r.y + r.h + margin;
}

/** Nama kawasan (district) untuk satu titik — dipakai HUD. */
export function districtAt(city, x, y) {
  if (y >= 2160) return 'Beachfront';
  if (x > 2400 && y < 1600) return 'Harbor';
  if (x > 2400) return 'Marina';
  if (y < 400) return 'Northside';
  if (x < 1200 && y < 1200) return 'Old Town';
  return 'Downtown';
}

/** Bangun satu bangunan di dalam sel blok; null bila menabrak landmark. */
function makeBuilding(random, cellX, cellY, cellW, cellH, district) {
  const margin = 8;
  const w = cellW - margin * 2;
  const h = cellH - margin * 2;
  if (w < 40 || h < 40) return null;
  const b = {
    x: cellX + margin,
    y: cellY + margin,
    w,
    h,
    color: pick(random, WALL_COLORS),
    roof: PALETTE.buildingRoof,
    district,
    // Pusat kota lebih tinggi; pinggiran 1-3 lantai.
    floors: district === 'Downtown' ? 2 + randInt(random, 5) : 1 + randInt(random, 3),
  };
  // Landmark tidak boleh tertutup bangunan: kosongkan sel yang menabraknya.
  for (let i = 0; i < LANDMARK_POINTS.length; i++) {
    const lm = LANDMARK_POINTS[i];
    if (pointInRect(lm.x, lm.y, b, 18)) return null;
  }
  return b;
}

/** Bangun kota prosedural dari seed. Deterministik: seed sama -> kota sama. */
export function createCity(random) {
  const half = ROAD.width / 2;
  const roads = [];
  // Jalan vertikal (x tetap, memanjang ke selatan) dan horizontal (y tetap).
  for (let i = 0; i < GRID_CENTERS.length; i++) {
    const cx = GRID_CENTERS[i];
    roads.push({ x: cx - half, y: 0, w: ROAD.width, h: GRID_BOTTOM, horizontal: false });
  }
  for (let i = 0; i < 5; i++) {
    const cy = GRID_CENTERS[i];
    roads.push({ x: 0, y: cy - half, w: GRID_RIGHT, h: ROAD.width, horizontal: true });
  }

  const buildings = [];
  const parks = [];
  // Batas blok di antara jalan: tepi jalan + trotoar sudah diperhitungkan.
  const colEdges = [0];
  for (let i = 0; i < GRID_CENTERS.length; i++) colEdges.push(GRID_CENTERS[i] - half, GRID_CENTERS[i] + half);
  colEdges.push(GRID_RIGHT);
  const rowEdges = [0];
  for (let i = 0; i < 5; i++) rowEdges.push(GRID_CENTERS[i] - half, GRID_CENTERS[i] + half);
  rowEdges.push(GRID_BOTTOM);

  for (let c = 0; c + 1 < colEdges.length; c += 2) {
    for (let r = 0; r + 1 < rowEdges.length; r += 2) {
      const bx = colEdges[c] + SIDEWALK;
      const by = rowEdges[r] + SIDEWALK;
      const bw = colEdges[c + 1] - colEdges[c] - SIDEWALK * 2;
      const bh = rowEdges[r + 1] - rowEdges[r] - SIDEWALK * 2;
      if (bw < 60 || bh < 60) continue;
      const district = districtAt(null, bx + bw / 2, by + bh / 2);
      // ~15% blok jadi taman hijau, sisanya berisi 1-4 bangunan.
      if (random() < 0.15) {
        parks.push({ x: bx, y: by, w: bw, h: bh });
        continue;
      }
      const count = 1 + randInt(random, 4);
      const cols = count === 1 ? 1 : 2;
      const rows = count <= 2 ? 1 : 2;
      const cellW = bw / cols;
      const cellH = bh / rows;
      let placed = 0;
      for (let gy = 0; gy < rows && placed < count; gy++) {
        for (let gx = 0; gx < cols && placed < count; gx++) {
          const b = makeBuilding(random, bx + gx * cellW, by + gy * cellH, cellW, cellH, district);
          if (b) {
            buildings.push(b);
            placed++;
          }
        }
      }
    }
  }

  // Dermaga kayu menjorok ke laut; satu mengarah ke mercusuar.
  const piers = [
    { x: 2960, y: 392, w: 110, h: 16 },
    { x: 2960, y: 692, w: 150, h: 20 },
    { x: 2960, y: 1092, w: 150, h: 20 },
    { x: 2960, y: 1892, w: 170, h: 20 },
  ];

  return {
    width: WORLD.width,
    height: WORLD.height,
    roads,
    buildings,
    parks,
    // Laut di tepi timur, pantai pasir di tepi selatan.
    water: { x: 2960, y: 0, w: 240, h: 2400 },
    beach: { x: 0, y: 2160, w: 3200, h: 240 },
    piers,
    landmarks: LANDMARK_POINTS.map((lm) => ({ name: lm.name, x: lm.x, y: lm.y })),
  };
}

/** Apakah titik (x, y) berada di atas jalan (dihitung langsung, tanpa alokasi). */
export function isRoadPoint(city, x, y) {
  const half = ROAD.width / 2;
  if (y >= 0 && y <= GRID_BOTTOM) {
    for (let i = 0; i < GRID_CENTERS.length; i++) {
      if (Math.abs(x - GRID_CENTERS[i]) <= half) return true;
    }
  }
  if (x >= 0 && x <= GRID_RIGHT) {
    for (let i = 0; i < 5; i++) {
      if (Math.abs(y - GRID_CENTERS[i]) <= half) return true;
    }
  }
  return false;
}

/** Apakah lingkaran (x, y, r) menabrak bangunan mana pun. Tanpa r, ini uji titik. */
export function collidesBuilding(city, x, y, r) {
  const list = city.buildings;
  // Every caller passes only (x, y): with r undefined, r * r is NaN and the
  // test below never fires, so buildings were never solid. A missing radius
  // means a point test — true when the point is inside a building.
  const rr = r === undefined ? 0 : r;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const cx = x < b.x ? b.x : (x > b.x + b.w ? b.x + b.w : x);
    const cy = y < b.y ? b.y : (y > b.y + b.h ? b.y + b.h : y);
    const dx = x - cx;
    const dy = y - cy;
    if (dx === 0 && dy === 0) return true;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

/** Titik di garis tengah jalan terdekat (objek reusable _nearest, jangan disimpan). */
export function nearestRoadPoint(city, x, y) {
  // Jalan vertikal terdekat: bulatkan x ke pusat grid terdekat.
  let cx = 200 + 400 * Math.round((x - 200) / 400);
  if (cx < 200) cx = 200;
  if (cx > 3000) cx = 3000;
  const vy = y < 0 ? 0 : (y > GRID_BOTTOM ? GRID_BOTTOM : y);
  // Jalan horizontal terdekat: bulatkan y ke pusat grid terdekat.
  let cy = 200 + 400 * Math.round((y - 200) / 400);
  if (cy < 200) cy = 200;
  if (cy > 2000) cy = 2000;
  const hx = x < 0 ? 0 : (x > GRID_RIGHT ? GRID_RIGHT : x);
  const dvx = x - cx;
  const dvy = y - vy;
  const dhx = x - hx;
  const dhy = y - cy;
  if (dvx * dvx + dvy * dvy <= dhx * dhx + dhy * dhy) {
    _nearest.x = cx;
    _nearest.y = vy;
  } else {
    _nearest.x = hx;
    _nearest.y = cy;
  }
  return _nearest;
}

/** Titik acak di garis tengah sebuah jalan (untuk spawn kendaraan). */
export function randomRoadPoint(city, random) {
  const road = city.roads[randInt(random, city.roads.length)];
  if (road.horizontal) {
    return { x: random() * road.w, y: road.y + road.h / 2 };
  }
  return { x: road.x + road.w / 2, y: random() * road.h };
}

/** Titik acak di tepi trotoar sebuah jalan (untuk spawn pejalan kaki). */
export function randomSidewalkPoint(city, random) {
  const road = city.roads[randInt(random, city.roads.length)];
  const side = random() < 0.5 ? -1 : 1;
  const off = ROAD.width / 2 + 8 + random() * 8;
  if (road.horizontal) {
    const y = road.y + road.h / 2 + side * off;
    return { x: random() * road.w, y: y < 0 ? 0 : (y > WORLD.height ? WORLD.height : y) };
  }
  const x = road.x + road.w / 2 + side * off;
  return { x: x < 0 ? 0 : (x > WORLD.width ? WORLD.width : x), y: random() * road.h };
}
