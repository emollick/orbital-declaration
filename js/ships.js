/* Orbital Declaration — hull classes. Numbers are game data in SI units. */
(function () {
  'use strict';
  const OD = window.OD;

  // Mount records are game data consumed by the optional engagement module.
  const beam = (name, power, aperture, wavelength, arc) => ({ kind: 'beam', name, power, efficiency: 0.35, aperture, wavelength, arc });
  const coil = (name, muzzleVelocity, slugMass, cycle, magazine) => ({ kind: 'coilgun', name, muzzleVelocity, slugMass, cycle, magazine, heatPerShot: 0.15 * 0.5 * slugMass * muzzleVelocity * muzzleVelocity });
  const bay = (name, count, dryMass, propMass, ve, accel) => ({ kind: 'launcher', name, count, interceptor: { dryMass, propMass, exhaustVelocity: ve, accel } });
  const pd = (name, power, aperture) => ({ kind: 'pd', name, power, efficiency: 0.3, aperture, wavelength: 532e-9 });

  // Sensors: sensorRange is the passive sensitivity S (a solution at R_sol = S·√(P / 1 MW)); activeRange is how
  // far the active sensor pins a target outright, at the price of announcing the ship to everyone.
  // Radiators: radiatorArea is sized so that full fire — idle heat, the drive at full throttle and every beam
  // mount at its rated power less its efficiency — beats what the panels can shed at radiatorTemp by 15 to 20 %,
  // so a warship fighting flat out fills her sink instead of shrugging the heat off. The panels only reach that
  // rating once the sink passes the knee (physics.js: T = 290 K + min(1, load / SINK_KNEE) · (radiatorTemp − 290 K)), so the drive alone settles a
  // warship near 60 % of her sink and full fire on top of the burn fills it in 16 to 22 min.
  const CLASSES = {
    corvette: {
      id: 'corvette', name: 'Kestrel-class corvette', role: 'corvette', length: 70,
      dryMass: 900e3, propMass: 1400e3, exhaustVelocity: 55e3, thrust: 30e6,
      angAccel: 0.03, maxAngVel: 0.25,
      reactorPower: 60e6, idleHeat: 2e6, driveHeat: 30e6, sinkCapacity: 15e9, radiatorArea: 330, radiatorTemp: 1000, radiatorDeployTime: 25,
      sensorRange: 250e3, activeRange: 800e3,
      armour: { nose: 20, flank: 8, tail: 4 },
      mounts: [beam('Spinal laser', 12e6, 1.0, 1064e-9, 'nose'), coil('Coilgun', 4000, 5, 6, 90), bay('Interceptor bay', 6, 150, 250, 8000, 60), pd('Point-defence laser', 2e6, 0.3)],
      doctrine: { range: 250e3, jink: true },
      blurb: 'Fast picket hull. One spinal laser, one coilgun, six interceptors. The flanks carry 8 cm of armour against 20 cm on the nose.',
      advice: 'Keep the nose toward the threat.',
    },
    frigate: {
      id: 'frigate', name: 'Halberd-class frigate', role: 'frigate', length: 120,
      dryMass: 2400e3, propMass: 3200e3, exhaustVelocity: 55e3, thrust: 60e6,
      angAccel: 0.015, maxAngVel: 0.18,
      reactorPower: 120e6, idleHeat: 4e6, driveHeat: 55e6, sinkCapacity: 30e9, radiatorArea: 600, radiatorTemp: 1000, radiatorDeployTime: 35,
      sensorRange: 300e3, activeRange: 1000e3,
      armour: { nose: 30, flank: 12, tail: 6 },
      mounts: [beam('Laser turret A', 10e6, 0.9, 1064e-9, 'turret'), beam('Laser turret B', 10e6, 0.9, 1064e-9, 'turret'), coil('Coilgun', 4000, 8, 7, 120), bay('Interceptor bay', 12, 150, 250, 8000, 60), pd('Point-defence laser 1', 2e6, 0.3), pd('Point-defence laser 2', 2e6, 0.3)],
      doctrine: { range: 400e3, jink: true },
      blurb: 'Both navies fly more frigates than anything else. Two laser turrets, an 8 kg coilgun and twelve interceptors.',
    },
    destroyer: {
      id: 'destroyer', name: 'Anvil-class destroyer', role: 'destroyer', length: 180,
      dryMass: 5000e3, propMass: 6000e3, exhaustVelocity: 60e3, thrust: 110e6,
      angAccel: 0.009, maxAngVel: 0.14,
      reactorPower: 250e6, idleHeat: 8e6, driveHeat: 100e6, sinkCapacity: 60e9, radiatorArea: 1080, radiatorTemp: 1000, radiatorDeployTime: 45,
      sensorRange: 350e3, activeRange: 1500e3,
      armour: { nose: 45, flank: 18, tail: 8 },
      mounts: [beam('Laser turret A', 15e6, 1.2, 1064e-9, 'turret'), beam('Laser turret B', 15e6, 1.2, 1064e-9, 'turret'), coil('Heavy coilgun A', 4500, 12, 8, 100), coil('Heavy coilgun B', 4500, 12, 8, 100), bay('Interceptor bay', 16, 150, 250, 8000, 60), pd('Point-defence laser 1', 2.5e6, 0.3), pd('Point-defence laser 2', 2.5e6, 0.3), pd('Point-defence laser 3', 2.5e6, 0.3)],
      doctrine: { range: 600e3, jink: false },
      blurb: 'Two heavy coilguns and 45 cm of nose armour. It needs about 40 s to swing the nose through 180°, and the tail carries only 8 cm.',
    },
    cruiser: {
      id: 'cruiser', name: 'Harkness-class cruiser', role: 'cruiser', length: 320,
      dryMass: 14000e3, propMass: 15000e3, exhaustVelocity: 60e3, thrust: 250e6,
      angAccel: 0.005, maxAngVel: 0.1,
      reactorPower: 600e6, idleHeat: 15e6, driveHeat: 220e6, sinkCapacity: 150e9, radiatorArea: 2500, radiatorTemp: 1000, radiatorDeployTime: 60,
      sensorRange: 450e3, activeRange: 2000e3,
      armour: { nose: 70, flank: 28, tail: 12 },
      mounts: [beam('Main laser A', 25e6, 1.6, 1064e-9, 'turret'), beam('Main laser B', 25e6, 1.6, 1064e-9, 'turret'), beam('Main laser C', 25e6, 1.6, 1064e-9, 'turret'), beam('Main laser D', 25e6, 1.6, 1064e-9, 'turret'), coil('Heavy coilgun A', 5000, 20, 10, 80), coil('Heavy coilgun B', 5000, 20, 10, 80), bay('Interceptor bay', 24, 150, 250, 8000, 60), pd('Point-defence laser 1', 3e6, 0.35), pd('Point-defence laser 2', 3e6, 0.35), pd('Point-defence laser 3', 3e6, 0.35), pd('Point-defence laser 4', 3e6, 0.35), pd('Point-defence laser 5', 3e6, 0.35), pd('Point-defence laser 6', 3e6, 0.35)],
      doctrine: { range: 800e3, jink: false },
      blurb: 'Flagship hull. Four main lasers on 1.6 m mirrors, the widest apertures in the Jovian system, and 70 cm of nose armour.',
    },
    lancer: {
      id: 'lancer', name: 'Lancer-class interceptor carrier', role: 'missile boat', length: 90,
      dryMass: 1200e3, propMass: 1600e3, exhaustVelocity: 50e3, thrust: 30e6,
      angAccel: 0.025, maxAngVel: 0.22,
      reactorPower: 50e6, idleHeat: 2e6, driveHeat: 28e6, sinkCapacity: 12e9, radiatorArea: 300, radiatorTemp: 1000, radiatorDeployTime: 25,
      sensorRange: 300e3, activeRange: 1200e3,
      armour: { nose: 12, flank: 6, tail: 3 },
      mounts: [bay('Interceptor bay A', 12, 150, 250, 8000, 60), bay('Interceptor bay B', 12, 150, 250, 8000, 60), pd('Point-defence laser', 2e6, 0.3)],
      doctrine: { range: 2500e3, jink: true },
      blurb: 'Twenty-four interceptors and one point-defence laser. It launches from 2 500 km. Closer in it has 12 cm of nose armour and nothing to shoot with.',
    },
    freighter: {
      id: 'freighter', name: 'Meridian-class freighter', role: 'freighter', length: 250,
      dryMass: 6000e3, propMass: 8000e3, exhaustVelocity: 40e3, thrust: 25e6,
      angAccel: 0.004, maxAngVel: 0.06,
      reactorPower: 40e6, idleHeat: 3e6, driveHeat: 20e6, sinkCapacity: 60e9, radiatorArea: 800, radiatorTemp: 900, radiatorDeployTime: 60,
      sensorRange: 120e3, activeRange: 0,
      armour: { nose: 5, flank: 3, tail: 2 },
      mounts: [],
      doctrine: { range: 0, jink: false, civilian: true },
      blurb: 'Unarmed bulk hauler. 8 000 t of propellant behind 25 MN of thrust, and no mounts. Its cargo is what both fleets are fighting over.',
    },
    station: {
      id: 'station', name: 'Orbital station', role: 'station', length: 600,
      dryMass: 60000e3, propMass: 0, exhaustVelocity: 1, thrust: 0,
      angAccel: 0.001, maxAngVel: 0.01,
      reactorPower: 900e6, idleHeat: 30e6, driveHeat: 0, sinkCapacity: 1100e9, radiatorArea: 6000, radiatorTemp: 1000, radiatorDeployTime: 120,
      sensorRange: 500e3, activeRange: 2500e3,
      armour: { nose: 40, flank: 40, tail: 40 },
      mounts: [beam('Defence laser A', 20e6, 1.4, 1064e-9, 'turret'), beam('Defence laser B', 20e6, 1.4, 1064e-9, 'turret'), pd('Point-defence laser 1', 3e6, 0.35), pd('Point-defence laser 2', 3e6, 0.35), pd('Point-defence laser 3', 3e6, 0.35), pd('Point-defence laser 4', 3e6, 0.35)],
      doctrine: { range: 0, jink: false, stationary: true },
      blurb: 'A habitat with two 20 MW defence lasers and 6 000 m² of radiators. It has no drive and holds its orbit.',
    },
  };

  const FACTIONS = {
    JC:  { id: 'JC',  name: 'Jovian Compact',          short: 'Compact', prefix: 'JCS', color: '#4fd1c5', dim: '#2a6f6a' },
    ISA: { id: 'ISA', name: 'Inner Systems Authority', short: 'ISA',     prefix: 'ISV', color: '#f0a04b', dim: '#7a5024' },
    CIV: { id: 'CIV', name: 'Civilian',                short: 'Civil',   prefix: 'JCV', color: '#b9c3d1', dim: '#5b6470' },
  };

  // Hull silhouettes, unit length along +x (nose at +0.5, tail at −0.5), unit width.
  const SHAPES = {
    corvette: [[0.5, 0], [0.2, 0.12], [-0.3, 0.12], [-0.42, 0.2], [-0.5, 0.2], [-0.5, -0.2], [-0.42, -0.2], [-0.3, -0.12], [0.2, -0.12]],
    frigate: [[0.5, 0], [0.3, 0.1], [0.1, 0.16], [-0.35, 0.16], [-0.45, 0.24], [-0.5, 0.24], [-0.5, -0.24], [-0.45, -0.24], [-0.35, -0.16], [0.1, -0.16], [0.3, -0.1]],
    destroyer: [[0.5, 0], [0.38, 0.14], [0.05, 0.18], [-0.1, 0.24], [-0.4, 0.24], [-0.5, 0.3], [-0.5, -0.3], [-0.4, -0.24], [-0.1, -0.24], [0.05, -0.18], [0.38, -0.14]],
    cruiser: [[0.5, 0], [0.42, 0.12], [0.2, 0.2], [0.0, 0.2], [-0.05, 0.28], [-0.35, 0.28], [-0.42, 0.36], [-0.5, 0.36], [-0.5, -0.36], [-0.42, -0.36], [-0.35, -0.28], [-0.05, -0.28], [0.0, -0.2], [0.2, -0.2], [0.42, -0.12]],
    lancer: [[0.5, 0], [0.25, 0.08], [0.25, 0.22], [-0.3, 0.22], [-0.3, 0.1], [-0.5, 0.14], [-0.5, -0.14], [-0.3, -0.1], [-0.3, -0.22], [0.25, -0.22], [0.25, -0.08]],
    freighter: [[0.5, 0.1], [0.4, 0.2], [-0.4, 0.2], [-0.5, 0.12], [-0.5, -0.12], [-0.4, -0.2], [0.4, -0.2], [0.5, -0.1]],
    station: 'ring',
  };

  OD.Ships = { CLASSES, FACTIONS, SHAPES };
})();
