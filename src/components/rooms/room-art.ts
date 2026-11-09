// A room's cover gradient (mocks 374/375). Deterministic from the room id so a room keeps its colour
// everywhere it's drawn, until it has real banner art. Palette = the ShareSpot tokens (SHARED §9).

const COVERS: [string, string][] = [
  ['#FF7A2F', '#7A2E8C'],
  ['#4FD6E0', '#3A2E5C'],
  ['#B98BFF', '#2A1F55'],
  ['#39D98A', '#1E3A4A'],
  ['#FFD166', '#B4452F'],
  ['#FF8FA3', '#4A2357'],
];

export function roomGradient(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0;
  return COVERS[Math.abs(h) % COVERS.length];
}
