export interface PhysicsConfig {
  iterations: number;
  repulsionStrength: number;
  attractionStrength: number;
  damping: number;
  minDistance: number;
  idealDistance: number;
  targetRange: number;
  stabilizationThreshold: number;
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  iterations: 50,
  repulsionStrength: 0.8,
  attractionStrength: 0.05,
  damping: 0.9,
  minDistance: 1.5,
  idealDistance: 2,
  targetRange: 4,
  stabilizationThreshold: 0.001,
};

export type Position = [number, number, number];

export interface PhysicsEntity {
  id: string;
  positionHint?: "upper_right" | "upper_left" | "lower_right" | "lower_left" | string; // NOSONAR
}

export interface PhysicsConnection {
  fromEntityId: string;
  toEntityId: string;
  strength: number;
}

export function initializePositions(entities: PhysicsEntity[], positions: Map<string, Position>): void {
  positions.clear();
  if (entities.length === 0) return;
  
  // Performance Optimization: Replaced .forEach with standard for loop to eliminate closure allocation overhead.
  for (let index = 0; index < entities.length; index++) {
    const entity = entities[index];
    const angle = (index / entities.length) * Math.PI * 2;
    const radius = 2.5;
    
    let baseOffset: Position = [0, 0, 0];
    if (entity.positionHint === "upper_right") baseOffset = [1, 1, 0];
    else if (entity.positionHint === "upper_left") baseOffset = [-1, 1, 0];
    else if (entity.positionHint === "lower_right") baseOffset = [1, -1, 0];
    else if (entity.positionHint === "lower_left") baseOffset = [-1, -1, 0];
    
    positions.set(entity.id, [
      Math.cos(angle) * radius + baseOffset[0] * 0.5,
      Math.sin(angle) * radius * 0.6 + baseOffset[1] * 0.5,
      Math.sin(angle) * 0.5,
    ]);
  }
}

export function runPhysicsIteration(
  entities: PhysicsEntity[],
  connections: PhysicsConnection[],
  positions: Map<string, Position>,
  config: PhysicsConfig,
  iteration: number
): number {
  if (entities.length === 0) return 0;

  const forces = new Map<string, Position>();
  // Performance Optimization: Replaced .forEach with standard for loop to eliminate closure allocation overhead.
  for (let i = 0; i < entities.length; i++) {
    forces.set(entities[i].id, [0, 0, 0]);
  }
  
  let totalMovement = 0;
  
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const e1 = entities[i];
      const e2 = entities[j];
      const pos1 = positions.get(e1.id)!;
      const pos2 = positions.get(e2.id)!;
      
      const dx = pos1[0] - pos2[0];
      const dy = pos1[1] - pos2[1];
      const dz = pos1[2] - pos2[2];
      const distSq = dx * dx + dy * dy + dz * dz;
      
      if (distSq < 0.01) continue; 
      
      if (distSq < config.minDistance * config.minDistance) {
        const distance = Math.sqrt(distSq);
        const force = config.repulsionStrength / distSq;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        const fz = (dz / distance) * force * 0.3; 
        
        const f1 = forces.get(e1.id)!;
        forces.set(e1.id, [f1[0] + fx, f1[1] + fy, f1[2] + fz]);
        const f2 = forces.get(e2.id)!;
        forces.set(e2.id, [f2[0] - fx, f2[1] - fy, f2[2] - fz]);
      }
    }
  }
  
  // Performance Optimization: Replaced .forEach with standard for loop to eliminate closure allocation overhead.
  for (let i = 0; i < connections.length; i++) {
    const conn = connections[i];
    const pos1 = positions.get(conn.fromEntityId);
    const pos2 = positions.get(conn.toEntityId);
    if (!pos1 || !pos2) continue;
    
    const dx = pos2[0] - pos1[0];
    const dy = pos2[1] - pos1[1];
    const dz = pos2[2] - pos1[2];
    const distSq = dx * dx + dy * dy + dz * dz;
    
    if (distSq < 0.01) continue;
    const distance = Math.sqrt(distSq);
    
    const displacement = distance - config.idealDistance;
    const force = displacement * config.attractionStrength * conn.strength;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    const fz = (dz / distance) * force * 0.3;
    
    const f1 = forces.get(conn.fromEntityId)!;
    forces.set(conn.fromEntityId, [f1[0] + fx, f1[1] + fy, f1[2] + fz]);
    const f2 = forces.get(conn.toEntityId)!;
    forces.set(conn.toEntityId, [f2[0] - fx, f2[1] - fy, f2[2] - fz]);
  }
  
  const decay = Math.max(0.5, 1 - (iteration / config.iterations) * 0.5);
  
  // Performance Optimization: Consolidated multiple .forEach loops into a single for loop.
  // This reduces O(N) array traversals and eliminates closure allocations.
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const pos = positions.get(entity.id)!;
    const f = forces.get(entity.id)!;

    // Apply center gravity
    const fx = f[0] - pos[0] * 0.01;
    const fy = f[1] - pos[1] * 0.01;
    const fz = f[2] - pos[2] * 0.02;

    // Calculate movement directly without intermediate forces.set
    const movement = Math.hypot(fx, fy, fz) * config.damping * decay;
    totalMovement += movement;
    
    // Update final positions
    positions.set(entity.id, [
      pos[0] + fx * config.damping * decay,
      pos[1] + fy * config.damping * decay,
      pos[2] + fz * config.damping * decay,
    ]);
  }
  
  return totalMovement;
}

export function normalizePositions(positions: Map<string, Position>, targetRange: number): void {
  if (positions.size === 0) return;
  
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  // Performance Optimization: Replaced .forEach with for...of to eliminate closure allocations.
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos[0]);
    maxX = Math.max(maxX, pos[0]);
    minY = Math.min(minY, pos[1]);
    maxY = Math.max(maxY, pos[1]);
  }
  
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  
  for (const [id, pos] of positions.entries()) {
    positions.set(id, [
      ((pos[0] - minX) / rangeX - 0.5) * targetRange,
      ((pos[1] - minY) / rangeY - 0.5) * targetRange * 0.7,
      pos[2],
    ]);
  }
}
