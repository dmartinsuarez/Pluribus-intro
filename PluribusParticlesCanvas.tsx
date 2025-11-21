import React, { useRef, useEffect, useState } from "react";

type Config = {
  waveSpeed: number;
  waveInterval: number;
  waveThickness: number;
  radialKick: number; // "Wave Force" in UI
  noiseKick: number;  // "Wave Chaos" in UI
  returnStrength: number;
  bounceProb: number;
  ambientCount: number;
  repulsionStrength: number;
  repulsionRadius: number;
  paused: boolean;
  skipIntro: boolean;
};

export default function PluribusParticlesCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef({ x: 0, y: 0, active: false });
  const [wordScale, setWordScale] = useState(0.7);
  const [restartToken, setRestartToken] = useState(0);
  
  // New state for dynamic text and UI toggling
  const [text, setText] = useState("PLURIBUS");
  const [isControlsOpen, setIsControlsOpen] = useState(false);

  const [config, setConfig] = useState<Config>({
    waveSpeed: 0.12,
    waveInterval: 1250,
    waveThickness: 32,
    radialKick: 0.2,      
    noiseKick: 0.05,       
    returnStrength: 0.040,
    bounceProb: 0.008,
    ambientCount: 0,
    repulsionStrength: 20.0,
    repulsionRadius: 4,
    paused: false,
    skipIntro: true,
  });

  // Keep a ref to config so we can read the latest values inside the animation loop
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    
    if (width === 0 || height === 0) return;

    canvas.width = width;
    canvas.height = height;

    const GRID_SPACING = 3; 
    const TEXT_RADIUS = 1.1;
    const BG_RADIUS = 1.0;
    const TEXT_BASE_ALPHA = 1.0;
    const BG_BASE_ALPHA = 0.32;
    const TEXT_KEEP_PROB = 0.85; 
    const BACKGROUND_KEEP_PROB = 0.22;
    
    const JITTER_AMOUNT = 0.5; 

    const ZOOM_START = 3.0;
    const ZOOM_END = 1.0;
    const ANIMATION_DURATION = 4800;

    const MAIN_WAVE_MIN_RADIUS = 10;
    const MAIN_WAVE_FADE_RADIUS = 140;

    type Particle = {
      baseX: number;
      baseY: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      dist: number; // distance from global wave origin
      angle: number;
      isText: boolean;
      activation: number;
      jitterX: number;
      jitterY: number;
      phase: number;
      friction: number;
      mass: number;
      radius: number;
    };

    type AmbientParticle = {
      baseX: number;
      baseY: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      friction: number;
      mass: number;
      radius: number;
    };

    // Waves now track their own radius instead of calculating it from time
    type Wave = {
      radius: number;
    };

    const particles: Particle[] = [];
    const ambientParticles: AmbientParticle[] = [];
    const waves: Wave[] = [];

    let waveOrigin = { x: 0, y: 0 };

    let lastRafTime = 0;
    let accumulatedTime = 0;
    let timeSinceLastWave = 0;
    let rafId: number | null = null;

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const randRange = (min: number, max: number) => min + Math.random() * (max - min);

    function createMask(word: string) {
      const off = document.createElement("canvas");
      const offCtx = off.getContext("2d");
      if (!offCtx) return;

      off.width = width;
      off.height = height;
      
      if (off.width === 0 || off.height === 0) return;

      // Dynamic font size based on word length to prevent clipping
      const safeWord = word || " ";
      const fontSizeBasedOnWidth = width / (safeWord.length * 0.75);
      const fontSizeBasedOnHeight = height * 0.4;
      const baseSize = Math.min(fontSizeBasedOnWidth, fontSizeBasedOnHeight) * wordScale;

      offCtx.clearRect(0, 0, off.width, off.height);
      offCtx.fillStyle = "#fff";
      offCtx.textAlign = "center";
      offCtx.textBaseline = "middle";
      offCtx.font = `900 ${baseSize}px system-ui`;
      offCtx.fillText(safeWord, off.width / 2, off.height / 2);

      const imgData = offCtx.getImageData(0, 0, off.width, off.height).data;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (let y = 0; y < off.height; y += GRID_SPACING) {
        for (let x = 0; x < off.width; x += GRID_SPACING) {
          const i = (y * off.width + x) * 4;
          const a = imgData[i + 3];
          if (a > 128) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      const textCenterX = minX === Infinity ? width/2 : (minX + maxX) / 2;
      const textCenterY = minY === Infinity ? height/2 : (minY + maxY) / 2;

      const numLetters = safeWord.length;
      const totalWidth = Math.max(1, maxX - minX);

      const approxLetterWidth = totalWidth / Math.max(1, numLetters);
      waveOrigin = {
        x: minX === Infinity ? width/2 : minX + approxLetterWidth * 0.5,
        y: textCenterY,
      };

      const cfg = configRef.current;
      const approxAmbientTarget = Math.max(10, Math.floor(cfg.ambientCount));

      for (let y = 0; y < off.height; y += GRID_SPACING) {
        for (let x = 0; x < off.width; x += GRID_SPACING) {
          const i = (y * off.width + x) * 4;
          const a = imgData[i + 3];
          const isText = a > 128;

          if (isText && Math.random() > TEXT_KEEP_PROB) continue;
          if (!isText && Math.random() > BACKGROUND_KEEP_PROB) continue;

          const baseX = x - textCenterX;
          const baseY = y - textCenterY;

          const jitterX = isText ? randRange(-0.2, 0.2) : randRange(-JITTER_AMOUNT * 3, JITTER_AMOUNT * 3);
          const jitterY = isText ? randRange(-0.2, 0.2) : randRange(-JITTER_AMOUNT * 3, JITTER_AMOUNT * 3);

          const dx = x - waveOrigin.x;
          const dy = y - waveOrigin.y;
          const dist = Math.hypot(dx, dy);
          const angle = Math.atan2(dy, dx);

          particles.push({
            baseX,
            baseY,
            x: baseX + jitterX,
            y: baseY + jitterY,
            vx: 0,
            vy: 0,
            dist,
            angle,
            isText,
            activation: isText ? 0 : 1,
            jitterX,
            jitterY,
            phase: Math.random() * Math.PI * 2,
            friction: randRange(0.92, 0.97), 
            mass: randRange(0.6, 1.4),
            radius: TEXT_RADIUS,
          });

          if (!isText && ambientParticles.length < approxAmbientTarget && Math.random() < 0.1) {
            ambientParticles.push({
              baseX,
              baseY,
              x: baseX + jitterX,
              y: baseY + jitterY,
              vx: 0,
              vy: 0,
              friction: randRange(0.90, 0.96),
              mass: randRange(0.5, 1.5),
              radius: BG_RADIUS,
            });
          }
        }
      }

      while (ambientParticles.length < approxAmbientTarget) {
        ambientParticles.push({
          baseX: randRange(-width * 0.5, width * 0.5),
          baseY: randRange(-height * 0.5, height * 0.5),
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          friction: randRange(0.90, 0.96),
          mass: randRange(0.5, 1.5),
          radius: BG_RADIUS,
        });
      }
    }

    function draw(rafTime: number) {
      if (lastRafTime === 0) lastRafTime = rafTime;
      const delta = rafTime - lastRafTime;
      lastRafTime = rafTime;

      const cfg = configRef.current;

      if (!cfg.paused) {
        accumulatedTime += delta;
      }
      const time = accumulatedTime;

      const {
        waveSpeed,
        waveInterval,
        waveThickness,
        radialKick,
        noiseKick,
        returnStrength,
        bounceProb,
        repulsionStrength,
        repulsionRadius,
        skipIntro,
      } = cfg;

      if (!cfg.paused) {
        // Update waves (Integration)
        for (const w of waves) {
          w.radius += delta * waveSpeed;
        }
        
        // Remove dead waves
        const maxDist = Math.hypot(width, height) + 200;
        while (waves.length > 0 && waves[0].radius > maxDist) {
          waves.shift();
        }

        // Spawn waves
        timeSinceLastWave += delta;
        if (waves.length === 0 && timeSinceLastWave >= delta) {
             waves.push({ radius: 0 });
             timeSinceLastWave = 0;
        } else if (timeSinceLastWave > waveInterval) {
             waves.push({ radius: 0 });
             timeSinceLastWave = 0;
        }
      }

      let zoom = 1;
      if (!cfg.skipIntro) {
        const tNorm = clamp(time / ANIMATION_DURATION, 0, 1);
        zoom = ZOOM_START + (ZOOM_END - ZOOM_START) * easeOutCubic(tNorm);
      }

      const firstWave = waves[0]; 
      let revealRadius = 0;
      if (firstWave) {
        revealRadius = firstWave.radius - 40;
      }
      const revealWidth = 140;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(zoom, zoom);

      const mouseLocalX = (mouseRef.current.x - width / 2) / zoom;
      const mouseLocalY = (mouseRef.current.y - height / 2) / zoom;
      const isMouseActive = mouseRef.current.active;

      // --- COLLISION DETECTION (Spatial Grid) ---
      // Using a Map as a sparse grid. Key "x,y" maps to array of particles.
      const CELL_SIZE = 6; // Roughly 2x max particle radius + buffer
      const grid = new Map<string, (Particle | AmbientParticle)[]>();

      // combine for physics loop
      const allParticles: (Particle | AmbientParticle)[] = [...particles, ...ambientParticles];

      // Populate grid
      for (const p of allParticles) {
        // Only add if visible/active to save perf
        // Text particles are "inactive" if alpha is 0 during intro, but let's collide them anyway for stability
        const cellX = Math.floor(p.x / CELL_SIZE);
        const cellY = Math.floor(p.y / CELL_SIZE);
        const key = `${cellX},${cellY}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(p);
      }

      // Resolve collisions
      // We iterate through the particles and check neighbors in the grid
      // A slight damping factor for bounce energy loss
      const COLLISION_DAMPING = 0.85; 

      for (const p1 of allParticles) {
        const cellX = Math.floor(p1.x / CELL_SIZE);
        const cellY = Math.floor(p1.y / CELL_SIZE);

        // Check 3x3 neighbor grid cells
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const key = `${cellX + ox},${cellY + oy}`;
            const cellParticles = grid.get(key);
            if (!cellParticles) continue;

            for (const p2 of cellParticles) {
              if (p1 === p2) continue; // Don't collide with self

              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const distSq = dx * dx + dy * dy;
              const minDist = p1.radius + p2.radius;

              // Optimization: distSq check avoids sqrt if not needed
              if (distSq < minDist * minDist && distSq > 0.001) {
                const dist = Math.sqrt(distSq);
                const overlap = minDist - dist;

                // 1. Separate particles (Position Correction)
                // Distribute overlap correction based on inverse mass (heavier moves less)
                const totalMass = p1.mass + p2.mass;
                const m1Ratio = p2.mass / totalMass; // Inverse proportion
                const m2Ratio = p1.mass / totalMass;

                const nx = dx / dist;
                const ny = dy / dist;

                // Soft separation to avoid jitters
                const separationX = nx * overlap * 0.5;
                const separationY = ny * overlap * 0.5;

                p1.x -= separationX * 2 * m1Ratio; // *2 because each particle corrects half the overlap otherwise
                p1.y -= separationY * 2 * m1Ratio;
                p2.x += separationX * 2 * m2Ratio;
                p2.y += separationY * 2 * m2Ratio;

                // 2. Elastic Collision (Velocity Exchange)
                // Normal velocity components
                const v1n = p1.vx * nx + p1.vy * ny;
                const v2n = p2.vx * nx + p2.vy * ny;

                // Skip if moving apart already
                if (v1n < v2n) continue;

                // 1D Elastic collision formula along the normal
                // v1' = (v1(m1-m2) + 2m2v2) / (m1+m2)
                const m1 = p1.mass;
                const m2 = p2.mass;

                const v1nFinal = (v1n * (m1 - m2) + 2 * m2 * v2n) / totalMass;
                const v2nFinal = (v2n * (m2 - m1) + 2 * m1 * v1n) / totalMass;

                // Apply changes to velocity vector
                const dv1n = v1nFinal - v1n;
                const dv2n = v2nFinal - v2n;

                p1.vx += dv1n * nx * COLLISION_DAMPING;
                p1.vy += dv1n * ny * COLLISION_DAMPING;
                p2.vx += dv2n * nx * COLLISION_DAMPING;
                p2.vy += dv2n * ny * COLLISION_DAMPING;
              }
            }
          }
        }
      }
      // --- END COLLISION DETECTION ---

      for (const p of particles) {
        let totalKickX = 0;
        let totalKickY = 0;

        for (const w of waves) {
          const wRadius = w.radius;

          const fade = clamp(
            (wRadius - MAIN_WAVE_MIN_RADIUS) /
              Math.max(1, MAIN_WAVE_FADE_RADIUS - MAIN_WAVE_MIN_RADIUS),
            0,
            1
          );

          const bandWidthPx = waveThickness;
          const bandDist = Math.abs(p.dist - wRadius);
          if (bandDist >= bandWidthPx) continue;

          const tBand = 1 - bandDist / bandWidthPx;
          // Smooth curve for the band
          const tBandSmooth = tBand * tBand * (3 - 2 * tBand);
          
          const dirX = Math.cos(p.angle);
          const dirY = Math.sin(p.angle);

          const noiseAngle = p.phase + time * 0.0007 + wRadius * 0.002;
          const nx = Math.cos(noiseAngle);
          const ny = Math.sin(noiseAngle);

          const mix = clamp(noiseKick, 0, 1);
          const kickStrength = radialKick * fade;
          
          // Blend radial direction with noise direction
          const fx = (dirX * (1 - mix) + nx * mix) * kickStrength * tBandSmooth;
          const fy = (dirY * (1 - mix) + ny * mix) * kickStrength * tBandSmooth;

          totalKickX += fx;
          totalKickY += fy;

          if (p.isText && Math.random() < bounceProb * tBand * 0.5) {
            const extra = randRange(0.4, 1.0);
            totalKickX += dirX * extra;
            totalKickY += dirY * extra;
          }
        }

        // Mouse Repulsion
        if (isMouseActive) {
          const dx = p.x - mouseLocalX;
          const dy = p.y - mouseLocalY;
          const dist = Math.hypot(dx, dy);

          if (dist < repulsionRadius) {
            const t = 1 - dist / repulsionRadius; 
            // Cubic falloff for smooth, subtle interaction
            const force = t * t * t * repulsionStrength;
            const angle = Math.atan2(dy, dx);
            const acc = force / p.mass;
            
            totalKickX += Math.cos(angle) * acc;
            totalKickY += Math.sin(angle) * acc;
          }
        }

        p.vx += totalKickX;
        p.vy += totalKickY;

        const targetX = p.baseX + p.jitterX;
        const targetY = p.baseY + p.jitterY;
        
        const springAccel = returnStrength / p.mass;
        p.vx += (targetX - p.x) * springAccel;
        p.vy += (targetY - p.y) * springAccel;

        p.vx *= p.friction;
        p.vy *= p.friction;
        
        p.x += p.vx;
        p.y += p.vy;

        if (p.isText) {
          if (skipIntro) {
            p.activation = 1;
          } else if (p.activation < 1 && firstWave) {
            const d = p.dist;
            const bandIn = revealRadius;
            const bandOut = revealRadius + revealWidth;
            if (d < bandIn) {
              p.activation = 1;
            } else if (d < bandOut) {
              const tReveal = 1 - (d - bandIn) / revealWidth;
              p.activation = Math.max(p.activation, tReveal);
            }
          }

          if (p.activation > 0.01) {
            const alpha = p.activation * TEXT_BASE_ALPHA;
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // Ambient background particles
          const alpha = BG_BASE_ALPHA * (1 - p.dist / (width * 0.8)); 
          if (alpha > 0) {
             ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, alpha)})`;
             ctx.beginPath();
             ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
             ctx.fill();
          }
        }
      }

      // Extra ambient particles (dust)
      for (const p of ambientParticles) {
         // very slow drift
         p.x += (Math.random() - 0.5) * 0.1;
         p.y += (Math.random() - 0.5) * 0.1;

         if (isMouseActive) {
          const dx = p.x - mouseLocalX;
          const dy = p.y - mouseLocalY;
          const dist = Math.hypot(dx, dy);
          if (dist < repulsionRadius) {
            const t = 1 - dist / repulsionRadius; 
            const force = t * t * t * repulsionStrength * 0.5; // less effect on dust
            const angle = Math.atan2(dy, dx);
            p.vx += Math.cos(angle) * force / p.mass;
            p.vy += Math.sin(angle) * force / p.mass;
          }
         }
         
         // Apply friction to dust
         p.vx *= p.friction;
         p.vy *= p.friction;
         p.x += p.vx;
         p.y += p.vy;

         ctx.fillStyle = `rgba(255, 255, 255, 0.15)`;
         ctx.beginPath();
         ctx.arc(p.x, p.y, p.radius * 0.8, 0, Math.PI * 2);
         ctx.fill();
      }

      ctx.restore();

      rafId = requestAnimationFrame(draw);
    }

    createMask(text);
    rafId = requestAnimationFrame(draw);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [wordScale, restartToken, text]);

  const handleMouseMove = (e: React.MouseEvent) => {
    mouseRef.current = {
      x: e.clientX,
      y: e.clientY,
      active: true,
    };
  };

  const handleMouseLeave = () => {
    mouseRef.current.active = false;
  };

  const handleChange = (key: keyof Config, val: number | boolean) => {
    setConfig((prev) => ({ ...prev, [key]: val }));
  };

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-black cursor-crosshair"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} className="block" />

      {/* Top Right: Dynamic Word Input */}
      <div className="absolute top-6 right-6 z-10">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value.toUpperCase())}
          maxLength={12}
          className="bg-black/40 hover:bg-black/60 text-white/90 border border-white/10 rounded px-4 py-2 text-sm font-bold tracking-widest uppercase focus:outline-none focus:border-white/40 backdrop-blur-sm transition-all text-center w-32 placeholder-white/20"
          placeholder="TEXT"
        />
      </div>

      {/* Collapsible Control Panel */}
      <div className={`absolute top-4 left-4 z-10 transition-all duration-300 ease-in-out ${isControlsOpen ? 'w-64' : 'w-40'}`}>
        <div className="bg-black/80 text-xs text-white rounded border border-white/10 backdrop-blur-sm shadow-lg shadow-white/5 overflow-hidden">
          
          {/* Header Toggle */}
          <button
            onClick={() => setIsControlsOpen(!isControlsOpen)}
            className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors text-left group"
          >
            <h1 className="font-bold text-sm uppercase tracking-widest text-white/90 group-hover:text-white">
              {isControlsOpen ? "Pluribus Controls" : "Controls"}
            </h1>
            <svg 
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
              className={`text-white/60 transition-transform duration-300 ${isControlsOpen ? 'rotate-180' : ''}`}
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>

          {/* Expanded Content */}
          {isControlsOpen && (
            <div className="px-4 pb-4 space-y-5 animate-in fade-in slide-in-from-top-2 duration-200 border-t border-white/5 pt-4">
              
              {/* Wave Controls Group */}
              <div className="space-y-3">
                <h2 className="text-white/40 font-semibold text-[10px] uppercase tracking-wide border-b border-white/10 pb-1">
                  Wave Dynamics
                </h2>
                
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Wave Speed</span>
                    <span className="text-white/50">{config.waveSpeed.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.01"
                    max="0.6"
                    step="0.01"
                    value={config.waveSpeed}
                    onChange={(e) =>
                      handleChange("waveSpeed", parseFloat(e.target.value))
                    }
                    className="w-full accent-white h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span>Wave Interval (ms)</span>
                    <span className="text-white/50">{config.waveInterval.toFixed(0)}</span>
                  </div>
                  <input
                    type="range"
                    min="200"
                    max="3000"
                    step="50"
                    value={config.waveInterval}
                    onChange={(e) =>
                      handleChange("waveInterval", parseFloat(e.target.value))
                    }
                    className="w-full accent-white h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span>Wave Force</span>
                    <span className="text-white/50">{config.radialKick.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="4"
                    step="0.1"
                    value={config.radialKick}
                    onChange={(e) =>
                      handleChange("radialKick", parseFloat(e.target.value))
                    }
                    className="w-full accent-white h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span>Wave Width</span>
                    <span className="text-white/50">{config.waveThickness}</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="200"
                    value={config.waveThickness}
                    onChange={(e) =>
                      handleChange("waveThickness", parseFloat(e.target.value))
                    }
                    className="w-full accent-white h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span>Wave Chaos</span>
                    <span className="text-white/50">{config.noiseKick.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={config.noiseKick}
                    onChange={(e) =>
                      handleChange("noiseKick", parseFloat(e.target.value))
                    }
                    className="w-full accent-white h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                {/* Particle Physics Group */}
                <div className="space-y-3">
                  <h2 className="text-white/40 font-semibold text-[10px] uppercase tracking-wide border-b border-white/10 pb-1">
                    Particle Physics
                  </h2>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span>Return Strength</span>
                      <span className="text-white/50">{config.returnStrength.toFixed(3)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.001"
                      max="0.1"
                      step="0.001"
                      value={config.returnStrength}
                      onChange={(e) =>
                        handleChange("returnStrength", parseFloat(e.target.value))
                      }
                      className="w-full accent-white h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span>Mouse Bounce</span>
                      <span className="text-white/50">{config.repulsionStrength.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      step="0.5"
                      value={config.repulsionStrength}
                      onChange={(e) =>
                        handleChange("repulsionStrength", parseFloat(e.target.value))
                      }
                      className="w-full accent-white h-1 bg-white/20 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10 flex gap-2">
                  <button
                    onClick={() => handleChange("paused", !config.paused)}
                    className="flex-1 bg-white/10 hover:bg-white/20 py-2 rounded text-xs uppercase font-bold tracking-wider transition-colors"
                  >
                    {config.paused ? "Play" : "Pause"}
                  </button>
                  <button
                    onClick={() => setRestartToken((r) => r + 1)}
                    className="flex-1 bg-white/10 hover:bg-white/20 py-2 rounded text-xs uppercase font-bold tracking-wider transition-colors"
                  >
                    Restart
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}