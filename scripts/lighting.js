function getScaledRadius(value, scale) {
  const radius = Number(value);
  if (!Number.isFinite(radius)) return null;
  return Number((radius * scale).toFixed(6));
}

function getAmbientLightRadiusUpdates(scene, scale) {
  if (!Number.isFinite(scale) || scale <= 0) return [];

  return Array.from(scene?.lights ?? []).flatMap((light) => {
    const id = light?.id ?? light?._id;
    if (!id) return [];

    const update = { _id: id };
    for (const radius of ["bright", "dim"]) {
      const scaledRadius = getScaledRadius(light?.config?.[radius], scale);
      if (scaledRadius === null) continue;
      update[`config.${radius}`] = scaledRadius;
    }

    return Object.keys(update).length > 1 ? [update] : [];
  });
}

export async function scaleAmbientLightRadiiForGrid(
  scene,
  previousGridSize,
  gridSize
) {
  const previousSize = Number(previousGridSize);
  const nextSize = Number(gridSize);
  if (
    !scene
    || !Number.isFinite(previousSize)
    || previousSize <= 0
    || !Number.isFinite(nextSize)
    || nextSize <= 0
  ) {
    return 0;
  }

  // Foundry converts distance-unit light radii to pixels using the grid size.
  // Scale configured radii inversely so their Scene pixel coverage stays fixed.
  const updates = getAmbientLightRadiusUpdates(scene, previousSize / nextSize);
  if (updates.length === 0) return 0;

  await scene.updateEmbeddedDocuments("AmbientLight", updates);
  return updates.length;
}
