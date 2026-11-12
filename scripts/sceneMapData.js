// Scene Maps store Foundry data paths and Scene IDs, never operating-system paths.
const coordinate = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100000, Math.max(-100000, number)) : 0;
};

export function normalizeSceneMaps(value) {
  const mapIds = new Set();
  return (Array.isArray(value) ? value : []).flatMap((map) => {
    if (!map || typeof map.id !== "string" || !map.id || mapIds.has(map.id)) return [];
    const name = typeof map.name === "string" ? map.name.trim().slice(0, 100) : "";
    if (!name) return [];
    mapIds.add(map.id);
    const nodeIds = new Set();
    const nodes = (Array.isArray(map.nodes) ? map.nodes : []).flatMap((node) => {
      if (!node || typeof node.id !== "string" || !node.id || nodeIds.has(node.id)) return [];
      const path = typeof node.path === "string" ? node.path.trim() : "";
      const sceneId = typeof node.sceneId === "string" ? node.sceneId : "";
      if (!path && !sceneId) return [];
      nodeIds.add(node.id);
      return [{ id: node.id, path, sceneId, x: coordinate(node.x), y: coordinate(node.y) }];
    });
    const pairs = new Set();
    const links = (Array.isArray(map.links) ? map.links : []).flatMap((link) => {
      if (!link || link.from === link.to || !nodeIds.has(link.from) || !nodeIds.has(link.to)) return [];
      const key = JSON.stringify([link.from, link.to].sort());
      if (pairs.has(key)) return [];
      pairs.add(key);
      return [{ from: link.from, to: link.to }];
    });
    return [{
      id: map.id, name, nodes, links,
      partyNodeId: nodeIds.has(map.partyNodeId) ? map.partyNodeId : ""
    }];
  });
}

export function toggleSceneMapLink(map, from, to) {
  if (from === to || !map.nodes.some((node) => node.id === from)
    || !map.nodes.some((node) => node.id === to)) return;
  const index = map.links.findIndex((link) =>
    (link.from === from && link.to === to) || (link.from === to && link.to === from));
  if (index >= 0) map.links.splice(index, 1);
  else map.links.push({ from, to });
}

export function removeSceneMapNode(map, id) {
  map.nodes = map.nodes.filter((node) => node.id !== id);
  map.links = map.links.filter((link) => link.from !== id && link.to !== id);
  if (map.partyNodeId === id) map.partyNodeId = "";
}
