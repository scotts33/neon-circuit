# Neon Circuit 2026

Browser **arcade kart racer** — multi-city circuits, heat-seek items, career unlocks, time trial, and procedural audio. Original theme (no Nintendo IP).

## Play online

**https://rawcdn.githack.com/scotts33/neon-circuit/main/index.html**

Repo: [scotts33/neon-circuit](https://github.com/scotts33/neon-circuit) (public). Private working copy: [scotts33/neo-kart](https://github.com/scotts33/neo-kart).

Sibling game (flying cars): **https://rawcdn.githack.com/scotts33/sky-circuit/main/index.html**

## Play locally

```bash
cd Development/neo-kart   # or your path to this folder
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

Requires HTTP (not `file://`) so Three.js and lazy 3D assets load.

### Share packages

```bash
npm run share   # builds dist/ + Desktop Neon-Circuit-2026.html / .zip
```

### Courses
| Id | Name | Notes |
|----|------|--------|
| `neo-tokyo` | Rainbow Bridge Run | Day bay + long jump |
| `neo-tokyo-night` | Midnight Express | Wet night (unlock: 2 career wins) |
| `dubai` | Mirage Super-Loop | Dirt **shortcut** cut + dunes |
| `shanghai` | Pulse River Circuit | Twin bridges + jump |
| `harbor` | Atlantic Arc | Suspension span |
| `red-rock` | Mesa Breaker | Desert mesa + gorge jump |

### Modes
- **Race** — multi-kart grid, traffic, items, AI difficulty Easy / Normal / Hard  
- **Time Trial** — solo, no traffic; **recorded ghost** telemetry when you set a PB (centerline scrub only as fallback)  
- **Cup** — multi-course points series  

### Handling classes
Garage tunes (career unlocks): **Balanced**, **Grip**, **Power**, **Light** — different accel / top speed / steer mults. AI field rotates classes.

### Items
boost · missile · oil · **mine** · shield · shock  

**Brake + Item** throws traps / reverse-fires missiles behind you (no heat-seek on reverse shots).

### Controls
| Action | Keys | Gamepad | Touch |
|--------|------|---------|-------|
| Accel | `W` / `↑` | RT / D-pad up | **GO** |
| Brake | `S` / `↓` | LT / D-pad down | **BRAKE** |
| Steer | `A` `D` / arrows | Left stick | Left virtual stick |
| Drift | `Shift` / `Z` | B / RB | **DRIFT** |
| Item | `Space` / `E` | A / X / LB | **ITEM** |
| Camera | `C` / `V` | Select | — |
| Pause | `P` | Start | — |
| Mute | `M` | — | MUTE checkbox / pause MUTE |
| Courses | `Esc` | — | COURSES button |
| Rematch | `R` (results) | — | — |

Touch controls appear automatically on coarse pointers / narrow viewports. Keys are remappable via `NeoKartInput.setBinding`.

### Settings (course menu)
SFX · Music · Stick sensitivity · Deadzone · Camera · GFX quality · Paint · **Handling class** · **Steer assist** · **Auto-brake** · career paints / courses / challenges

### Graphics (3D High+)
Theme-driven **IBL** (richer cube env + optional PMREM), **player-follow soft shadows**, **wet-road puddle specular** on rain, **road microdetail**, **contact shadows** under karts, **night window emissives + street lamps**, animated reflective **water**, hero landmarks, **tire smoke / rain spray / dense skids**, boost **heat-haze** post, **SSAO + motion** on High, AI **vehicle LOD**, Medium strips cost; mobile step-down retained.

### Finish flow
Player finish → short grace → **instant replay** (~6.5s ring buffer + optional full-race cinema samples) → results board + podium orbit cam.

### Courses / risk
Most circuits now include a **dirt shortcut** zone (grip penalty). Shanghai + night Tokyo use **rain** weather (lower top speed / wet coast).

## Architecture
| File | Role |
|------|------|
| `js/track.js` | Courses, elevation, shortcuts, landmarks |
| `js/race-engine.js` | Pure sim (drive, items, AI, replay buffer, ghost pose, taunts) |
| `js/render3d.js` | Three.js world, podium/replay cam, ghost mesh |
| `js/render.js` | 2D fallback |
| `js/main.js` | Loop, HUD, menus, hit-stop, touch wiring |
| `js/audio.js` | SFX + procedural BGM (separate buses) |
| `js/storage.js` | Settings, PBs, cup, career, session |
| `js/input.js` | Keyboard + gamepad + touch virtual pad |
| `vendor/three.min.js` | Three.js r160 (lazy-loaded on first race) |

## Tests
```bash
npm test           # pure engine/storage (~60 cases)
npm run test:load  # browser-like script globals
npm run test:launch  # Playwright smoke (optional)
```
